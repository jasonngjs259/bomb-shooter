// Arena aim guide (spec section 5): a flat glowing ribbon from the launcher
// muzzle to the aim ray's end (segment A slants down to bomb height over the
// first 3.0 w, ~13 deg, and the character's barrel is aimed along it;
// segment B is flat), with marching dashes, a fade along its
// length and a faded tip on a miss; a ghost bomb at the landing point with a
// rotating dashed ring and a ground decal ring. World units.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry,
  ShaderMaterial, SphereGeometry, Vector3,
} from "three";
import type { AimRay } from "../../game/arena";

const VERT = /* glsl */ `
attribute vec2 aLine; // along (w), across (-1..1)
varying vec2 vLine;
void main() {
  vLine = aLine;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uLen;
uniform float uMiss;
uniform float uAlpha;
uniform float uWide;
varying vec2 vLine;
void main() {
  float x = abs(vLine.y);
  float core = 1.0 - smoothstep(0.18 * uWide, 0.26 * uWide, x);
  float halo = exp(-x * x * 5.0) * 0.45;
  float dash = step(fract((vLine.x - uTime * 2.0) / 0.5), 0.6);
  float a = mix(0.9, 0.35, clamp(vLine.x / max(uLen, 0.001), 0.0, 1.0));
  if (uMiss > 0.5) a *= 1.0 - smoothstep(uLen - 2.0, uLen, vLine.x);
  a *= (core * (0.35 + 0.65 * dash) + halo) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.5) * a, 1.0);
  #include <colorspace_fragment>
}`;

const DASH_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec3 vLocal;
void main() {
  float a = atan(vLocal.z, vLocal.x);
  if (fract(a / 6.2831853 * 12.0) > 0.55) discard;
  gl_FragColor = vec4(vec3(1.0), uAlpha);
}`;
const LOCAL_VERT = /* glsl */ `
varying vec3 vLocal;
void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const HALF = 0.11; // halo half width (core 0.05 w)
const BOMB_Y = 0.45;
export const SEG_A = 3.0; // w along the ray where the slant meets bomb height

// End of segment A (world): where the barrel points (character spec 4).
export function segmentAEnd(ray: AimRay, yaw: number, out: Vector3) {
  const len = Math.hypot(ray.to.x - ray.from.x, ray.to.z - ray.from.z);
  const a = Math.min(SEG_A, len);
  return out.set(ray.from.x + Math.cos(yaw) * a, BOMB_Y, ray.from.z + Math.sin(yaw) * a);
}

export class AimLaser {
  readonly group = new Group();
  private readonly pos = new Float32Array(6 * 3);
  private readonly line = new Float32Array(6 * 2);
  private readonly geo = new BufferGeometry();
  private readonly mat: ShaderMaterial;
  private readonly ghost: Mesh;
  private readonly ghostMat: MeshBasicMaterial;
  private readonly ring: Mesh;
  private readonly ringMat: ShaderMaterial;
  private readonly decal: Mesh;
  private readonly decalMat: MeshBasicMaterial;
  private readonly p1 = new Vector3();

  constructor() {
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aLine", new BufferAttribute(this.line, 2));
    this.geo.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new Color() }, uTime: { value: 0 }, uLen: { value: 1 }, uMiss: { value: 0 },
        uAlpha: { value: 1 }, uWide: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const laser = new Mesh(this.geo, this.mat);
    laser.frustumCulled = false;
    laser.renderOrder = 9;
    this.ghostMat = new MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
    this.ghost = new Mesh(new SphereGeometry(BOMB_Y, 20, 14), this.ghostMat);
    const rg = new RingGeometry(0.53, 0.57, 64);
    rg.rotateX(-Math.PI / 2);
    this.ringMat = new ShaderMaterial({
      vertexShader: LOCAL_VERT, fragmentShader: DASH_FRAG, uniforms: { uAlpha: { value: 0.6 } },
      transparent: true, depthWrite: false, side: DoubleSide,
    });
    this.ring = new Mesh(rg, this.ringMat);
    const dg = new RingGeometry(0.42, 0.5, 48);
    dg.rotateX(-Math.PI / 2);
    this.decalMat = new MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: AdditiveBlending });
    this.decal = new Mesh(dg, this.decalMat);
    this.group.add(laser, this.ghost, this.ring, this.decal);
  }

  // alpha: 0..1 fade (hidden while a shot flies); wide: tutorial highlight
  update(ray: AimRay, muzzle: Vector3, yaw: number, glow: Color, time: number, alpha: number, still: boolean, wide = 1) {
    this.group.visible = alpha > 0.01;
    if (!this.group.visible) return;
    const len = Math.hypot(ray.to.x - ray.from.x, ray.to.z - ray.from.z);
    const aLen = Math.min(SEG_A, len);
    segmentAEnd(ray, yaw, this.p1);
    const rx = -Math.sin(yaw); // right of the aim
    const rz = Math.cos(yaw);
    const w = HALF * wide;
    this.vert(0, muzzle.x, muzzle.y, muzzle.z, 0, rx, rz, w);
    this.vert(1, this.p1.x, this.p1.y, this.p1.z, aLen, rx, rz, w);
    this.vert(2, ray.to.x, BOMB_Y, ray.to.z, Math.max(len, aLen + 0.01), rx, rz, w);
    this.geo.getAttribute("position").needsUpdate = true;
    this.geo.getAttribute("aLine").needsUpdate = true;
    const u = this.mat.uniforms;
    (u.uColor.value as Color).copy(glow);
    u.uTime.value = still ? 0 : time;
    u.uLen.value = Math.max(len, 0.01);
    u.uMiss.value = ray.landing ? 0 : 1;
    u.uAlpha.value = alpha;
    u.uWide.value = 1;

    const land = ray.landing;
    this.ghost.visible = this.ring.visible = this.decal.visible = land !== null;
    if (land) {
      this.ghost.position.set(land.x, BOMB_Y, land.z);
      this.ghostMat.color.copy(glow);
      this.ghostMat.opacity = 0.35 * alpha;
      this.ring.position.set(land.x, BOMB_Y, land.z);
      this.ring.rotation.y = still ? 0 : (time / 6) * Math.PI * 2;
      this.ringMat.uniforms.uAlpha.value = 0.6 * alpha;
      this.decal.position.set(land.x, 0.075, land.z);
      this.decalMat.color.copy(glow);
      this.decalMat.opacity = 0.6 * alpha;
    }
  }

  // two ribbon verts (left / right edge) for point i
  private vert(i: number, x: number, y: number, z: number, along: number, rx: number, rz: number, w: number) {
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const v = i * 2 + s;
      this.pos[v * 3] = x + rx * w * side;
      this.pos[v * 3 + 1] = y;
      this.pos[v * 3 + 2] = z + rz * w * side;
      this.line[v * 2] = along;
      this.line[v * 2 + 1] = side;
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    for (const m of [this.ghost, this.ring, this.decal]) m.geometry.dispose();
    this.ghostMat.dispose();
    this.ringMat.dispose();
    this.decalMat.dispose();
  }
}
