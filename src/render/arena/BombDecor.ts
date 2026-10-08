// Special-bomb decorations (fun spec 2.3), each one instanced draw, fed from
// the ArenaBombs loop so every bomb is visited once per frame:
//   cages  - armored bombs while armor === 1: a gunmetal icosahedron cage
//            (x1.12, 30 bars + 4 rivets) that rides the bomb's wobble;
//   dials  - ticking bombs: a camera-facing countdown ring (lit arc = time
//            left, white -> danger red at <= 5 s, 2 Hz blink) plus the digits
//            in the shared AtlasSprites batch;
//   treads - roller bombs (in the wall and rolling): a slim dark tyre band with
//            8 spiky studs around the axle, glowing orange only while telegraphing.
// World units. No allocation per frame.

import {
  BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Euler, IcosahedronGeometry, InstancedBufferAttribute,
  InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Quaternion,
  ShaderMaterial, TorusGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AtlasSprites } from "./AtlasSprites";
import { CELL } from "./funAtlas";

const R = 0.45; // bomb radius (w)
const CAGE_CAP = 24;
const DIAL_CAP = 8;
const TREAD_CAP = 10;
const EULER = new Euler();
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);

function cageGeometry() {
  const ico = new IcosahedronGeometry(R * 1.12, 0);
  const pos = ico.getAttribute("position");
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i);
    if (!pts.some((p) => p.distanceToSquared(v) < 1e-6)) pts.push(v);
  }
  const edge = pts[0].distanceTo(pts.reduce((m, p) => (p !== pts[0] && (m === pts[0] || p.distanceTo(pts[0]) < m.distanceTo(pts[0])) ? p : m), pts[0]));
  const parts: BufferGeometry[] = [];
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const len = a.distanceTo(b);
      if (Math.abs(len - edge) > 1e-3) continue;
      const bar = new CylinderGeometry(0.028, 0.028, len, 3, 1, true);
      q.setFromUnitVectors(up, b.clone().sub(a).normalize());
      bar.applyQuaternion(q);
      const m = a.clone().add(b).multiplyScalar(0.5);
      bar.translate(m.x, m.y, m.z);
      parts.push(ni(bar));
    }
  }
  // 4 rivets on the equator
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const r = new OctahedronGeometry(0.06, 0);
    r.translate(Math.cos(a) * R * 1.1, 0, Math.sin(a) * R * 1.1);
    parts.push(ni(r));
  }
  for (const p of parts) p.deleteAttribute("uv");
  const g = mergeGeometries(parts) ?? new BufferGeometry();
  parts.forEach((p) => p.dispose());
  ico.dispose();
  g.computeVertexNormals();
  return g;
}

// A slim dark tyre hugging the equator + 8 spiky studs pointing out: reads as
// a spiked rolling bomb from any angle (the bomb colour stays dominant; an
// edge-on view shows a thin dark seam, not a pale stripe).
function treadGeometry() {
  const band = new TorusGeometry(R * 1.01, 0.06, 6, 28); // axis = local Z
  band.deleteAttribute("uv");
  const parts: BufferGeometry[] = [ni(band)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const s = new CylinderGeometry(0.0, 0.07, 0.17, 6); // cone, tip outward
    s.rotateZ(-Math.PI / 2);
    s.rotateZ(a);
    s.translate(Math.cos(a) * (R + 0.1), Math.sin(a) * (R + 0.1), 0);
    s.deleteAttribute("uv");
    parts.push(ni(s));
  }
  const g = mergeGeometries(parts) ?? new BufferGeometry();
  parts.forEach((p) => p.dispose());
  band.dispose();
  return g;
}

// emissive = instance colour x k (cages: cool sheen + white ping; treads: glow)
const glowStd = (opts: ConstructorParameters<typeof MeshStandardMaterial>[0], key: string, k: number) => {
  const m = new MeshStandardMaterial(opts);
  m.onBeforeCompile = (shader) => {
    // the instance colour drives the emissive only (not the diffuse)
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "").replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vColor.rgb * ${k.toFixed(2)};\n#endif`,
    );
  };
  m.customProgramCacheKey = () => key;
  return m;
};

