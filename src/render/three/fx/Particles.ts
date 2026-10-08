// Additive point particles in one THREE.Points draw call (spec budget 400).
// Structure-of-arrays pool; dead particles are swapped out so the live set
// stays packed and the GPU buffers are written in one pass.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Points, ShaderMaterial } from "three";

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uPxPerUnit;
uniform float uCamDist;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uPxPerUnit * (uCamDist / max(-mv.z, 1.0)));
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a;
  // colours arrive linear; this shader writes straight to the screen
  gl_FragColor = vec4(pow(vColor.rgb, vec3(0.4545)) * vColor.a * a, 1.0);
}`;

export interface ParticleSpec {
  x: number; y: number; z?: number;
  vx: number; vy: number; vz?: number;
  life: number; // seconds
  size0: number; size1?: number; // world units (diameter)
  c0: Color; c1?: Color;
  alpha?: number;
  drag?: number; // velocity multiplier per 16ms
  gravity?: number; // world units/s^2 (negative = down in world)
}

export class Particles {
  readonly points: Points;
  readonly capacity: number;
  private n = 0;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array;
  private readonly s0: Float32Array; private readonly s1: Float32Array;
  private readonly col: Float32Array; // r0 g0 b0 r1 g1 b1 alpha drag gravity
  private readonly pos: Float32Array; private readonly rgba: Float32Array; private readonly size: Float32Array;
  private readonly geo: BufferGeometry;
  readonly material: ShaderMaterial;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f();
    this.col = new Float32Array(capacity * 9);
    this.pos = new Float32Array(capacity * 3);
    this.rgba = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    const attr = (a: Float32Array, k: number) => new BufferAttribute(a, k).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("position", attr(this.pos, 3));
    this.geo.setAttribute("aColor", attr(this.rgba, 4));
    this.geo.setAttribute("aSize", attr(this.size, 1));
    this.geo.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uPxPerUnit: { value: 1 }, uCamDist: { value: 1000 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }

  get live() {
    return this.n;
  }

  // Screen pixels per world unit at the board plane, and camera distance.
  setProjection(pxPerUnit: number, camDist: number) {
    this.material.uniforms.uPxPerUnit.value = pxPerUnit;
    this.material.uniforms.uCamDist.value = camDist;
  }

  spawn(p: ParticleSpec) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z ?? 0;
    this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz ?? 0;
    this.age[i] = 0; this.life[i] = p.life;
    this.s0[i] = p.size0; this.s1[i] = p.size1 ?? 0;
    const c1 = p.c1 ?? p.c0;
    const o = i * 9;
    this.col[o] = p.c0.r; this.col[o + 1] = p.c0.g; this.col[o + 2] = p.c0.b;
    this.col[o + 3] = c1.r; this.col[o + 4] = c1.g; this.col[o + 5] = c1.b;
    this.col[o + 6] = p.alpha ?? 1; this.col[o + 7] = p.drag ?? 1; this.col[o + 8] = p.gravity ?? 0;
  }

  clear() {
    this.n = 0;
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.col.copyWithin(i * 9, j * 9, j * 9 + 9);
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const o = i * 9;
      const drag = this.col[o + 7];
      if (drag !== 1) {
        const k = Math.pow(drag, dt * 62.5);
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] += this.col[o + 8] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      i++;
    }
    for (let k = 0; k < this.n; k++) {
      const t = this.age[k] / this.life[k];
      const o = k * 9;
      this.pos[k * 3] = this.px[k]; this.pos[k * 3 + 1] = this.py[k]; this.pos[k * 3 + 2] = this.pz[k];
      this.rgba[k * 4] = this.col[o] + (this.col[o + 3] - this.col[o]) * t;
      this.rgba[k * 4 + 1] = this.col[o + 1] + (this.col[o + 4] - this.col[o + 1]) * t;
      this.rgba[k * 4 + 2] = this.col[o + 2] + (this.col[o + 5] - this.col[o + 2]) * t;
      this.rgba[k * 4 + 3] = this.col[o + 6] * (t > 0.6 ? (1 - t) / 0.4 : 1);
      this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * t;
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ["position", "aColor", "aSize"]) {
      const a = this.geo.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
