// Synthwave backdrop as one full-screen shader pass drawn first: sky
// gradient, twinkling stars, slit sun with glow, horizon band and an
// analytic perspective grid floor that drifts toward the viewer. A second
// full-screen pass on top draws the danger vignette.
// Units inside the shaders are screen points (uRes = container size in pt).

import { Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { HEX, srgb } from "../palette";

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const BG_FRAG = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform float uHorizon;
uniform float uSunR;
uniform float uParallax;
uniform float uHeat;
uniform float uPulse;
uniform float uFade;
uniform float uStars;
uniform vec3 cTop, cMid, cHor, cFloor, cSunTop, cSunBot, cGlowA, cGlowB, cNear, cFar, cDanger, cStar;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  float hy = uHorizon * uRes.y;
  float cx = uRes.x * 0.5;
  vec3 col;
  if (p.y < hy) {
    float t = p.y / hy;
    col = t < 0.6 ? mix(cTop, cMid, t / 0.6) : mix(cMid, cHor, (t - 0.6) / 0.4);
    // stars: one candidate per 34pt cell
    vec2 cell = floor(p / 34.0);
    float h = hash(cell);
    if (h > 1.0 - uStars) {
      vec2 sp = (cell + vec2(hash(cell + 3.1), hash(cell + 7.7))) * 34.0;
      float tw = 0.2 + 0.6 * (0.5 + 0.5 * sin(uTime * (0.8 + h * 2.0) + h * 40.0));
      float d = length(p - sp);
      col += cStar * tw * (smoothstep(1.8, 0.0, d) + 0.25 * smoothstep(5.0, 0.0, d)) * (1.0 - t * 0.6);
    }
    // sun: centred above the horizon, slits in its lower part
    float R = uSunR;
    vec2 sc = vec2(cx + uParallax * 0.3, hy - R * 0.55);
    float sd = length(p - sc);
    float inside = smoothstep(R + 1.0, R - 1.0, sd);
    float ly = (p.y - sc.y) / R;
    float cut = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float y0 = 0.04 + fi * 0.085;
      float hh = 0.018 + fi * 0.009;
      cut = max(cut, step(y0, ly) * step(ly, y0 + hh));
    }
    float sunT = clamp((p.y - (sc.y - R)) / (R * 1.55), 0.0, 1.0);
    vec3 sunCol = mix(cSunTop, cSunBot, sunT);
    col = mix(col, sunCol, inside * (1.0 - cut));
    col += cSunBot * 0.45 * exp(-max(sd - R, 0.0) / 34.0) * (1.0 - inside * (1.0 - cut));
  } else {
    float dy = p.y - hy;
    float depthSpan = max(uRes.y - hy, 1.0);
    // analytic floor: x/dy and 1/dy are linear in world x and depth
    float x = (p.x - cx - uParallax) / max(dy, 0.5);
    float zz = 1.0 / max(dy, 0.5);
    float cellX = (uRes.x / 20.0) / depthSpan;
    float cellZ = (uRes.x / 20.0 * 0.7) / (depthSpan * depthSpan);
    vec2 g = vec2(x / cellX, zz / cellZ + uScroll);
    vec2 fw = max(fwidth(g), vec2(1e-4));
    float near = clamp(dy / depthSpan, 0.0, 1.0);
    float width = mix(0.5, 1.5, near);
    vec2 gd = abs(fract(g - 0.5) - 0.5) / fw;
    float line = 1.0 - clamp(min(gd.x, gd.y) - width * 0.5 + 0.5, 0.0, 1.0);
    vec3 gc = mix(cFar, cNear, near);
    gc = mix(gc, cDanger, uHeat);
    float ga = mix(0.15, 0.6, near) * smoothstep(0.0, 14.0, dy) * uPulse;
    col = mix(cHor * 0.55, cFloor, smoothstep(0.0, 110.0, dy));
    col += gc * line * ga;
  }
  // horizon glow band
  float band = exp(-pow((p.y - hy) / 12.0, 2.0)) * 0.55;
  col += mix(cGlowA, cGlowB, clamp(abs(p.x - cx) / (uRes.x * 0.5), 0.0, 1.0)) * band;
  gl_FragColor = vec4(col * uFade, 1.0);
}`;

const VIGNETTE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uAspect;
uniform vec3 cDanger;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  d.x *= min(uAspect, 1.0) / max(uAspect, 1.0) + 0.5;
  float a = smoothstep(0.6, 1.25, length(d)) * uAlpha;
  gl_FragColor = vec4(cDanger, a);
}`;

const fullscreen = (material: ShaderMaterial, order: number) => {
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
};

export class Background {
  readonly mesh: Mesh;
  readonly vignette: Mesh;
  private readonly bg: ShaderMaterial;
  private readonly vig: ShaderMaterial;

  constructor() {
    this.bg = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BG_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uRes: { value: new Vector2(390, 844) },
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uHorizon: { value: 0.38 },
        uSunR: { value: 101 },
        uParallax: { value: 0 },
        uHeat: { value: 0 },
        uPulse: { value: 1 },
        uFade: { value: 1 },
        uStars: { value: 0.3 },
        cTop: { value: srgb(HEX.bgTop) },
        cMid: { value: srgb(HEX.bgMid) },
        cHor: { value: srgb(HEX.bgHorizon) },
        cFloor: { value: srgb(HEX.bgFloor) },
        cSunTop: { value: srgb(HEX.sunTop) },
        cSunBot: { value: srgb(HEX.sunBottom) },
        cGlowA: { value: srgb(HEX.glowA) },
        cGlowB: { value: srgb(HEX.glowB) },
        cNear: { value: srgb(HEX.gridNear) },
        cFar: { value: srgb(HEX.gridFar) },
        cDanger: { value: srgb(HEX.danger) },
        cStar: { value: srgb(HEX.star) },
      },
    });
    this.mesh = fullscreen(this.bg, -100);
    this.vig = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: VIGNETTE_FRAG,
      transparent: true,
      blending: NormalBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: { uAlpha: { value: 0 }, uAspect: { value: 0.5 }, cDanger: { value: srgb(HEX.danger) } },
    });
    this.vignette = fullscreen(this.vig, 100);
  }

  update(o: {
    width: number; height: number; time: number; scroll: number; horizon: number; sunR: number; parallax: number;
    heat: number; pulse: number; fade: number; stars: number; vignette: number;
  }) {
    const u = this.bg.uniforms;
    (u.uRes.value as Vector2).set(o.width, o.height);
    u.uTime.value = o.time;
    u.uScroll.value = o.scroll;
    u.uHorizon.value = o.horizon;
    u.uSunR.value = o.sunR;
    u.uParallax.value = o.parallax;
    u.uHeat.value = o.heat;
    u.uPulse.value = o.pulse;
    u.uFade.value = o.fade;
    u.uStars.value = o.stars;
    this.vig.uniforms.uAlpha.value = o.vignette;
    this.vig.uniforms.uAspect.value = o.width / Math.max(1, o.height);
    this.vignette.visible = o.vignette > 0.004;
  }

  dispose() {
    for (const m of [this.mesh, this.vignette]) m.geometry.dispose();
    this.bg.dispose();
    this.vig.dispose();
  }
}