const DIAL_VERT = /* glsl */ `
attribute vec4 aCentre; // xyz, size
attribute vec4 aDial; // progress 0..1, red 0..1, alpha, armed
varying vec2 vP;
varying vec4 vDial;
void main() {
  vP = position.xy * 2.0;
  vDial = aDial;
  vec4 mv = modelViewMatrix * vec4(aCentre.xyz, 1.0);
  mv.xyz += normalize(-mv.xyz) * 0.5; // in front of the bomb
  mv.xy += position.xy * aCentre.w;
  gl_Position = projectionMatrix * mv;
}`;
const DIAL_FRAG = /* glsl */ `
varying vec2 vP;
varying vec4 vDial;
void main() {
  float r = length(vP);
  float ring = smoothstep(0.74, 0.79, r) * (1.0 - smoothstep(0.93, 0.98, r));
  if (ring < 0.01) discard;
  float a = atan(vP.x, vP.y); // 0 = up, clockwise
  if (a < 0.0) a += 6.2831853;
  float lit = step(a / 6.2831853, vDial.x);
  float ticks = step(0.82, fract(a / 6.2831853 * 20.0)); // 20 tick notches
  vec3 white = vec3(1.0, 0.97, 0.9);
  vec3 red = vec3(1.0, 0.18, 0.33);
  vec3 col = mix(white, red, vDial.y);
  float k = mix(0.22, 1.0, lit) * (1.0 - 0.35 * ticks * lit);
  gl_FragColor = vec4(mix(vec3(0.08, 0.03, 0.15), col, k), ring * vDial.z);
  #include <colorspace_fragment>
}`;

export class BombDecor {
  readonly cages: InstancedMesh;
  readonly treads: InstancedMesh;
  readonly dials: Mesh;
  private nCage = 0;
  private nTread = 0;
  private nDial = 0;
  private readonly dialCentre = new Float32Array(DIAL_CAP * 4);
  private readonly dialData = new Float32Array(DIAL_CAP * 4);
  private readonly dialGeo = new InstancedBufferGeometry();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly c = new Color();
  private readonly digit = new Color();
  private readonly treadIdle = new Color(0.06, 0.05, 0.1);
  private readonly treadHot = new Color("#FF8A3D");
  private readonly cageTint = new Color(0.1, 0.11, 0.17);
  private readonly cageFlash = new Color(0.9, 0.95, 1.0);
  digitRate = 60; // Hz the digits refresh at (low tier: 15)
  private digitT = 0;
  private readonly digitCache = new Map<number, number>();

  constructor(private readonly sprites: AtlasSprites) {
    this.cages = new InstancedMesh(
      cageGeometry(),
      glowStd({ color: "#8B93B8", metalness: 0.55, roughness: 0.3 }, "arena-cage", 1),
      CAGE_CAP,
    );
    this.cages.instanceColor = new InstancedBufferAttribute(new Float32Array(CAGE_CAP * 3), 3).setUsage(DynamicDrawUsage);
    this.treads = new InstancedMesh(
      treadGeometry(),
      glowStd({ color: "#17121F", metalness: 0.6, roughness: 0.45 }, "arena-tread", 2.4),
      TREAD_CAP,
    );
    this.treads.instanceColor = new InstancedBufferAttribute(new Float32Array(TREAD_CAP * 3), 3).setUsage(DynamicDrawUsage);
    for (const im of [this.cages, this.treads]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
    }
    const plane = new PlaneGeometry(1, 1);
    this.dialGeo.index = plane.index;
    this.dialGeo.setAttribute("position", plane.getAttribute("position"));
    this.dialGeo.setAttribute("aCentre", new InstancedBufferAttribute(this.dialCentre, 4).setUsage(DynamicDrawUsage));
    this.dialGeo.setAttribute("aDial", new InstancedBufferAttribute(this.dialData, 4).setUsage(DynamicDrawUsage));
    this.dialGeo.instanceCount = 0;
    this.dials = new Mesh(this.dialGeo, new ShaderMaterial({ vertexShader: DIAL_VERT, fragmentShader: DIAL_FRAG, transparent: true, depthWrite: false }));
    this.dials.frustumCulled = false;
    this.dials.renderOrder = 13;
  }

  begin(dt: number) {
    this.nCage = this.nTread = this.nDial = 0;
    this.digitT += dt;
  }

