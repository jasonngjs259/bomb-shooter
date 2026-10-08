// Arena sky (spec section 4): one inverted sphere (r 90) that follows the
// camera, shaded by view direction: the Classic gradient, hashed twinkling
// stars, the slit synthwave sun fixed at world -Z (north landmark: centre
// (0, 6, -70), radius 16) with its glow, and the horizon glow band.

import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from "three";
import { HEX, srgb } from "../three/palette";
import { VIGNETTE } from "./Ground";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
${VIGNETTE}
uniform float uTime;
uniform float uStars;
uniform vec3 cTop, cMid, cHor, cFloor, cSunTop, cSunBot, cGlowA, cGlowB, cStar;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0
    ? (h > 0.35 ? cTop : mix(cHor, mix(cMid, cTop, h / 0.35), smoothstep(0.0, 0.18, h)))
    : mix(cHor * 0.5, cFloor, smoothstep(0.0, 0.1, -h));
  // stars (upper sky only)
  if (h > 0.08) {
    vec2 sp = vec2(atan(d.z, d.x) * 40.0, h * 60.0);
    vec2 cell = floor(sp);
    float r = hash(cell);
    if (r > 1.0 - uStars) {
      vec2 c = cell + vec2(hash(cell + 3.1), hash(cell + 7.7));
      float dist = length(sp - c);
      float tw = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + r * 2.0) + r * 40.0));
      col += cStar * tw * (1.0 - smoothstep(0.0, 0.12, dist)) * smoothstep(0.08, 0.3, h);
    }
  }
  // sun towards -Z
  vec3 sd = normalize(vec3(0.0, 6.0, -70.0));
  float R = atan(16.0 / 70.3);
  float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
  vec3 upv = normalize(vec3(0.0, 1.0, 0.0) - sd * sd.y);
  float ly = -dot(d - sd, upv) / sin(R); // + = below the sun centre
  float inside = (1.0 - smoothstep(R * 0.99, R * 1.01, ang)) * step(-0.02, h);
  float cut = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y0 = 0.04 + fi * 0.085;
    float hh = 0.018 + fi * 0.009;
    cut = max(cut, step(y0, ly) * step(ly, y0 + hh));
  }
  vec3 sunCol = mix(cSunTop, cSunBot, clamp((ly + 1.0) / 1.55, 0.0, 1.0));
  col = mix(col, sunCol, inside * (1.0 - cut));
  col += cSunBot * 0.45 * exp(-max(ang - R, 0.0) / 0.06) * (1.0 - inside * (1.0 - cut)) * step(-0.05, h);
  // horizon band
  float hb = h / 0.025;
  float band = exp(-hb * hb) * 0.55;
  col += mix(cGlowA, cGlowB, 0.5 + 0.5 * d.x) * band;
  gl_FragColor = vec4(vignette(col), 1.0);
}`;

export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  // vig: the ground's vignette uniforms (one screen-edge glow over both)
  constructor(vig: Record<string, { value: unknown }> = {}) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStars: { value: 0.35 },
        cTop: { value: srgb(HEX.bgTop) },
        cMid: { value: srgb(HEX.bgMid) },
        cHor: { value: srgb(HEX.bgHorizon) },
        cFloor: { value: srgb(HEX.bgFloor) },
        cSunTop: { value: srgb(HEX.sunTop) },
        cSunBot: { value: srgb(HEX.sunBottom) },
        cGlowA: { value: srgb(HEX.glowA) },
        cGlowB: { value: srgb(HEX.glowB) },
        cStar: { value: srgb(HEX.star) },
        ...vig,
      },
    });
    this.mesh = new Mesh(new SphereGeometry(90, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  update(time: number, camX: number, camY: number, camZ: number, low: boolean) {
    this.mesh.position.set(camX, camY, camZ);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uStars.value = low ? 0.15 : 0.35;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
