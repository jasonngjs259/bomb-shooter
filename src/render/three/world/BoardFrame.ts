// The board's physical frame: translucent backplate with hex-cell dots,
// neon rail tubes, the ceiling slab (hazard stripe, neon underline, rivets,
// shot-counter pips) and the dashed danger line.
// World space = board units with y flipped: world (x, -y).

import {
  BoxGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh,
  Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, ShaderMaterial,
  SphereGeometry, Vector2,
} from "three";
import { BoardMetrics } from "../../../game/types";
import { color, HEX, srgb } from "../palette";

export const SLAB_HEIGHT = 26;
const SLAB_DEPTH = 30;
const SLAB_Z = -5;
const SIDE = 8; // frame overhang beyond the walls

const BACK_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec2 vBoard;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vBoard = vec2(w.x, -w.y);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BACK_FRAG = /* glsl */ `
uniform vec2 uHalf;
uniform float uParity;
uniform float uOffsetY;
uniform float uGridH;
uniform vec3 cBack;
uniform vec3 cEdge;
varying vec2 vLocal;
varying vec2 vBoard;
void main() {
  vec2 q = abs(vLocal) - (uHalf - 18.0);
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 18.0;
  float inside = smoothstep(1.0, -1.0, sdf);
  vec3 col = cBack;
  float a = 0.72;
  // faint dot at every hex cell centre
  float by = vBoard.y - uOffsetY;
  float row = floor((by - 20.0) / 34.0 + 0.5);
  float yc = row * 34.0 + 20.0;
  float xo = mod(row + uParity, 2.0) * 20.0;
  float xc = floor((vBoard.x - xo) / 40.0) * 40.0 + 20.0 + xo;
  float cellDot = smoothstep(2.2, 1.2, length(vec2(vBoard.x - xc, by - yc))) * step(by, uGridH);
  col += vec3(1.0) * cellDot * 0.07;
  // shooter zone: darker with a cyan seam
  float zone = step(uGridH, vBoard.y);
  col *= 1.0 - zone * 0.35;
  col += cEdge * 0.35 * exp(-abs(vBoard.y - uGridH - 2.0) * 0.6) * zone;
  // inner rim light
  col += cEdge * 0.35 * smoothstep(-5.0, -1.0, sdf);
  gl_FragColor = vec4(col, a * inside);
}`;

