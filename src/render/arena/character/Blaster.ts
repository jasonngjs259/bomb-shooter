// Arm-cannon gauntlet and back canister (character spec section 1), each
// one draw: primitives merged with vertex colours; verts flagged aGlow take
// a uniform glow colour (muzzle ring = current bomb, canister rings = next
// bomb). Built in metres; the barrel runs along +Z, its top is +Y. The
// sleeve swallows the hand, so no grip pose is needed on any rig.
// Skins (fun pass): verts tagged aTint 1 (body) / 2 (stripes) take the
// uBody / uStripe colours, so the Hangar cannon recolours them in place.

import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const BARREL_TIP = 0.44; // muzzle z in blaster space
export const CANNON_BODY = "#3D3270"; // a step lighter than the spec #2A2340 so the cannon reads on the dark disc
export const CANNON_STRIPE = "#7C5CFF";
const BODY = CANNON_BODY;
const STRIPE = CANNON_STRIPE;
const PLATE = "#DCD6F7";

function part(geo: BufferGeometry, color: string, glow: number, tint = color === BODY ? 1 : color === STRIPE ? 2 : 0) {
  geo.deleteAttribute("uv");
  const n = geo.getAttribute("position").count;
  const c = new Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(n).fill(glow), 1));
  geo.setAttribute("aTint", new Float32BufferAttribute(new Float32Array(n).fill(tint), 1));
  return geo;
}

// Standard material whose aGlow verts render as uGlow (emissive x k).
function glowMaterial(k: number) {
  const uGlow = { value: new Color("#22F2FF") };
  const uBody = { value: new Color(BODY) };
  const uStripe = { value: new Color(STRIPE) };
  const mat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.38 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = uGlow;
    shader.uniforms.uBody = uBody;
    shader.uniforms.uStripe = uStripe;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nattribute float aTint;\nvarying float vGlow;\nvarying float vTint;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;\nvTint = aTint;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uGlow;\nuniform vec3 uBody;\nuniform vec3 uStripe;\nvarying float vGlow;\nvarying float vTint;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uBody, step(0.5, vTint) * step(vTint, 1.5));
diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, step(1.5, vTint));
totalEmissiveRadiance += uStripe * 0.35 * step(1.5, vTint);
diffuseColor.rgb = mix(diffuseColor.rgb, uGlow, vGlow);
totalEmissiveRadiance += uGlow * ${k.toFixed(2)} * vGlow;`,
      );
  };
  mat.customProgramCacheKey = () => `arena-glow-${k}`;
  return { mat, uGlow, uBody, uStripe };
}

const along = (g: BufferGeometry, z: number) => g.rotateX(Math.PI / 2).translate(0, 0, z);

export class Blaster {
  readonly group = new Group(); // attach to the hand socket
  readonly slide = new Group(); // recoil slides this back along -Z
  readonly muzzleTip = new Object3D();
  readonly cradle = new Object3D(); // current bomb, seated in the muzzle
  private readonly mesh: Mesh;
  private readonly glow: { value: Color };
  private readonly body: { value: Color };
  private readonly stripe: { value: Color };

  constructor() {
    const geo = mergeGeometries([
      part(along(new CylinderGeometry(0.09, 0.085, 0.24, 14, 1), 0.04), BODY, 0), // sleeve over the hand
      part(along(new CylinderGeometry(0.08, 0.066, BARREL_TIP - 0.12, 14, 1), (BARREL_TIP + 0.12) / 2), BODY, 0),
      part(along(new CylinderGeometry(0.094, 0.094, 0.025, 14, 1), 0.2), STRIPE, 0),
      part(along(new CylinderGeometry(0.09, 0.09, 0.025, 14, 1), 0.3), STRIPE, 0),
      part(new BoxGeometry(0.035, 0.05, 0.2).translate(0, 0.095, 0.12), PLATE, 0), // top rail
      part(new TorusGeometry(0.085, 0.02, 8, 20).translate(0, 0, BARREL_TIP), BODY, 1), // muzzle ring
    ]);
    if (!geo) throw new Error("blaster: merge failed");
    const { mat, uGlow, uBody, uStripe } = glowMaterial(2.2);
    this.glow = uGlow;
    this.body = uBody;
    this.stripe = uStripe;
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.muzzleTip.position.set(0, 0, BARREL_TIP);
    this.cradle.position.set(0, 0, BARREL_TIP - 0.04);
    this.slide.add(this.mesh, this.muzzleTip, this.cradle);
    this.group.add(this.slide);
  }

  setGlow(c: Color) {
    this.glow.value.copy(c);
  }

  // Cannon skin: barrel body + stripes.
  setSkin(body: Color, stripe: Color) {
    this.body.value.copy(body);
    this.stripe.value.copy(stripe);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}

// Open glass canister on the upper back for the next bomb: two glowing
// rings + three struts around the seat at the origin (y up).
export class Canister {
  readonly group = new Group();
  readonly seat = new Object3D();
  private readonly mesh: Mesh;
  private readonly glow: { value: Color };

  constructor() {
    const parts: BufferGeometry[] = [
      part(new TorusGeometry(0.17, 0.016, 6, 22).rotateX(Math.PI / 2).translate(0, 0.12, 0), BODY, 1),
      part(new TorusGeometry(0.17, 0.016, 6, 22).rotateX(Math.PI / 2).translate(0, -0.12, 0), BODY, 1),
    ];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      parts.push(part(new CylinderGeometry(0.012, 0.012, 0.24, 5).translate(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17), BODY, 0));
    }
    const geo = mergeGeometries(parts);
    if (!geo) throw new Error("canister: merge failed");
    const { mat, uGlow } = glowMaterial(2.0);
    this.glow = uGlow;
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh, this.seat);
  }

  setGlow(c: Color) {
    this.glow.value.copy(c);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
