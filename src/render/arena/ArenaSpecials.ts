// Fun-pass world props that are not bombs (fun spec 2.1, 2.5, 2.6, 8):
//   pickups  - hex tokens (1 instanced draw) spinning 90 deg/s and bobbing,
//              kind icons + lock glyphs (shared AtlasSprites), additive
//              beacons (1 instanced draw, off on the low tier); locked = dim
//              + lock, blinking = 4 Hz; the engine flies them along the arc;
//   boss     - the CORE WARDEN core (1 draw: dark metal, scrolling energy
//              bands + fresnel in the weak colour, next colour flickering on
//              the rim, danger red in phase 3, white hit flash), its energy
//              shell (1 draw, wire + fresnel, additive) and the shield orbit
//              decal (1 draw); attack telegraph = the core swells and glows;
//              defeat = implode 1 -> 0.7 over 150 ms, then gone;
//   ribbons  - lightning arcs (jagged, flickering, one per chain hop) and
//              the roll trail in the trim colour: one additive camera-facing
//              ribbon draw;
//   stun     - 3 gold stars orbiting over the helmet while stunned.
// World units. Fixed pools, no allocation per frame.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, IcosahedronGeometry,
  InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RingGeometry, ShaderMaterial, SphereGeometry,
  Vector3,
} from "three";
import type { ArenaEngine } from "../../game/arena";
import type { PickupKind } from "../../game/arena/funTypes";
import { bombGlow, colorAt, HEX } from "../three/palette";
import { AtlasSprites } from "./AtlasSprites";
import { U } from "./ArenaBombs";
import type { QuadSink } from "../three/fx/SpriteBatch";
import { CELL } from "./funAtlas";

export const PICKUP_HEX: Record<PickupKind, string> = { rainbow: "#FF3DCB", mega: "#FFD23F", freeze: "#CFF4FF", lightning: "#FFF36B" };
export const PICKUP_CELL: Record<PickupKind, number> = { rainbow: CELL.rainbow, mega: CELL.mega, freeze: CELL.freeze, lightning: CELL.lightning };
const PICKUP_CAP = 4;
const ARC_CAP = 28;
const ARC_SEGS = 7;
const TRAIL = 20;
const QUADS = ARC_CAP * ARC_SEGS + TRAIL;
const DANGER = new Color(HEX.danger);
const WHITE = new Color(1, 1, 1);
const GOLD = new Color(HEX.gold);

// rainbow: hue through the 6 bomb glows, `period` s per cycle
export function rainbowAt(t: number, out: Color, period = 1.2) {
  const f = (((t / period) % 1) + 1) % 1 * 6;
  const i = Math.floor(f);
  return out.copy(colorAt(bombGlow, i)).lerp(colorAt(bombGlow, i + 1), f - i);
}

export function pickupColor(kind: PickupKind, t: number, out: Color) {
  if (kind === "rainbow") return rainbowAt(t, out);
  out.set(PICKUP_HEX[kind]);
  if (kind === "mega") out.multiplyScalar(0.8 + 0.2 * Math.sin(t * Math.PI * 4));
  if (kind === "lightning") out.multiplyScalar(Math.sin(t * Math.PI * 20) > -0.3 ? 1 : 0.6);
  return out;
}

const BEACON_VERT = /* glsl */ `
varying float vH;
varying vec3 vCol;
void main() {
  vH = uv.y;
  vCol = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BEACON_FRAG = /* glsl */ `
