// Instanced camera-facing glow quads for the chase camera (Classic's
// SpriteBatch relies on a camera looking straight down -Z). One draw call;
// additive; per-instance centre, size, rotation and colour x alpha. Sizes are
// in the parent's units (the arena FX group is scaled to Classic units).

import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  PlaneGeometry, ShaderMaterial, Texture,
} from "three";
import { QuadSink } from "../three/fx/SpriteBatch";

const VERT = /* glsl */ `
attribute vec3 aCentre;
attribute vec3 aSizeRot;
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = aColor;
  float s = length(modelMatrix[0].xyz);
  vec4 mv = modelViewMatrix * vec4(aCentre, 1.0);
  float c = cos(aSizeRot.z);
  float sn = sin(aSizeRot.z);
  vec2 p = position.xy * aSizeRot.xy;
  mv.xy += vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) * s;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float a = texture2D(uMap, vUv).a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}`;

export class Billboards implements QuadSink {
  readonly mesh: Mesh;
  private n = 0;
  private readonly cap: number;
  private readonly centre: Float32Array;
  private readonly sizeRot: Float32Array;
  private readonly col: Float32Array;
  private readonly geo: InstancedBufferGeometry;

  constructor(capacity: number, texture: Texture, renderOrder = 10) {
    this.cap = capacity;
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute("position", plane.getAttribute("position"));
    this.geo.setAttribute("uv", plane.getAttribute("uv"));
    this.centre = new Float32Array(capacity * 3);
    this.sizeRot = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    const attr = (a: Float32Array) => new InstancedBufferAttribute(a, 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aCentre", attr(this.centre));
    this.geo.setAttribute("aSizeRot", attr(this.sizeRot));
    this.geo.setAttribute("aColor", attr(this.col));
    this.geo.instanceCount = 0;
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: texture } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin() {
    this.n = 0;
  }

  add(x: number, y: number, z: number, w: number, h: number, col: Color, alpha = 1, rot = 0) {
    if (this.n >= this.cap || alpha <= 0.003 || w <= 0 || h <= 0) return;
    const i = this.n++ * 3;
    this.centre[i] = x; this.centre[i + 1] = y; this.centre[i + 2] = z;
    this.sizeRot[i] = w; this.sizeRot[i + 1] = h; this.sizeRot[i + 2] = rot;
    this.col[i] = col.r * alpha; this.col[i + 1] = col.g * alpha; this.col[i + 2] = col.b * alpha;
  }

  end() {
    this.geo.instanceCount = this.n;
    for (const name of ["aCentre", "aSizeRot", "aColor"]) {
      const a = this.geo.getAttribute(name) as InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 3);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
