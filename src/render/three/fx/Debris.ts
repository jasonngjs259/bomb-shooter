// Bomb-shell shards: instanced tetrahedra that fly out, spin, tumble toward
// the camera and fall with gravity (spec: life 700ms, cap 18 per pop).

import {
  Color, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial,
  Quaternion, TetrahedronGeometry, Vector3,
} from "three";
import { HEX, color } from "../palette";

const LIFE = 0.7;
const GRAVITY = -1400; // world units/s^2 (world y is up)

export class Debris {
  readonly mesh: InstancedMesh;
  private n = 0;
  private readonly cap: number;
  private readonly s: Float32Array; // x y z vx vy vz rx ry rz wx wy wz age size
  private readonly tint: Float32Array; // r g b
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly sc = new Vector3();
  private readonly metal = color(HEX.metal);
  private readonly c = new Color();

  constructor(capacity: number) {
    this.cap = capacity;
    this.s = new Float32Array(capacity * 14);
    this.tint = new Float32Array(capacity * 3);
    this.mesh = new InstancedMesh(
      new TetrahedronGeometry(4.5),
      new MeshStandardMaterial({ color: "#ffffff", metalness: 0.6, roughness: 0.4, flatShading: true, fog: false }),
      capacity
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  spawn(x: number, y: number, z: number, speed: number, tintColor: Color) {
    if (this.n >= this.cap) return;
    const o = this.n * 14;
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.6 + Math.random() * 0.6);
    const spin = () => (Math.random() < 0.5 ? -1 : 1) * (6.3 + Math.random() * 6.3); // 360-720 deg/s
    this.s.set(
      [x, y, z, Math.cos(a) * v, Math.sin(a) * v + 150, 60 + Math.random() * 260,
        Math.random() * 6, Math.random() * 6, Math.random() * 6, spin(), spin(), spin(), 0, 0.8 + Math.random() * 0.6],
      o
    );
    this.c.copy(this.metal).lerp(tintColor, 0.35);
    this.tint.set([this.c.r, this.c.g, this.c.b], this.n * 3);
    this.n++;
  }

  clear() {
    this.n = 0;
  }

  update(dt: number) {
    let i = 0;
    const s = this.s;
    while (i < this.n) {
      const o = i * 14;
      s[o + 12] += dt;
      if (s[o + 12] >= LIFE) {
        const j = --this.n;
        s.copyWithin(o, j * 14, j * 14 + 14);
        this.tint.copyWithin(i * 3, j * 3, j * 3 + 3);
        continue;
      }
      s[o + 4] += GRAVITY * dt;
      for (let k = 0; k < 3; k++) {
        s[o + k] += s[o + 3 + k] * dt;
        s[o + 6 + k] += s[o + 9 + k] * dt;
      }
      i++;
    }
    const cols = this.mesh.instanceColor?.array as Float32Array;
    for (let k = 0; k < this.n; k++) {
      const o = k * 14;
      const age = s[o + 12];
      const fade = age > LIFE - 0.2 ? (LIFE - age) / 0.2 : 1;
      this.p.set(s[o], s[o + 1], s[o + 2]);
      this.e.set(s[o + 6], s[o + 7], s[o + 8]);
      this.q.setFromEuler(this.e);
      const size = s[o + 13] * fade;
      this.sc.set(size, size, size);
      this.m.compose(this.p, this.q, this.sc);
      this.m.toArray(this.mesh.instanceMatrix.array, k * 16);
      cols[k * 3] = this.tint[k * 3];
      cols[k * 3 + 1] = this.tint[k * 3 + 1];
      cols[k * 3 + 2] = this.tint[k * 3 + 2];
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
