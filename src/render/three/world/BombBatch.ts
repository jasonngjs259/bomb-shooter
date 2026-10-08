// All bombs in three instanced draw calls that share one instance matrix
// buffer: lit glossy spheres (per-instance colour, emissive boost and white
// tint via a small onBeforeCompile patch), the fuse cap + fuse "hardware"
// (merged, vertex-coloured) and the colour-assist glyph decal. Halos, fuse
// sparks and soft drop shadows go to the shared sprite batches.
// Callers fill the reusable `draw` scratch object and call add() each frame.

import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DynamicDrawUsage,
  InstancedBufferAttribute, InstancedMesh, Material, Matrix4, MeshPhysicalMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Texture, TubeGeometry, Vector3, Euler,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SpriteBatch } from "../fx/SpriteBatch";
import { bombBase, bombGlow, color, colorAt, HEX } from "../palette";
import { GLYPH_COUNT } from "../textures";

export const BOMB_RADIUS = 19;
// Fuse tip (spark) in bomb-local units, y up.
const TIP = new Vector3(10.86, 28.35, 0.5);

export interface BombDraw {
  x: number; y: number; z: number; // world
  scale: number;
  rotX: number; rotY: number; rotZ: number;
  squash: number; // 0 = none; >0 stretches along squashAngle, flattens across
  squashAngle: number;
  colorIndex: number;
  glow: number; // emissive intensity (0.35 board, 0.9 loaded)
  tint: number; // 0..1 towards white (pop pre-flash)
  halo: number; // halo alpha multiplier
  spark: number; // 0 none, else spark scale (flicker applied by caller)
  shadow: boolean;
}

export const newDraw = (): BombDraw => ({
  x: 0, y: 0, z: 0, scale: 1, rotX: 0, rotY: 0, rotZ: 0, squash: 0, squashAngle: 0,
  colorIndex: 0, glow: 0.35, tint: 0, halo: 1, spark: 1, shadow: true,
});

const patchBombMaterial = (m: Material) => {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aFx;\nvarying vec2 vFx;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFx = aFx;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFx;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFx.y);"
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * vFx.x + vec3(vFx.y * 1.6);"
      );
  };
  m.customProgramCacheKey = () => "bomb-fx";
  return m;
};

const makeBombMaterial = (high: boolean) =>
  patchBombMaterial(
    high
      ? new MeshPhysicalMaterial({
          color: "#ffffff", roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, fog: false,
        })
      : new MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, metalness: 0.1, fog: false })
  );

const paint = (g: BufferGeometry, hex: string) => {
  const c = color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new BufferAttribute(arr, 3));
  return g;
};

const makeHardwareGeometry = () => {
  const cap = new CylinderGeometry(4, 5, 5, 12);
  cap.rotateZ((-20 * Math.PI) / 180);
  cap.translate(4, 19, 0);
  const curve = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(3, 4, 1), new Vector3(6, 7, 0)]);
  const fuse = new TubeGeometry(curve, 8, 1.0, 6, false);
  fuse.translate(4.86, 21.35, 0);
  const merged = mergeGeometries([paint(cap, HEX.metal), paint(fuse, HEX.fuse)]);
  cap.dispose();
  fuse.dispose();
  return merged ?? new BufferGeometry();
};

const GLYPH_VERT = /* glsl */ `
attribute vec2 aGlyph;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = vec2((uv.x + aGlyph.x) / ${GLYPH_COUNT.toFixed(1)}, uv.y);
  vA = aGlyph.y;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const GLYPH_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
void main() {
  float a = texture2D(uMap, vUv).a * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}`;

export class BombBatch {
  readonly bombs: InstancedMesh;
  readonly hardware: InstancedMesh;
  readonly glyphs: InstancedMesh;
  readonly draw = newDraw();
  glyphAlpha = 0.28;
  haloAlpha = 0.9; // texture tail is ~0.12 at the sphere edge
  private count = 0;
  private readonly capacity: number;
  private readonly fx: Float32Array;
  private readonly glyph: Float32Array;
  private readonly col: Float32Array;
  private readonly m = new Matrix4();
  private readonly t = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly tip = new Vector3();
  private readonly sparkColor = color(HEX.spark);
  private readonly shadowColor = new Color(0, 0, 0);

  constructor(capacity: number, glyphAtlas: Texture, private glow: SpriteBatch, private shadows: SpriteBatch) {
    this.capacity = capacity;
    const sphere = new SphereGeometry(BOMB_RADIUS, 32, 24);
    this.fx = new Float32Array(capacity * 2);
    sphere.setAttribute("aFx", new InstancedBufferAttribute(this.fx, 2).setUsage(DynamicDrawUsage));
    this.bombs = new InstancedMesh(sphere, makeBombMaterial(true), capacity);
    this.bombs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.col = new Float32Array(capacity * 3);
    this.bombs.instanceColor = new InstancedBufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);

