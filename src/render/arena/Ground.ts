// Arena floor (spec section 4): a 120x120 ground plane with a world-space
// grid shader (brighter near the player, darker + red-washed outside the
// border = kill zone, distance fog), the arena disc with guide rings and a
// hex emblem, the neon border line + halo, and the 16-sector ground danger
// ring just outside the border. All units are world units (w).

import {
  AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry,
  ShaderMaterial, TorusGeometry, Vector3,
} from "three";
import { HEX, srgb } from "../three/palette";

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GROUND_FRAG = /* glsl */ `
uniform vec3 uPlayer;
uniform float uArenaR;
uniform float uPulse;
uniform float uLow;
uniform vec3 cNear, cFar, cFloor, cDanger, cFog;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  vec2 fw = max(fwidth(p), vec2(1e-4));
  vec2 g = (abs(fract(p - 0.5) - 0.5) - 0.015) / fw;
  float line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  float near = uLow > 0.5 ? 0.5 : 1.0 - smoothstep(3.0, 28.0, length(p - uPlayer.xz));
  float r = length(p);
  float outside = step(uArenaR, r);
  vec3 col = cFloor + mix(cFar, cNear, near) * line * mix(0.15, 0.6, near) * uPulse * mix(1.0, 0.7, outside);
  col += cDanger * 0.05 * outside * (1.0 - smoothstep(uArenaR, 18.0, r));
  float fd = length(vWorld - cameraPosition);
  col = mix(col, cFog, smoothstep(20.0, 55.0, fd));
  gl_FragColor = vec4(col, 1.0);
}`;

// Ring of 16 danger sectors; colour gold (0.4) -> red (>= 0.7), alpha
// 0.15 + 0.75 d, hidden below 0.2, 4 Hz strobe above 0.8, 2 deg feathering.
export const DANGER_RING_FRAG = /* glsl */ `
uniform float uDanger[16];
uniform float uTime;
uniform vec3 cGold, cDanger;
varying vec3 vLocal;
float dangerAt(float a) {
  float f = a / 6.2831853 * 16.0;
  float i = floor(f);
  float t = f - i;
  int i0 = int(mod(i, 16.0));
  int i1 = int(mod(i + 1.0, 16.0));
  int im = int(mod(i + 15.0, 16.0));
  float feather = 2.0 / 22.5;
  float d = uDanger[i0];
  if (t > 1.0 - feather) d = mix(d, uDanger[i1], (t - (1.0 - feather)) / feather * 0.5);
  if (t < feather) d = mix(d, uDanger[im], (feather - t) / feather * 0.5);
  return d;
}
void main() {
  float a = atan(vLocal.z, vLocal.x);
  if (a < 0.0) a += 6.2831853;
  float d = dangerAt(a);
  if (d < 0.2) discard;
  vec3 col = mix(cGold, cDanger, clamp((d - 0.4) / 0.3, 0.0, 1.0));
  float alpha = 0.15 + 0.75 * d;
  if (d > 0.8 && fract(uTime * 4.0) > 0.5) alpha *= 0.35;
  gl_FragColor = vec4(col, alpha);
}`;

