// Aim guide: marching additive dots along the engine's predicted path
// (max 900u / 2 bounces), bounce markers with rotating ticks, a ghost bomb +
// rotating dashed ring at the landing cell, and a shimmer on the bombs the
// shot would pop (cheap flood fill, cached per board revision + target).

import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, SphereGeometry,
} from "three";
import { AimPath, RenderTile, Vec2 } from "../../../game/types";
import { SpriteBatch } from "../fx/SpriteBatch";
import { bombGlow, color, colorAt, HEX } from "../palette";
import { lerp } from "./easing";

const MAX_LEN = 900;
const MAX_BOUNCES = 2;
const SPACING = 14;
const SKIP = 30;

const dashedRing = (r0: number, r1: number, dashes: number, seg = 4) => {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < dashes; k++) {
    const a0 = (k / dashes) * Math.PI * 2;
    const span = (Math.PI / dashes) * 1.1;
    const base = pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const a = a0 + (span * s) / seg;
      pos.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    for (let s = 0; s < seg; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
};

export class AimGuide {
  readonly group = new Group();
  private readonly ghost: Mesh;
  private readonly dashed: Mesh;
  private readonly white = color(HEX.white);
  private readonly dotColor = new Color();
  private popKey = "";
  private popTiles: RenderTile[] = [];
  private tilesRef: RenderTile[] | null = null;

  constructor() {
    this.ghost = new Mesh(
      new SphereGeometry(19, 20, 14),
      new MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, fog: false })
    );
    this.dashed = new Mesh(
      dashedRing(20.5, 23, 14),
      new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false })
    );
    this.ghost.renderOrder = 6;
    this.dashed.renderOrder = 6;
    this.group.add(this.ghost, this.dashed);
  }

  hide() {
    this.group.visible = false;
  }

  update(
    path: AimPath, alpha: number, colorIndex: number, time: number, still: boolean,
    tiles: RenderTile[], glow: SpriteBatch, rings: SpriteBatch
  ) {
    if (alpha <= 0.01) {
      this.group.visible = false;
      return;
    }
    const gc = colorAt(bombGlow, colorIndex);
    // Walk the polyline: dots every SPACING, marching at 40u/s
    const pts = path.points;
    let walked = 0;
    let carry = SKIP + (still ? 0 : (time * 40) % SPACING);
    let reachedEnd = true;
    const bounceLimit = Math.min(pts.length - 1, MAX_BOUNCES + 1);
    for (let i = 1; i <= bounceLimit; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let dd = carry;
      while (dd <= len && walked + dd <= MAX_LEN) {
        const t = dd / len;
        const f = (walked + dd) / MAX_LEN;
        const r = lerp(3.5, 2, f);
        this.dotColor.copy(gc).lerp(this.white, 0.35);
        glow.add(a.x + (b.x - a.x) * t, -(a.y + (b.y - a.y) * t), 4, r * 6, r * 6, this.dotColor, lerp(0.9, 0.15, f) * alpha);
        dd += SPACING;
      }
      carry = dd - len;
      walked += len;
      if (walked > MAX_LEN) {
        reachedEnd = false;
        break;
      }
      // bounce marker (not at the final end point)
      if (i < pts.length - 1) {
        rings.add(b.x, -b.y, 5, 16, 16, this.white, 0.7 * alpha);
        const rot = still ? 0 : time * (Math.PI / 2);
        for (let k = 0; k < 4; k++) {
          const ang = rot + (k * Math.PI) / 2;
          glow.add(b.x + Math.cos(ang) * 10, -b.y + Math.sin(ang) * 10, 5, 8, 3, this.white, 0.6 * alpha, ang);
        }
      }
    }
    if (pts.length - 1 > bounceLimit) reachedEnd = false;

    const target = reachedEnd ? path.target : null;
    this.group.visible = true;
    this.ghost.visible = this.dashed.visible = !!target;
    if (!target) return;
    this.ghost.position.set(target.x, -target.y, 0);
    const gm = this.ghost.material as MeshBasicMaterial;
    gm.color.copy(gc);
    gm.opacity = 0.35 * alpha;
    this.dashed.position.set(target.x, -target.y, 20);
    this.dashed.rotation.z = still ? 0 : -(time / 6) * Math.PI * 2;
    (this.dashed.material as MeshBasicMaterial).opacity = 0.6 * alpha;

    // Would-pop shimmer
    const popped = this.wouldPop(target, colorIndex, tiles);
    if (popped.length >= 2) {
      const pulse = 0.5 + 0.5 * Math.sin((time * Math.PI * 2) / 0.6);
      for (const t of popped) rings.add(t.x, -t.y, 21, 50, 50, this.white, (0.3 + 0.35 * pulse) * alpha);
    }
  }

  private wouldPop(target: Vec2 & { col: number; row: number }, colorIndex: number, tiles: RenderTile[]) {
    const key = `${target.col},${target.row},${colorIndex}`;
    if (key === this.popKey && tiles === this.tilesRef) return this.popTiles;
    this.popKey = key;
    this.tilesRef = tiles;
    const same = tiles.filter((t) => t.colorIndex === colorIndex && t.state === "idle");
    const found: RenderTile[] = [];
    const seen = new Set<number>();
    const queue: Vec2[] = [target];
    const R2 = 42 * 42;
    while (queue.length > 0) {
      const p = queue.pop() as Vec2;
      for (const t of same) {
        if (seen.has(t.id)) continue;
        if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 < R2) {
          seen.add(t.id);
          found.push(t);
          queue.push(t);
        }
      }
    }
    this.popTiles = found.length + 1 >= 3 ? found : [];
    return this.popTiles;
  }

  dispose() {
    for (const m of [this.ghost, this.dashed]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  }
}