    this.hardware = new InstancedMesh(
      makeHardwareGeometry(),
      new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5, fog: false }),
      capacity
    );
    this.hardware.instanceMatrix = this.bombs.instanceMatrix; // shared transforms

    const quad = new PlaneGeometry(9, 9);
    quad.translate(0, 0, BOMB_RADIUS + 0.8);
    this.glyph = new Float32Array(capacity * 2);
    quad.setAttribute("aGlyph", new InstancedBufferAttribute(this.glyph, 2).setUsage(DynamicDrawUsage));
    this.glyphs = new InstancedMesh(
      quad,
      new ShaderMaterial({
        vertexShader: GLYPH_VERT,
        fragmentShader: GLYPH_FRAG,
        uniforms: { uMap: { value: glyphAtlas } },
        transparent: true,
        depthWrite: false,
      }),
      capacity
    );
    this.glyphs.instanceMatrix = this.bombs.instanceMatrix;
    this.glyphs.renderOrder = 5;
    for (const mesh of [this.bombs, this.hardware, this.glyphs]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
    }
  }

  // Swap the sphere material for the cheaper one on the low quality tier.
  setQuality(high: boolean) {
    const old = this.bombs.material as Material;
    this.bombs.material = makeBombMaterial(high);
    old.dispose();
  }

  begin() {
    this.count = 0;
  }

  // Add the bomb described by this.draw. `flicker` is the spark scale.
  add() {
    const d = this.draw;
    if (this.count >= this.capacity || d.scale <= 0.01) return;
    const i = this.count++;
    this.e.set(d.rotX, d.rotY, d.rotZ);
    this.q.setFromEuler(this.e);
    this.p.set(d.x, d.y, d.z);
    this.s.set(d.scale, d.scale, d.scale);
    this.m.compose(this.p, this.q, this.s);
    if (d.squash !== 0) {
      // Squash in screen space around the bomb centre: R * S * R^-1
      const c = Math.cos(d.squashAngle);
      const sn = Math.sin(d.squashAngle);
      const a = 1 + d.squash;
      const b = 1 - d.squash * 0.85;
      this.t.set(
        c * c * a + sn * sn * b, c * sn * (a - b), 0, 0,
        c * sn * (a - b), sn * sn * a + c * c * b, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      );
      // apply about the centre: T * Sq * T^-1 * M
      this.m.setPosition(0, 0, 0);
      this.m.premultiply(this.t);
      this.m.setPosition(d.x, d.y, d.z);
    }
    this.m.toArray(this.bombs.instanceMatrix.array, i * 16);

    const base = colorAt(bombBase, d.colorIndex);
    this.col[i * 3] = base.r;
    this.col[i * 3 + 1] = base.g;
    this.col[i * 3 + 2] = base.b;
    this.fx[i * 2] = d.glow;
    this.fx[i * 2 + 1] = d.tint;
    const gi = ((d.colorIndex % GLYPH_COUNT) + GLYPH_COUNT) % GLYPH_COUNT;
    this.glyph[i * 2] = gi;
    this.glyph[i * 2 + 1] = this.glyphAlpha * (1 - d.tint);

    const k = d.scale;
    if (d.halo > 0) {
      this.glow.add(d.x, d.y, d.z - 18 * k, 72 * k, 72 * k, colorAt(bombGlow, d.colorIndex), this.haloAlpha * d.halo);
    }
    if (d.spark > 0) {
      this.tip.copy(TIP).applyMatrix4(this.m);
      const sz = 11 * k * d.spark;
      this.glow.add(this.tip.x, this.tip.y, this.tip.z, sz, sz, this.sparkColor, 0.95);
    }
    if (d.shadow) this.shadows.add(d.x + 3 * k, d.y - 6 * k, -23, 40 * k, 18 * k, this.shadowColor);
  }

  end() {
    const n = this.count;
    for (const mesh of [this.bombs, this.hardware, this.glyphs]) mesh.count = n;
    this.bombs.instanceMatrix.needsUpdate = true;
    if (this.bombs.instanceColor) this.bombs.instanceColor.needsUpdate = true;
    (this.bombs.geometry.getAttribute("aFx") as InstancedBufferAttribute).needsUpdate = true;
    (this.glyphs.geometry.getAttribute("aGlyph") as InstancedBufferAttribute).needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.bombs, this.hardware, this.glyphs]) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
  }
}
