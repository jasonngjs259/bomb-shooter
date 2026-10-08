// Instanced camera-facing glyph sprites from the fun atlas (funAtlas.ts): one
// draw for every pickup icon, lock glyph, ticking countdown digit and stun
// star. Normal blending (a tinted glyph with a dark outline, readable on the
// bright neon scene); per-instance centre, size, rotation, atlas cell, tint
// and alpha. World units. Allocation-free: begin(), add()..., end().

import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Texture,
} from "three";
import { ATLAS_CELLS } from "./funAtlas";

const VERT = /* glsl */ `
attribute vec4 aCentre; // xyz, size
attribute vec3 aCellRot; // cell, rotation, view-space x offset
attribute vec4 aColor; // rgb, alpha
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = vec2((uv.x + aCellRot.x) / ${ATLAS_CELLS.toFixed(1)}, uv.y);
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(aCentre.xyz, 1.0);
  mv.xyz += normalize(-mv.xyz) * 0.3; // a little towards the camera (icons on token faces)
  mv.x += aCellRot.z;
  float c = cos(aCellRot.y);
  float s = sin(aCellRot.y);
  vec2 p = position.xy * aCentre.w;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vec3(0.04, 0.01, 0.1), vColor.rgb, t.r), a);
  #include <colorspace_fragment>
}`;

export class AtlasSprites {
  readonly mesh: Mesh;
  private n = 0;
  private readonly cap: number;
  private readonly centre: Float32Array;
  private readonly cellRot: Float32Array;
  private readonly col: Float32Array;
  private readonly geo: InstancedBufferGeometry;

  constructor(capacity: number, atlas: Texture, renderOrder = 14) {
    this.cap = capacity;
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute("position", plane.getAttribute("position"));
    this.geo.setAttribute("uv", plane.getAttribute("uv"));
    this.centre = new Float32Array(capacity * 4);
    this.cellRot = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.geo.setAttribute("aCentre", new InstancedBufferAttribute(this.centre, 4).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aCellRot", new InstancedBufferAttribute(this.cellRot, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aColor", new InstancedBufferAttribute(this.col, 4).setUsage(DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { uMap: { value: atlas } }, transparent: true, depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  get count() {
    return this.n;
  }

  begin() {
    this.n = 0;
  }

  // ox: view-space x offset (w), e.g. the second digit of a number
  add(x: number, y: number, z: number, size: number, cell: number, col: Color, alpha = 1, rot = 0, ox = 0) {
    if (this.n >= this.cap || alpha <= 0.01 || size <= 0) return;
    const i = this.n++;
    this.centre[i * 4] = x; this.centre[i * 4 + 1] = y; this.centre[i * 4 + 2] = z; this.centre[i * 4 + 3] = size;
    this.cellRot[i * 3] = cell; this.cellRot[i * 3 + 1] = rot; this.cellRot[i * 3 + 2] = ox;
    this.col[i * 4] = col.r; this.col[i * 4 + 1] = col.g; this.col[i * 4 + 2] = col.b; this.col[i * 4 + 3] = alpha;
  }

  end() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const [name, k] of [["aCentre", 4], ["aCellRot", 3], ["aColor", 4]] as const) {
      const a = this.geo.getAttribute(name) as InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * k);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
