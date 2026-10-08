// Instanced camera-facing quads (the camera looks straight down -Z, so a
// quad in the XY plane always faces it). One draw call per batch. Used for
// additive glows/halos/sparks/aim dots, shockwave rings and soft shadows.
// Per-instance alpha is folded into the colour (additive) or ignored (normal).

import {
  AdditiveBlending, Blending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  MeshBasicMaterial, NormalBlending, PlaneGeometry, Texture,
} from "three";

export interface SpriteBatchOptions {
  capacity: number;
  texture: Texture;
  additive?: boolean;
  opacity?: number;
  renderOrder?: number;
}

export class SpriteBatch {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  private count = 0;
  private readonly m: Float32Array;
  private readonly c: Float32Array;
  private readonly additive: boolean;

  constructor({ capacity, texture, additive = true, opacity = 1, renderOrder = 10 }: SpriteBatchOptions) {
    const blending: Blending = additive ? AdditiveBlending : NormalBlending;
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending,
      opacity,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.capacity = capacity;
    this.additive = additive;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    this.c = this.mesh.instanceColor.array as Float32Array;
  }

  begin() {
    this.count = 0;
  }

  get size() {
    return this.count;
  }

  // Quad centred at (x,y,z) (world units), size w x h, rotated rot around Z.
  // alpha scales the colour for additive batches.
  add(x: number, y: number, z: number, w: number, h: number, col: Color, alpha = 1, rot = 0) {
    if (this.count >= this.capacity || alpha <= 0.003 || w <= 0 || h <= 0) return;
    const i = this.count++;
    const o = i * 16;
    const m = this.m;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    m[o] = cs * w; m[o + 1] = sn * w; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = -sn * h; m[o + 5] = cs * h; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const a = this.additive ? alpha : 1;
    const k = i * 3;
    this.c[k] = col.r * a;
    this.c[k + 1] = col.g * a;
    this.c[k + 2] = col.b * a;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