export const LOCAL_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR;
varying vec3 vLocal;
void main() {
  float d = abs(length(vLocal.xz) - uR);
  float a = exp(-d * d / 0.03) * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export const makeDangerRingMaterial = () =>
  new ShaderMaterial({
    vertexShader: LOCAL_VERT,
    fragmentShader: DANGER_RING_FRAG,
    uniforms: {
      uDanger: { value: new Array<number>(16).fill(0) },
      uTime: { value: 0 },
      cGold: { value: srgb(HEX.gold) },
      cDanger: { value: srgb(HEX.danger) },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

const flat = <T extends RingGeometry | PlaneGeometry | TorusGeometry>(g: T) => {
  g.rotateX(-Math.PI / 2);
  return g;
};

export class Ground {
  readonly group = new Group();
  private readonly ground: ShaderMaterial;
  private readonly danger: ShaderMaterial;
  private readonly border: MeshBasicMaterial;
  private readonly halo: ShaderMaterial;
  private readonly cyan = new Color(HEX.cyan);
  private readonly red = new Color(HEX.danger);
  private readonly gold = new Color(HEX.gold);
  private readonly white = new Color(1, 1, 1);
  private readonly tmp = new Color();
  private readonly meshes: Mesh[] = [];

  constructor(arenaR: number) {
    const add = (m: Mesh) => {
      this.meshes.push(m);
      this.group.add(m);
      return m;
    };
    this.ground = new ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        uPlayer: { value: new Vector3() }, uArenaR: { value: arenaR }, uPulse: { value: 1 }, uLow: { value: 0 },
        cNear: { value: srgb(HEX.gridNear) }, cFar: { value: srgb(HEX.gridFar) }, cFloor: { value: srgb(HEX.bgFloor) },
        cDanger: { value: srgb(HEX.danger) }, cFog: { value: srgb(HEX.bgMid) },
      },
    });
    add(new Mesh(flat(new PlaneGeometry(120, 120)), this.ground)).renderOrder = -50;

    const disc = add(new Mesh(new CylinderGeometry(arenaR, arenaR, 0.06, 96), new MeshBasicMaterial({ color: "#160A33", toneMapped: false })));
    disc.position.y = 0.03;
    const guide = new MeshBasicMaterial({ color: HEX.panelBorder, transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false });
    for (const r of [2, 4]) add(new Mesh(flat(new RingGeometry(r - 0.01, r + 0.01, 96)), guide)).position.y = 0.062;
    const emblem = new MeshBasicMaterial({ color: HEX.magenta, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false });
    const hex = add(new Mesh(flat(new RingGeometry(0.55, 0.6, 6)), emblem));
    hex.position.y = 0.062;

    this.border = new MeshBasicMaterial({ color: HEX.cyan, transparent: true, toneMapped: false });
    add(new Mesh(flat(new TorusGeometry(arenaR, 0.06, 8, 160)), this.border)).position.y = 0.08;
    this.halo = new ShaderMaterial({
      vertexShader: LOCAL_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uColor: { value: new Color(HEX.cyan) }, uAlpha: { value: 0.6 }, uR: { value: arenaR } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    add(new Mesh(flat(new RingGeometry(arenaR - 0.3, arenaR + 0.5, 128)), this.halo)).position.y = 0.075;

    this.danger = makeDangerRingMaterial();
    add(new Mesh(flat(new RingGeometry(arenaR + 0.15, arenaR + 0.85, 128)), this.danger)).position.y = 0.07;
    for (const m of this.meshes) m.frustumCulled = false;
  }

  // flash: 0..1 white flash (lose), surge: 0..1 gold flash, chase: palette
  // colour chase colour or null.
  update(o: {
    time: number; danger: number; sectors: readonly number[]; playerX: number; playerZ: number; low: boolean;
    pulse: number; flash: number; surge: number; chase: Color | null;
  }) {
    const u = this.ground.uniforms;
    (u.uPlayer.value as Vector3).set(o.playerX, 0, o.playerZ);
    u.uPulse.value = o.pulse;
    u.uLow.value = o.low ? 1 : 0;
    const arr = this.danger.uniforms.uDanger.value as number[];
    for (let i = 0; i < 16; i++) arr[i] = o.sectors[i] ?? 0;
    this.danger.uniforms.uTime.value = o.time;
    // border pulse: period 1600 ms -> 350 ms with danger; cyan -> red 0.5..1
    const period = 1.6 + (0.35 - 1.6) * o.danger;
    const alpha = 0.8 + 0.2 * Math.sin((o.time / period) * Math.PI * 2);
    this.tmp.copy(this.cyan).lerp(this.red, Math.min(1, Math.max(0, (o.danger - 0.5) / 0.5)));
    if (o.chase) this.tmp.copy(o.chase);
    if (o.surge > 0) this.tmp.lerp(this.gold, o.surge);
    if (o.flash > 0) this.tmp.copy(this.red).lerp(this.white, o.flash);
    this.border.color.copy(this.tmp);
    this.border.opacity = alpha;
    (this.halo.uniforms.uColor.value as Color).copy(this.tmp);
    this.halo.uniforms.uAlpha.value = 0.45 * alpha + 0.4 * Math.max(o.flash, o.surge);
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    const mats = new Set(this.meshes.map((m) => m.material as ShaderMaterial | MeshBasicMaterial));
    mats.forEach((m) => m.dispose());
  }
}