  // flash: 0..1 white sheen (armor ping)
  cage(x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number, scale: number, flash: number) {
    if (this.nCage >= CAGE_CAP) return;
    this.q.setFromEuler(EULER.set(rotX, rotY + 0.3, rotZ));
    this.m.compose(this.v.set(x, y, z), this.q, this.s.setScalar(scale));
    this.cages.setMatrixAt(this.nCage, this.m);
    this.cages.setColorAt(this.nCage, this.c.copy(this.cageTint).lerp(this.cageFlash, flash));
    this.nCage++;
  }

  // q: the bomb's rotation (rollers: axle along local Z); glow 0..1
  tread(x: number, y: number, z: number, q: Quaternion, glow: number, scale = 1) {
    if (this.nTread >= TREAD_CAP) return;
    this.m.compose(this.v.set(x, y, z), q, this.s.setScalar(scale));
    this.treads.setMatrixAt(this.nTread, this.m);
    this.treads.setColorAt(this.nTread, this.c.copy(this.treadIdle).lerp(this.treadHot, glow));
    this.nTread++;
  }

  // Ticking bomb: timer s left of `full`; armed = counting down.
  dial(id: number, x: number, y: number, z: number, timer: number, full: number, armed: boolean, t: number, still: boolean) {
    if (this.nDial >= DIAL_CAP) return;
    const i = this.nDial++;
    const hot = armed && timer <= 5;
    const blink = hot && !still ? (Math.floor(t * 4) % 2 === 0 ? 1 : 0.65) : 1;
    this.dialCentre[i * 4] = x; this.dialCentre[i * 4 + 1] = y; this.dialCentre[i * 4 + 2] = z;
    this.dialCentre[i * 4 + 3] = armed ? (hot && !still ? 1.32 + 0.08 * Math.sin(t * Math.PI * 4) : 1.3) : 1.18;
    this.dialData[i * 4] = armed ? Math.max(0, Math.min(1, timer / full)) : 1;
    this.dialData[i * 4 + 1] = hot ? 1 : armed ? Math.max(0, 1 - (timer - 5) / 5) * 0.35 : 0;
    this.dialData[i * 4 + 2] = (armed ? 1 : 0.55) * blink;
    this.dialData[i * 4 + 3] = armed ? 1 : 0;
    if (!armed) return;
    // countdown digits (cached per id at the low-tier rate)
    let shown = this.digitCache.get(id);
    if (shown === undefined || this.digitT >= 1 / this.digitRate) shown = Math.max(0, Math.ceil(timer - 1e-3));
    this.digitCache.set(id, shown);
    this.digit.setRGB(1, 1, 1);
    if (hot) this.digit.setRGB(1, 0.32, 0.42);
    const size = hot ? 0.62 + (still ? 0 : 0.06 * Math.sin(t * Math.PI * 4)) : 0.5;
    const yy = y + 0.98;
    if (shown >= 10) {
      this.sprites.add(x, yy, z, size, CELL.digit0 + (Math.floor(shown / 10) % 10), this.digit, blink, 0, -size * 0.3);
      this.sprites.add(x, yy, z, size, CELL.digit0 + (shown % 10), this.digit, blink, 0, size * 0.3);
    } else {
      this.sprites.add(x, yy, z, size, CELL.digit0 + shown, this.digit, blink, 0);
    }
  }

  end() {
    if (this.digitT >= 1 / this.digitRate) this.digitT = 0;
    this.cages.count = this.nCage;
    this.treads.count = this.nTread;
    for (const im of [this.cages, this.treads]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.dialGeo.instanceCount = this.nDial;
    this.dials.visible = this.nDial > 0;
    for (const name of ["aCentre", "aDial"]) {
      const a = this.dialGeo.getAttribute(name) as InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.nDial * 4);
      a.needsUpdate = true;
    }
  }

  forget(id: number) {
    this.digitCache.delete(id);
  }

  dispose() {
    for (const im of [this.cages, this.treads]) {
      im.geometry.dispose();
      (im.material as MeshStandardMaterial).dispose();
      im.dispose();
    }
    this.dialGeo.dispose();
    (this.dials.material as ShaderMaterial).dispose();
  }
}
