// Character body in one draw (character spec section 1, "Materials"): every
// skinned primitive gets a role colour (COLOR_0) and a glow flag (aGlow:
// 0 none, 1 trim, 2 visor), the primitives are merged into one geometry
// (skinIndex / skinWeight survive) bound to the shared skeleton, and drawn
// with one MeshStandardMaterial patched for glow verts, the danger lerp of
// the trim and a fresnel rim (rim off on the low tier).

import {
  BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, MeshStandardMaterial, Object3D, SkinnedMesh, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MaterialRole } from "./rig";

const ROLE: Record<MaterialRole, { color: string; glow: number }> = {
  suit: { color: "#1E1640", glow: 0 },
  plates: { color: "#DCD6F7", glow: 0 },
  trim: { color: "#22F2FF", glow: 1 },
  visor: { color: "#FF3DCB", glow: 2 },
};
const TRIM = "#22F2FF";
const DANGER = "#FF2D55";

export interface NeonBody {
  mesh: SkinnedMesh;
  material: MeshStandardMaterial;
  setDanger(k: number): void; // 0..1 trim / rim lerp to danger red
  setVisor(k: number): void; // visor emissive multiplier (flicker)
  setRim(on: boolean): void;
}

// Role for a source material: by name, else by colour (darkest = suit,
// lightest = plates, most saturated = trim).
function roleOf(name: string, color: Color, roles: Record<string, MaterialRole>): MaterialRole {
  if (roles[name]) return roles[name];
  if (/glass|visor|eye/i.test(name)) return "visor";
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (hsl.s > 0.45) return "trim";
  return hsl.l > 0.45 ? "plates" : "suit";
}

// 1 for verts on the front of a primitive (world normal z > 0.3, in front
// of the primitive's bounds centre).
function frontMask(g: BufferGeometry, m: Object3D) {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const nm = new Matrix3().getNormalMatrix(m.matrixWorld);
  const v = new Vector3();
  let minZ = Infinity;
  let maxZ = -Infinity;
  const zs = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    zs[i] = v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).z;
    minZ = Math.min(minZ, zs[i]);
    maxZ = Math.max(maxZ, zs[i]);
  }
  const mid = (minZ + maxZ) / 2;
  const out = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const nz = v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize().z;
    out[i] = nz > 0.3 && zs[i] > mid ? 1 : 0;
  }
  return out;
}

export function buildNeonBody(root: Object3D, roles: Record<string, MaterialRole>, inset: Record<string, number> = {}): NeonBody {
  const parts: SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh);
  });
  if (parts.length === 0) throw new Error("character: no skinned mesh");
  const first = parts[0];
  const geos: BufferGeometry[] = [];
  const c = new Color();
  for (const m of parts) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const src = mat as MeshStandardMaterial;
    const role = ROLE[roleOf(src.name, src.color ?? new Color(), roles)];
    const g = new BufferGeometry();
    for (const name of ["position", "normal", "skinIndex", "skinWeight"]) {
      const a = m.geometry.getAttribute(name);
      if (!a) throw new Error(`character: ${m.name} has no ${name}`);
      g.setAttribute(name, a as BufferAttribute);
    }
    if (m.geometry.index) g.setIndex(m.geometry.index);
    // positions as plain float32 (merge needs matching attribute types),
    // pulled inwards for inset slots (metres -> the scaled mesh's units)
    const srcPos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const k = (inset[src.name] ?? 0) / m.getWorldScale(new Vector3()).x;
    const pos = new Float32Array(srcPos.count * 3);
    for (let i = 0; i < srcPos.count; i++) {
      pos[i * 3] = srcPos.getX(i) - nor.getX(i) * k;
      pos[i * 3 + 1] = srcPos.getY(i) - nor.getY(i) * k;
      pos[i * 3 + 2] = srcPos.getZ(i) - nor.getZ(i) * k;
    }
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n);
    // a visor slot only glows where it faces forward (bind pose, model
    // faces +Z): the Astronaut's visor shell also wraps the helmet back,
    // where it showed as pink streaks through the plates
    const visor = role === ROLE.visor;
    const front = visor ? frontMask(g, m) : null;
    const dark = new Color(ROLE.suit.color);
    c.set(role.color);
    for (let i = 0; i < n; i++) {
      const on = !front || front[i] === 1;
      const cc = on ? c : dark;
      col[i * 3] = cc.r;
      col[i * 3 + 1] = cc.g;
      col[i * 3 + 2] = cc.b;
      glow[i] = on ? role.glow : 0;
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.setAttribute("aGlow", new Float32BufferAttribute(glow, 1));
    // every primitive of the pack shares the same node transform + bind
    // matrix; anything else is baked relative to the first one
    if (!m.matrixWorld.equals(first.matrixWorld)) {
      g.applyMatrix4(new Matrix4().copy(first.matrixWorld).invert().multiply(m.matrixWorld));
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error("character: merge failed");
  geos.forEach((g) => g.dispose());

  const uniforms = {
    uTrim: { value: new Color(TRIM) },
    uRim: { value: new Color(TRIM) },
    uRimK: { value: 0.9 },
    uTrimK: { value: 2.2 },
    uVisorK: { value: 2.6 },
    uVisor: { value: new Color(ROLE.visor.color) },
  };
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTrim;\nuniform vec3 uRim;\nuniform float uRimK;\nuniform float uTrimK;\nuniform float uVisorK;\nuniform vec3 uVisor;\nvarying float vGlow;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float isTrim = step(0.5, vGlow) * step(vGlow, 1.5);
float isVisor = step(1.5, vGlow);
diffuseColor.rgb = mix(diffuseColor.rgb, uTrim, isTrim);
totalEmissiveRadiance += uTrim * uTrimK * isTrim + uVisor * uVisorK * isVisor;`,
      )
      .replace(
        "#include <opaque_fragment>",
        "outgoingLight += uRim * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.5) * uRimK;\n#include <opaque_fragment>",
      );
  };
  material.customProgramCacheKey = () => "arena-neon-body";

  const mesh = new SkinnedMesh(merged, material);
  mesh.name = "CharacterBody";
  mesh.frustumCulled = false;
  first.parent?.add(mesh);
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const m of parts) {
    m.removeFromParent();
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  }

  const trim = new Color(TRIM);
  const danger = new Color(DANGER);
  let rimOn = true;
  return {
    mesh,
    material,
    setDanger(k: number) {
      uniforms.uTrim.value.copy(trim).lerp(danger, k);
      uniforms.uRim.value.copy(uniforms.uTrim.value);
    },
    setVisor(k: number) {
      uniforms.uVisorK.value = 2.6 * k;
    },
    setRim(on: boolean) {
      if (on === rimOn) return;
      rimOn = on;
      uniforms.uRimK.value = on ? 0.9 : 0;
    },
  };
}