varying float vH;
varying vec3 vCol;
void main() {
  float a = (1.0 - vH) * (1.0 - vH) * 0.35 + 0.05 * (1.0 - vH);
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <colorspace_fragment>
}`;

const SHELL_VERT = /* glsl */ `
attribute vec3 aBary;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vV;
void main() {
  vBary = aBary;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vBary;
varying vec3 vN;
varying vec3 vV;
void main() {
  float e = min(min(vBary.x, vBary.y), vBary.z);
  float wire = 1.0 - smoothstep(0.0, 0.06, e);
  float fres = pow(1.0 - abs(dot(vN, vV)), 2.5);
  float a = (wire * 0.55 + fres * 0.6) * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const ORBIT_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ORBIT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uOffset;
uniform float uR;
varying vec2 vP;
void main() {
  float a = atan(vP.y, vP.x) - uOffset;
  float dash = step(0.45, fract(a / 6.2831853 * 24.0));
  float d = abs(length(vP) - uR) / 0.09;
  float k = exp(-d * d * 2.0) * (0.35 + 0.65 * dash) * uAlpha;
  gl_FragColor = vec4(uColor * k, 1.0);
  #include <colorspace_fragment>
}`;

const RIBBON_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vCol;
varying float vV;
void main() { vCol = color; vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIBBON_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vV;
void main() {
  float x = abs(vV * 2.0 - 1.0);
  float k = (1.0 - smoothstep(0.25, 1.0, x)) + (1.0 - smoothstep(0.0, 0.25, x)) * 0.8;
  gl_FragColor = vec4(vCol * k, 1.0);
  #include <colorspace_fragment>
}`;

interface Arc { on: boolean; t0: number; life: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; col: Color; seed: number; w: number }

function withBary(g: BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  const count = n.getAttribute("position").count;
  const b = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) b[i * 3 + (i % 3)] = 1;
  n.setAttribute("aBary", new BufferAttribute(b, 3));
  return n;
}

export class ArenaSpecials {
  readonly group = new Group();
  // pickups
  private readonly tokens: InstancedMesh;
  private readonly beacons: InstancedMesh;
  // boss
  private readonly core: Mesh;
  private readonly coreU = {
    uWeak: { value: new Color() }, uNext: { value: new Color() }, uFlick: { value: 0 }, uPulse: { value: 1 }, uHit: { value: 0 },
    uTime: { value: 0 }, uIce: { value: 0 },
  };
  private readonly shell: Mesh;
  private readonly shellMat: ShaderMaterial;
  private readonly orbit: Mesh;
  private readonly orbitMat: ShaderMaterial;
  bossHit = 0; // 0..1 white flash (ArenaFx sets 1 on bossHit)
  bossWeakHit = 0;
  bossTelegraph = 0; // 0..1 attack charge
  defeatT = -1; // s since bossDefeated (-1 = alive)
  private orbitOffset = 0;
  // ribbons
  private readonly ribbonGeo = new BufferGeometry();
  private readonly ribbon: Mesh;
  private readonly rPos = new Float32Array(QUADS * 4 * 3);
  private readonly rCol = new Float32Array(QUADS * 4 * 3);
  private nQuads = 0;
  private readonly arcs: Arc[] = Array.from({ length: ARC_CAP }, () => ({
    on: false, t0: 0, life: 0, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, col: new Color(), seed: 0, w: 0.12,
  }));
  private readonly trail = Array.from({ length: TRAIL }, () => ({ x: 0, y: 0, z: 0, t: -99 }));
  private trailHead = 0;
  readonly trailColor = new Color(HEX.cyan);
  // scratch
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly side = new Vector3();
  private readonly cam = new Vector3();
  private readonly col = new Color();
  private readonly col2 = new Color();
  private t = 0;

  // glow: the additive billboard batch in the FX space (Classic units, x U)
  constructor(private readonly sprites: AtlasSprites, private readonly glow: QuadSink | null = null) {
    // hex token: an upright hex coin (faces +-Z), emissive in its colour
    const coin = new CylinderGeometry(0.32, 0.32, 0.12, 6);
    coin.rotateX(Math.PI / 2);
    const tokenMat = new MeshStandardMaterial({ color: "#ffffff", metalness: 0.2, roughness: 0.35 });
    tokenMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vColor.rgb * 1.25;\n#endif",
      );
    };
    tokenMat.customProgramCacheKey = () => "arena-token";
    this.tokens = new InstancedMesh(coin, tokenMat, PICKUP_CAP);
    this.tokens.instanceColor = new InstancedBufferAttribute(new Float32Array(PICKUP_CAP * 3), 3).setUsage(DynamicDrawUsage);
    const beam = new CylinderGeometry(0.06, 0.06, 3, 8, 1, true);
    beam.translate(0, 1.5, 0);
    this.beacons = new InstancedMesh(
      beam,
      new ShaderMaterial({ vertexShader: BEACON_VERT, fragmentShader: BEACON_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
      PICKUP_CAP,
    );
    this.beacons.instanceColor = new InstancedBufferAttribute(new Float32Array(PICKUP_CAP * 3), 3).setUsage(DynamicDrawUsage);
    this.beacons.renderOrder = 11;
    for (const im of [this.tokens, this.beacons]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
    }

    // boss core
    const coreMat = new MeshStandardMaterial({ color: "#2A1B4E", metalness: 0.6, roughness: 0.3 });
    const u = this.coreU;
    coreMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjN = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uWeak;\nuniform vec3 uNext;\nuniform float uFlick;\nuniform float uPulse;\nuniform float uHit;\nuniform float uTime;\nuniform float uIce;\nvarying vec3 vObjN;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
float lat = abs(sin(vObjN.y * 7.0 - uTime * 1.6));
float lon = abs(sin(atan(vObjN.z, vObjN.x) * 6.0 + uTime * 0.7));
float lines = max(smoothstep(0.9, 1.0, lat), smoothstep(0.94, 1.0, lon) * 0.7);
float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
vec3 weakC = mix(uWeak, uNext, uFlick * step(0.55, fres));
vec3 glowC = mix(weakC, vec3(0.81, 0.96, 1.0), uIce * 0.6);
totalEmissiveRadiance += glowC * (0.1 + 0.85 * lines + 1.1 * fres) * uPulse + vec3(uHit * 1.8);`,
        );
    };
    coreMat.customProgramCacheKey = () => "arena-boss-core";
    this.core = new Mesh(new SphereGeometry(1, 32, 24), coreMat);
    this.shellMat = new ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color() }, uAlpha: { value: 1 } },
    });
    this.shell = new Mesh(withBary(new IcosahedronGeometry(1, 1)), this.shellMat);
    this.shell.renderOrder = 8;
    const ring = new RingGeometry(1.9, 2.7, 96, 1);
    ring.rotateX(-Math.PI / 2);
    this.orbitMat = new ShaderMaterial({
      vertexShader: ORBIT_VERT, fragmentShader: ORBIT_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0.5 }, uOffset: { value: 0 }, uR: { value: 2.3 } },
    });
    this.orbit = new Mesh(ring, this.orbitMat);
    this.orbit.renderOrder = 4;
    for (const m of [this.core, this.shell, this.orbit]) {
      m.frustumCulled = false;
      m.visible = false;
    }

    // ribbons
    this.ribbonGeo.setAttribute("position", new BufferAttribute(this.rPos, 3).setUsage(DynamicDrawUsage));
    this.ribbonGeo.setAttribute("color", new BufferAttribute(this.rCol, 3).setUsage(DynamicDrawUsage));
    const uv = new Float32Array(QUADS * 4 * 2);
    const index: number[] = [];
    for (let i = 0; i < QUADS; i++) {
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8);
      const v = i * 4;
      index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    this.ribbonGeo.setAttribute("uv", new BufferAttribute(uv, 2));
    this.ribbonGeo.setIndex(index);
    this.ribbon = new Mesh(
      this.ribbonGeo,
      new ShaderMaterial({
        vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      }),
    );
    (this.ribbon.material as ShaderMaterial).forceSinglePass = true;
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 12;
    this.group.add(this.beacons, this.tokens, this.orbit, this.core, this.shell, this.ribbon);
  }

  // ---- events -> pools ----------------------------------------------------------

  // A lightning arc from a to b (world), appearing at `delay` s.
  arc(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: Color, delay: number, life = 0.28, w = 0.14) {
    let slot = this.arcs.find((a) => !a.on);
    if (!slot) slot = this.arcs.reduce((m, a) => (a.t0 < m.t0 ? a : m), this.arcs[0]);
    Object.assign(slot, { on: true, t0: this.t + delay, life, x0, y0, z0, x1, y1, z1, seed: Math.random() * 100, w });
    slot.col.copy(col);
  }

  trailPoint(x: number, y: number, z: number) {
    const p = this.trail[this.trailHead];
    p.x = x; p.y = y; p.z = z; p.t = this.t;
    this.trailHead = (this.trailHead + 1) % TRAIL;
  }

  reset() {
    for (const a of this.arcs) a.on = false;
    for (const p of this.trail) p.t = -99;
    this.bossHit = this.bossWeakHit = this.bossTelegraph = 0;
    this.defeatT = -1;
  }

  // ---- per frame ---------------------------------------------------------------

  frame(e: ArenaEngine, o: { t: number; dt: number; low: boolean; still: boolean; camX: number; camY: number; camZ: number; ice: number; head: Vector3; stun: number }) {
    this.t += o.dt;
    this.cam.set(o.camX, o.camY, o.camZ);
    this.pickups(e, o.t, o.low, o.still);
    this.boss(e, o.t, o.dt, o.still, o.ice);
    this.nQuads = 0;
    this.arcsFrame(o.low);
    this.trailFrame();
    this.ribbonEnd();
    if (o.stun > 0) {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (o.still ? 0 : o.t * 5) + (i / n) * Math.PI * 2;
        this.sprites.add(o.head.x + Math.cos(a) * 0.32, o.head.y + 0.42 + Math.sin(a * 2) * 0.04, o.head.z + Math.sin(a) * 0.32, 0.26, CELL.star, GOLD, Math.min(1, o.stun / 0.15), a);
      }
    }
  }

  private pickups(e: ArenaEngine, t: number, low: boolean, still: boolean) {
    let n = 0;
    for (const p of e.getPickups()) {
      if (n >= PICKUP_CAP) break;
      const ground = p.state !== "flying";
      const blink = p.state === "blinking" ? (Math.floor(t * 8) % 2 === 0 ? 1 : 0.3) : 1;
      const alpha = (p.locked ? 0.5 : 1) * blink;
      const bob = ground && !still ? Math.sin(t * Math.PI * 2 * 1.2 + p.id) * 0.08 : 0;
      const spin = still ? 0 : t * (Math.PI / 2) + p.id;
      // grows in over its first 0.15 s of flight
      const grow = p.state === "flying" ? Math.min(1, 0.4 + p.age / 0.15) : 1;
      pickupColor(p.kind, t, this.col);
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), spin);
      this.m.compose(this.a.set(p.x, p.y + bob, p.z), this.q, this.s.setScalar(grow));
      this.tokens.setMatrixAt(n, this.m);
      this.tokens.setColorAt(n, this.col2.copy(this.col).multiplyScalar(p.locked ? 0.35 : blink));
      this.sprites.add(p.x, p.y + bob, p.z, 0.4 * grow, PICKUP_CELL[p.kind], WHITE, alpha);
      // soft halo behind the token so it reads as a power-up from afar
      this.glow?.add(p.x * U, (p.y + bob) * U, p.z * U, 1.5 * U * grow, 1.5 * U * grow, this.col, 0.7 * alpha);
      if (p.locked) this.sprites.add(p.x, p.y + bob + 0.5, p.z, 0.3, CELL.lock, WHITE, 0.9);
      // beacon (ground only, not on the low tier)
      this.m.compose(this.a.set(p.x, 0.05, p.z), this.q.identity(), this.s.set(1, ground && !low ? 1 : 0.0001, 1));
      this.beacons.setMatrixAt(n, this.m);
      this.beacons.setColorAt(n, this.col2.copy(this.col).multiplyScalar(alpha));
      n++;
    }
    this.tokens.count = n;
    this.beacons.count = low ? 0 : n;
    for (const im of [this.tokens, this.beacons]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private boss(e: ArenaEngine, t: number, dt: number, still: boolean, ice: number) {
    const st = e.getBoss();
    if (this.defeatT >= 0) this.defeatT += dt;
    const show = st !== null && (this.defeatT < 0 || this.defeatT < 0.22);
    this.core.visible = this.shell.visible = show;
    this.orbit.visible = show && st !== null && st.phase < 3 && st.shield.length > 0;
    if (!st || !show) return;
    const u = this.coreU;
    const p3 = st.phase === 3;
    u.uWeak.value.copy(p3 ? DANGER : colorAt(bombGlow, st.weakColor));
    u.uNext.value.copy(colorAt(bombGlow, st.nextWeakColor));
    u.uFlick.value = !p3 && st.weakIn <= 1 ? (Math.floor(t * 10) % 2 === 0 ? 1 : 0) : 0;
    const beat = still ? 0 : Math.sin(t * Math.PI * 2 * (p3 ? 2.6 : 0.9));
    this.bossTelegraph = Math.max(0, this.bossTelegraph);
    u.uPulse.value = 1 + 0.25 * beat + 1.4 * this.bossTelegraph;
    this.bossHit = Math.max(0, this.bossHit - dt / 0.15);
    this.bossWeakHit = Math.max(0, this.bossWeakHit - dt / 0.3);
    u.uHit.value = Math.max(this.bossHit, st.invulnerable ? (Math.floor(t * 12) % 2) * 0.35 : 0);
    u.uTime.value = still ? 0 : t;
    u.uIce.value = ice;
    // implode on defeat, swell while charging an attack, punch on a hit
    let scale = st.r * (1 + 0.06 * this.bossTelegraph + 0.08 * this.bossWeakHit + 0.04 * this.bossHit);
    if (this.defeatT >= 0) scale = st.r * (1 - 0.3 * Math.min(1, this.defeatT / 0.15));
    this.core.position.set(st.x, st.r, st.z);
    this.core.scale.setScalar(scale);
    this.core.rotation.y = still ? 0 : t * 0.25;
    this.shell.position.copy(this.core.position);
    this.shell.scale.setScalar(scale * (1.22 + (still ? 0 : 0.02 * beat)));
    this.shell.rotation.set(still ? 0 : t * 0.3, still ? 0 : -t * 0.45, 0);
    const sc = this.shellMat.uniforms.uColor.value as Color;
    sc.copy(p3 ? DANGER : colorAt(bombGlow, st.weakColor));
    if (st.invulnerable) sc.lerp(WHITE, 0.7);
    this.shellMat.uniforms.uAlpha.value = (p3 ? 1.1 : 0.75) + 0.6 * this.bossTelegraph + 0.8 * this.bossHit;
    // shield orbit decal follows the orbit
    this.orbitOffset += st.orbitSpeed * dt;
    this.orbit.position.set(st.x, 0.08, st.z);
    this.orbitMat.uniforms.uOffset.value = this.orbitOffset;
    this.orbitMat.uniforms.uR.value = st.shieldRadius;
    (this.orbitMat.uniforms.uColor.value as Color).copy(colorAt(bombGlow, st.weakColor)).lerp(WHITE, 0.5);
    this.orbitMat.uniforms.uAlpha.value = 0.55;
  }

  // ---- ribbons -----------------------------------------------------------------

  private quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, wa: number, wb: number, col: Color, ka: number, kb: number) {
    if (this.nQuads >= QUADS) return;
    this.a.set(ax, ay, az);
    this.b.set(bx, by, bz);
    this.side.subVectors(this.b, this.a).cross(this.v.subVectors(this.cam, this.a)).normalize();
    const i = this.nQuads++ * 4;
    const P = this.rPos, C = this.rCol, sx = this.side.x, sy = this.side.y, sz = this.side.z;
    P[i * 3] = ax - sx * wa; P[i * 3 + 1] = ay - sy * wa; P[i * 3 + 2] = az - sz * wa;
    P[i * 3 + 3] = ax + sx * wa; P[i * 3 + 4] = ay + sy * wa; P[i * 3 + 5] = az + sz * wa;
    P[i * 3 + 6] = bx - sx * wb; P[i * 3 + 7] = by - sy * wb; P[i * 3 + 8] = bz - sz * wb;
    P[i * 3 + 9] = bx + sx * wb; P[i * 3 + 10] = by + sy * wb; P[i * 3 + 11] = bz + sz * wb;
    for (let k = 0; k < 4; k++) {
      const kk = k < 2 ? ka : kb;
      C[(i + k) * 3] = col.r * kk; C[(i + k) * 3 + 1] = col.g * kk; C[(i + k) * 3 + 2] = col.b * kk;
    }
  }

  private arcsFrame(low: boolean) {
    for (const a of this.arcs) {
      if (!a.on) continue;
      const age = this.t - a.t0;
      if (age < 0) continue;
      if (age > a.life) {
        a.on = false;
        continue;
      }
      const k = 1 - age / a.life;
      // re-jag at 20 Hz: a flickering bolt
      const seed = a.seed + Math.floor(this.t * 20) * 7.31;
      const dx = a.x1 - a.x0, dy = a.y1 - a.y0, dz = a.z1 - a.z0;
      const len = Math.hypot(dx, dy, dz) || 1;
      const amp = Math.min(0.45, len * 0.12);
      let px = a.x0, py = a.y0, pz = a.z0;
      for (let s = 1; s <= ARC_SEGS; s++) {
        const f = s / ARC_SEGS;
        const j = s === ARC_SEGS ? 0 : 1;
        const h1 = Math.sin(seed * 12.9898 + s * 78.233) * 43758.5453;
        const h2 = Math.sin(seed * 39.3468 + s * 11.135) * 24634.6345;
        const nx = a.x0 + dx * f + (h1 - Math.floor(h1) - 0.5) * 2 * amp * j;
        const ny = a.y0 + dy * f + (h2 - Math.floor(h2) - 0.5) * 1.2 * amp * j;
        const nz = a.z0 + dz * f + (h2 - Math.floor(h2) - 0.5) * 2 * amp * j;
        const w = a.w * (low ? 0.7 : 1);
        this.quad(px, py, pz, nx, ny, nz, w, w, a.col, k * 1.6, k * 1.6);
        px = nx; py = ny; pz = nz;
      }
    }
  }

  private trailFrame() {
    // newest first; quads between consecutive samples younger than 0.3 s
    let prev = -1;
    for (let n = 0; n < TRAIL; n++) {
      const i = (this.trailHead - 1 - n + TRAIL * 2) % TRAIL;
      const p = this.trail[i];
      const age = this.t - p.t;
      if (age > 0.3) break;
      if (prev >= 0) {
        const q = this.trail[prev];
        const ka = 1 - (this.t - q.t) / 0.3, kb = 1 - age / 0.3;
        this.quad(q.x, q.y, q.z, p.x, p.y, p.z, 0.42 * ka, 0.42 * kb, this.trailColor, ka * 0.9, kb * 0.9);
      }
      prev = i;
    }
  }

  private ribbonEnd() {
    this.ribbonGeo.setDrawRange(0, this.nQuads * 6);
    this.ribbon.visible = this.nQuads > 0;
    for (const name of ["position", "color"]) {
      const at = this.ribbonGeo.getAttribute(name) as BufferAttribute;
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.nQuads * 12);
      at.needsUpdate = true;
    }
  }

  dispose() {
    for (const im of [this.tokens, this.beacons]) {
      im.geometry.dispose();
      (im.material as MeshStandardMaterial).dispose();
      im.dispose();
    }
    for (const m of [this.core, this.shell, this.orbit, this.ribbon]) {
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
  }
}
