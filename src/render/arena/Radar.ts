// Heading-up radar (spec section 3.3), drawn inside the GL canvas as a
// second pass into a scissored viewport (no per-frame React/SVG nodes).
// Player-centred and heading-up: the facing points up, RANGE w = rim.
// Everything is unlit, untone-mapped and fog-free, sized in device pixels
// so it stays crisp at 140 pt (desktop) and 88 pt (phone):
//   backdrop (one quad, procedural): #0B0420 disc at 85%, a 2 px bright
//     cyan rim, the arena border ring, one faint range ring, the view wedge
//     (25% cyan, brighter edges) and the 16 danger sectors as red rim arcs;
//   bombs: round blips in their full bomb colours with a 1 px dark outline,
//     5 px (desktop) / 4 px (phone), a little bigger when close, pulsing
//     near the border; bombs beyond range sit on the rim as small dots;
//   player: a white arrow at the centre with a dark outline.
// The custom shaders output display (sRGB) colours directly: no lighting,
// tone mapping, fog or colour-space pass can dim them.

import {
  BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Points, Scene,
  ShaderMaterial, Shape, ShapeGeometry, SRGBColorSpace, Vector2,
} from "three";
import type { ArenaEngine } from "../../game/arena";
import { DEG } from "../../arena/arenaMath";
import { bombBase, colorAt } from "../three/palette";

const RANGE = 14; // w at the rim
const MAX_DOTS = 200;
const EDGE = 1.04; // ortho half-extent (a little margin round the disc)

const BACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BACK_FRAG = /* glsl */ `
uniform float uPx;      // device px per radar unit
uniform vec2 uPlayer;   // player (world x, z) / RANGE
uniform vec2 uF;        // facing (world x, z)
uniform float uArena;   // arena radius / RANGE
uniform float uHalf;    // view wedge half angle
uniform float uDanger[16];
uniform float uTime;
varying vec2 vUv;
const float PI = 3.14159265;
float band(float d, float halfPx) { return 1.0 - smoothstep(halfPx - 0.5, halfPx + 0.5, abs(d)); }
void main() {
  float r = length(vUv);
  float px = uPx;
  if (r * px > px + 1.5) discard;
  vec3 col = vec3(0.043, 0.016, 0.125);
  float a = 0.85;
  // world position of this pixel (screen up = facing, right = facing x up)
  vec2 R = vec2(-uF.y, uF.x);
  vec2 w = uPlayer + uF * vUv.y + R * vUv.x;
  // faint range ring at half range, arena border ring
  col = mix(col, vec3(0.13, 0.95, 1.0), 0.18 * band((r - 0.5) * px, 0.5));
  col = mix(col, vec3(0.13, 0.95, 1.0), 0.75 * band((length(w) - uArena) * px, 0.75));
  // view wedge: 25% cyan, brighter edges
  float ang = atan(vUv.x, vUv.y); // 0 = up
  if (r < 0.62 && abs(ang) < uHalf) {
    col = mix(col, vec3(0.13, 0.95, 1.0), 0.25);
    float edge = min(abs(abs(ang) - uHalf) * r * px, (0.62 - r) * px);
    col = mix(col, vec3(0.6, 1.0, 1.0), 0.55 * (1.0 - smoothstep(0.5, 1.5, edge)));
  }
  // danger sectors on the rim (world angle of this screen direction)
  vec2 dirW = uF * vUv.y + R * vUv.x;
  float wa = atan(dirW.y, dirW.x);
  if (wa < 0.0) wa += 2.0 * PI;
  int si = int(floor(wa / (2.0 * PI) * 16.0));
  float dz = 0.0;
  for (int i = 0; i < 16; i++) if (i == si) dz = uDanger[i];
  float rimIn = 1.0 - 6.0 / px;
  if (r > rimIn && r < 1.0 && dz > 0.05) {
    float pulse = dz > 0.75 ? 0.75 + 0.25 * sin(uTime * 10.0) : 1.0;
    col = mix(col, vec3(1.0, 0.18, 0.33), clamp(dz * 1.2, 0.0, 1.0) * pulse);
  }
  // crisp 2 px cyan rim
  float rim = band((r - 1.0) * px + 1.0, 1.0);
  col = mix(col, vec3(0.13, 0.95, 1.0), rim);
  a = max(a, rim);
  // anti-aliased outer edge
  a *= 1.0 - smoothstep(px + 0.5, px + 1.5, r * px);
  gl_FragColor = vec4(col, a);
}`;

const DOT_VERT = /* glsl */ `
attribute vec3 color;
attribute float size;
uniform float uDpr;
varying vec3 vColor;
varying float vSize;
void main() {
  vColor = color;
  vSize = size * uDpr;
  gl_PointSize = vSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vSize;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0; // 0 centre .. 1 edge
  float px = r * vSize * 0.5;                  // px from the centre
  float rad = vSize * 0.5;
  float alpha = 1.0 - smoothstep(rad - 0.75, rad, px);
  if (alpha <= 0.0) discard;
  float outline = smoothstep(rad - 1.6, rad - 0.9, px); // ~1 px dark ring
  gl_FragColor = vec4(mix(vColor, vec3(0.03, 0.01, 0.08), outline), alpha);
}`;