const RAIL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vTint;
void main() {
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vTint = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const RAIL_FRAG = /* glsl */ `
uniform float uBright;
varying vec3 vN;
varying vec3 vTint;
void main() {
  float core = pow(abs(normalize(vN).z), 5.0);
  gl_FragColor = vec4(mix(vTint * uBright, vec3(1.0), core), 1.0);
}`;

const STRIPE_FRAG = /* glsl */ `
uniform vec3 cA;
uniform vec3 cB;
varying vec2 vBoard;
void main() {
  float s = step(0.5, fract((vBoard.x + vBoard.y) / 12.0));
  gl_FragColor = vec4(mix(cA, cB, s), 1.0);
}`;

const DANGER_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 cDanger;
varying vec2 vBoard;
void main() {
  float on = step(fract(vBoard.x / 14.0), 8.0 / 14.0);
  gl_FragColor = vec4(cDanger * 1.2, uAlpha * max(on, 0.15));
}`;

export interface FrameState {
  slabBottom: number; // board y of the slab's lower edge (incl. slam offset)
  rattle: number; // x offset (u)
  gridOffsetY: number; // slam offset applied to the cell dots
  parity: number;
  shotsUsed: number;
  pipBlink: boolean; // last shot before the slam
  time: number;
  dangerAlpha: number;
  railLeft: Color;
  railRight: Color;
  railBright: number;
}

export class BoardFrame {
  readonly group = new Group();
  private readonly back: Mesh;
  private readonly rails: InstancedMesh;
  private readonly slab: Mesh;
  private readonly stripe: Mesh;
  private readonly underline: Mesh;
  private readonly rivets: InstancedMesh;
  private readonly pips: InstancedMesh;
  private readonly danger: Mesh;
  private readonly materials: Material[] = [];
  private readonly mat = new Matrix4();
  private readonly pipOn = color(HEX.magenta);
  private readonly pipOff = color(HEX.slabTop);
  private readonly pipDanger = color(HEX.danger);
  private readonly m: BoardMetrics;

  constructor(metrics: BoardMetrics) {
    this.m = metrics;
    const W = metrics.width;
    const H = metrics.height;
    const reg = <T extends Material>(mat: T) => {
      this.materials.push(mat);
      return mat;
    };

    // Backplate
    const bw = W + SIDE * 2;
    const backMat = reg(
      new ShaderMaterial({
        vertexShader: BACK_VERT,
        fragmentShader: BACK_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uHalf: { value: new Vector2(bw / 2, H / 2) },
          uParity: { value: 0 },
          uOffsetY: { value: 0 },
          uGridH: { value: metrics.gridHeight },
          cBack: { value: srgb(HEX.boardBack) },
          cEdge: { value: srgb(HEX.cyan) },
        },
      })
    );
    this.back = new Mesh(new PlaneGeometry(bw, H), backMat);
    this.back.position.set(W / 2, -H / 2, -24);
    this.back.renderOrder = 1;

    // Rails: neon tubes just outside the bounce walls
    const railMat = reg(
      new ShaderMaterial({ vertexShader: RAIL_VERT, fragmentShader: RAIL_FRAG, uniforms: { uBright: { value: 1 } } })
    );
    const railLen = H + SLAB_HEIGHT;
    this.rails = new InstancedMesh(new CylinderGeometry(2.6, 2.6, railLen, 14, 1), railMat, 2);
    this.rails.instanceColor = new InstancedBufferAttribute(new Float32Array(6), 3).setUsage(DynamicDrawUsage);
    for (let i = 0; i < 2; i++) {
      this.mat.makeTranslation(i === 0 ? -3 : W + 3, -(railLen / 2 - SLAB_HEIGHT), 2);
      this.rails.setMatrixAt(i, this.mat);
    }

    // Ceiling slab (scaled each frame as ceiling rows are added)
    this.slab = new Mesh(
      new BoxGeometry(1, 1, 1),
      reg(new MeshStandardMaterial({ color: HEX.slab, metalness: 0.55, roughness: 0.42, fog: false }))
    );
    const stripeMat = reg(
      new ShaderMaterial({
        vertexShader: BACK_VERT,
        fragmentShader: STRIPE_FRAG,
        uniforms: { cA: { value: srgb(HEX.magenta) }, cB: { value: srgb(HEX.bgTop) } },
      })
    );
    this.stripe = new Mesh(new PlaneGeometry(bw, 8), stripeMat);
    this.underline = new Mesh(
      new BoxGeometry(bw, 2.2, 2.2),
      reg(new MeshBasicMaterial({ color: HEX.magenta, toneMapped: false, fog: false }))
    );
    this.rivets = new InstancedMesh(
      new SphereGeometry(2.2, 10, 8),
      reg(new MeshStandardMaterial({ color: HEX.rivet, metalness: 0.8, roughness: 0.3, fog: false })),
      4
    );
    this.pips = new InstancedMesh(
      new BoxGeometry(11, 6, 2),
      reg(new MeshBasicMaterial({ color: "#ffffff", toneMapped: false, fog: false })),
      5
    );
    this.pips.instanceColor = new InstancedBufferAttribute(new Float32Array(15), 3).setUsage(DynamicDrawUsage);

    // Danger line
    const dangerMat = reg(
      new ShaderMaterial({
        vertexShader: BACK_VERT,
        fragmentShader: DANGER_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uAlpha: { value: 0.3 }, cDanger: { value: srgb(HEX.danger) } },
      })
    );
    this.danger = new Mesh(new PlaneGeometry(W, 3), dangerMat);
    this.danger.position.set(W / 2, -metrics.deadlineY, -1);
    this.danger.renderOrder = 2;

    this.group.add(this.back, this.rails, this.slab, this.stripe, this.underline, this.rivets, this.pips, this.danger);
    for (const o of this.group.children) o.frustumCulled = false;
  }

  update(s: FrameState) {
    const W = this.m.width;
    const bw = W + SIDE * 2;
    const top = s.gridOffsetY - SLAB_HEIGHT; // slab grows down as ceiling rows are added
    const h = s.slabBottom - top;
    this.slab.scale.set(bw, h, SLAB_DEPTH);
    this.slab.position.set(W / 2 + s.rattle, -(top + h / 2), SLAB_Z);
    const front = SLAB_Z + SLAB_DEPTH / 2 + 0.2;
    this.stripe.position.set(W / 2 + s.rattle, -(s.slabBottom - 4), front);
    this.underline.position.set(W / 2 + s.rattle, -(s.slabBottom + 0.6), front - 1);
    const faceY = -(s.slabBottom - 17);
    const rivetX = [16, 64, W - 64, W - 16];
    rivetX.forEach((x, i) => {
      this.mat.makeTranslation(x + s.rattle, faceY, front);
      this.rivets.setMatrixAt(i, this.mat);
    });
    this.rivets.instanceMatrix.needsUpdate = true;
    const blinkOn = Math.floor(s.time * 8) % 2 === 0;
    for (let i = 0; i < 5; i++) {
      this.mat.makeTranslation(W / 2 + (i - 2) * 17 + s.rattle, faceY, front);
      this.pips.setMatrixAt(i, this.mat);
      const c = s.pipBlink ? (blinkOn ? this.pipDanger : this.pipOff) : i < s.shotsUsed ? this.pipOn : this.pipOff;
      this.pips.setColorAt(i, c);
    }
    this.pips.instanceMatrix.needsUpdate = true;
    if (this.pips.instanceColor) this.pips.instanceColor.needsUpdate = true;

    this.rails.setColorAt(0, s.railLeft);
    this.rails.setColorAt(1, s.railRight);
    if (this.rails.instanceColor) this.rails.instanceColor.needsUpdate = true;
    (this.rails.material as ShaderMaterial).uniforms.uBright.value = s.railBright;

    const bu = (this.back.material as ShaderMaterial).uniforms;
    bu.uParity.value = s.parity;
    bu.uOffsetY.value = s.gridOffsetY;
    (this.danger.material as ShaderMaterial).uniforms.uAlpha.value = s.dangerAlpha;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}
