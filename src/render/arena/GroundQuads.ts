// Instanced flat quads lying on the ground (XZ) plane: blob shadows (normal
// blending) or glowing decals such as shockwave / dust / landing rings
// (additive). One draw call per batch. Units are the parent's units.

import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  NormalBlending, PlaneGeometry, ShaderMaterial, Texture,
} from "three";

const VERT = /* glsl */ `
attribute vec4 aPosSize; // x, y (height), z, size
attribute vec4 aColor; // rgb, alpha
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = aColor;
  vec3 p = vec3(aPosSize.x + position.x * aPosSize.w, aPosSize.y, aPosSize.z - position.y * aPosSize.w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = (additive: boolean) => /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float a = texture2D(uMap, vUv).a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = ${additive ? "vec4(vColor.rgb * a, 1.0)" : "vec4(vColor.rgb, a)"};
  #include <colorspace_fragment>
}`;

export class GroundQuads {
  readonly mesh: Mesh;
  private n = 0;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo: InstancedBufferGeometry;

  constructor(capacity: number, texture: Texture, additive: boolean, renderOrder = 3) {
    this.cap = capacity;
    const plane = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute("position", plane.getAttribute("position"));
    this.geo.setAttribute("uv", plane.getAttribute("uv"));
    this.pos = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.geo.setAttribute("aPosSize", new InstancedBufferAttribute(this.pos, 4).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aColor", new InstancedBufferAttribute(this.col, 4).setUsage(DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: frag(additive),
        uniforms: { uMap: { value: texture } },
        transparent: true,
        depthWrite: false,
        blending: additive ? AdditiveBlending : NormalBlending,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin() {
    this.n = 0;
  }

  add(x: number, y: number, z: number, size: number, col: Color, alpha: number) {
    if (this.n >= this.cap || alpha <= 0.003 || size <= 0) return;
    const i = this.n++ * 4;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z; this.pos[i + 3] = size;
    this.col[i] = col.r; this.col[i + 1] = col.g; this.col[i + 2] = col.b; this.col[i + 3] = alpha;
  }

  end() {
    this.geo.instanceCount = this.n;
    for (const name of ["aPosSize", "aColor"]) {
      const a = this.geo.getAttribute(name) as InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