export class Radar {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-EDGE, EDGE, EDGE, -EDGE, 0.1, 10);
  private readonly pos = new Float32Array(MAX_DOTS * 3);
  private readonly col = new Float32Array(MAX_DOTS * 3);
  private readonly size = new Float32Array(MAX_DOTS);
  private readonly dotsGeo = new BufferGeometry();
  private readonly dotsMat: ShaderMaterial;
  private readonly back: ShaderMaterial;
  private readonly disposables: { dispose: () => void }[] = [];
  private t = 0;
  private readonly rgb = { r: 0, g: 0, b: 0 };
  private readonly arrow = new Group(); // player marker, scaled to a fixed px size

  constructor(private readonly arenaR: number) {
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    const common = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false };
    this.back = new ShaderMaterial({
      vertexShader: BACK_VERT, fragmentShader: BACK_FRAG, ...common,
      uniforms: {
        uPx: { value: 70 }, uPlayer: { value: new Vector2() }, uF: { value: new Vector2(0, 1) }, uArena: { value: arenaR / RANGE },
        uHalf: { value: 0.6 }, uDanger: { value: new Array<number>(16).fill(0) }, uTime: { value: 0 },
      },
    });
    const quad = new Mesh(new PlaneGeometry(2.1, 2.1), this.back);
    quad.renderOrder = 0;
    this.scene.add(quad);
    this.disposables.push(quad.geometry, this.back);

    this.dotsGeo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.dotsGeo.setAttribute("color", new BufferAttribute(this.col, 3));
    this.dotsGeo.setAttribute("size", new BufferAttribute(this.size, 1));
    this.dotsMat = new ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: { uDpr: { value: 1 } }, ...common });
    const dots = new Points(this.dotsGeo, this.dotsMat);
    dots.frustumCulled = false;
    dots.renderOrder = 1;
    this.scene.add(dots);
    this.disposables.push(this.dotsGeo, this.dotsMat);

    // player: white arrow at the centre, pointing up, dark outline behind
    // (transparent like the rest, so renderOrder puts it on top)
    const arrow = (k: number) => {
      const s = new Shape();
      s.moveTo(0, 0.1 * k);
      s.lineTo(-0.065 * k, -0.07 * k);
      s.lineTo(0, -0.035 * k);
      s.lineTo(0.065 * k, -0.07 * k);
      s.closePath();
      return new ShapeGeometry(s);
    };
    const outline = new Mesh(arrow(1.35), new MeshBasicMaterial({ color: "#0B0420", ...common }));
    const fill = new Mesh(arrow(1), new MeshBasicMaterial({ color: "#FFFFFF", ...common }));
    outline.position.z = fill.position.z = 0.01;
    outline.renderOrder = 2;
    fill.renderOrder = 3;
    this.arrow.add(outline, fill);
    this.scene.add(this.arrow);
    this.disposables.push(outline.geometry, fill.geometry, outline.material, fill.material);
  }

  // sizePx: radar diameter in css px; dpr: device pixel ratio
  update(engine: ArenaEngine, hFovDeg: number, sizePx = 140, dpr = 1, dt = 1 / 60) {
    this.t += dt;
    const s = engine.getShooter();
    const fx = Math.cos(s.yaw), fz = Math.sin(s.yaw);
    const u = this.back.uniforms;
    u.uPx.value = ((sizePx / 2) * dpr) / EDGE;
    (u.uPlayer.value as Vector2).set(s.x / RANGE, s.z / RANGE);
    (u.uF.value as Vector2).set(fx, fz);
    u.uHalf.value = Math.min(80, hFovDeg / 2) * DEG;
    u.uTime.value = this.t;
    const arr = u.uDanger.value as number[];
    const sectors = engine.getDangerByAngle(16);
    for (let i = 0; i < 16; i++) arr[i] = sectors[i] ?? 0;
    this.dotsMat.uniforms.uDpr.value = dpr;
    // arrow ~13 px tall on desktop, 11 px on the 88 pt phone radar
    const unitPx = sizePx / 2 / EDGE;
    this.arrow.scale.setScalar((sizePx < 110 ? 11 : 13) / (0.17 * unitPx));

    const phone = sizePx < 110;
    const base = phone ? 4 : 5;
    const cfg = engine.getConfig();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 9);
    let n = 0;
    for (const b of engine.getBombs()) {
      if (b.state !== "idle" || n >= MAX_DOTS) continue;
      const dx = b.x - s.x, dz = b.z - s.z;
      // heading-up: screen x = along the right, y = along the facing
      let x = (-dx * fz + dz * fx) / RANGE;
      let y = (dx * fx + dz * fz) / RANGE;
      const d = Math.hypot(x, y);
      let px = base * (1.25 - 0.4 * Math.min(1, d)); // closer = bigger
      if (d > 0.95) {
        // beyond range: a small dot on the rim
        x *= 0.95 / d;
        y *= 0.95 / d;
        px = base * 0.7;
      }
      const gap = cfg.arenaRadius - (Math.hypot(b.x, b.z) + cfg.bombRadius);
      if (gap < 1) px *= 1 + 0.35 * pulse * (1 - Math.max(0, gap)); // near the border: pulse
      // the shaders write display (sRGB) values directly, like the HUD chip
      const c = colorAt(bombBase, b.colorIndex).getRGB(this.rgb, SRGBColorSpace);
      this.pos[n * 3] = x;
      this.pos[n * 3 + 1] = y;
      this.pos[n * 3 + 2] = 0.02;
      this.col[n * 3] = c.r;
      this.col[n * 3 + 1] = c.g;
      this.col[n * 3 + 2] = c.b;
      this.size[n] = Math.max(phone ? 4 : 5, px) + 2; // + the 1 px outline each side
      n++;
    }
    this.dotsGeo.setDrawRange(0, n);
    this.dotsGeo.getAttribute("position").needsUpdate = true;
    this.dotsGeo.getAttribute("color").needsUpdate = true;
    this.dotsGeo.getAttribute("size").needsUpdate = true;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
