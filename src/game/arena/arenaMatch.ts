// Arena 360 matching rules: same-colour groups and orphan detection.
// "Touching" = centre distance <= 2 * bombRadius * connectScale.

import type { SimBomb, SpatialGrid } from "./arenaPhysics";

// Reusable flood-fill state so the hot path does not allocate per call.
export class GroupFinder {
  private stamp = new Int32Array(256);
  private epoch = 0;
  private readonly queue: number[] = [];
  private readonly near: number[] = [];

  private begin(n: number) {
    if (this.stamp.length < n) this.stamp = new Int32Array(n * 2);
    this.epoch++;
    if (this.epoch > 2_000_000_000) {
      this.stamp.fill(0);
      this.epoch = 1;
    }
  }

  // Connected bombs reachable from `start` (index into `bombs`). With
  // `sameColor`, only bombs of start's colour are followed. `grid` must have
  // been built from `bombs`. Returns indices (fresh array).
  group(bombs: readonly SimBomb[], grid: SpatialGrid, start: number, link: number, sameColor: boolean): number[] {
    this.begin(bombs.length);
    return this.flood(bombs, grid, start, link, sameColor);
  }

  // Same-colour bombs connected to a virtual bomb of `color` at (x, z) — the
  // would-pop preview. Read-only. Returns indices (fresh array).
  groupFromPoint(bombs: readonly SimBomb[], grid: SpatialGrid, x: number, z: number, color: number, link: number): number[] {
    this.begin(bombs.length);
    const out: number[] = [];
    const linkSq = link * link;
    for (const j of grid.query(x, z, link, this.near)) {
      const b = bombs[j];
      if (b.colorIndex === color && (b.x - x) ** 2 + (b.z - z) ** 2 <= linkSq) out.push(j);
    }
    const seeds = out.splice(0);
    for (const s of seeds) {
      if (this.stamp[s] !== this.epoch) out.push(...this.flood(bombs, grid, s, link, true));
    }
    return out;
  }

  // Connected components (any colour) that contain at least one of `seeds`
  // and have <= maxSize bombs. Components larger than maxSize are abandoned
  // early. Returns indices of every bomb in such a component.
  smallComponents(
    bombs: readonly SimBomb[],
    grid: SpatialGrid,
    seeds: readonly number[],
    link: number,
    maxSize: number
  ): number[] {
    this.begin(bombs.length);
    const result: number[] = [];
    for (const s of seeds) {
      if (this.stamp[s] === this.epoch) continue;
      const comp = this.flood(bombs, grid, s, link, false, maxSize + 1);
      if (comp.length <= maxSize) result.push(...comp);
    }
    return result;
  }

  private flood(
    bombs: readonly SimBomb[],
    grid: SpatialGrid,
    start: number,
    link: number,
    sameColor: boolean,
    limit = Infinity
  ): number[] {
    const linkSq = link * link;
    const color = bombs[start].colorIndex;
    const out: number[] = [start];
    const queue = this.queue;
    queue.length = 0;
    queue.push(start);
    this.stamp[start] = this.epoch;
    let head = 0;
    while (head < queue.length) {
      const a = bombs[queue[head++]];
      grid.query(a.x, a.z, link, this.near);
      for (const j of this.near) {
        if (this.stamp[j] === this.epoch) continue;
        const b = bombs[j];
        if (sameColor && b.colorIndex !== color) continue;
        if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > linkSq) continue;
        this.stamp[j] = this.epoch;
        out.push(j);
        queue.push(j);
        // Big component: keep marking (so other seeds in it are skipped) but
        // the caller only needs to know it exceeded the limit.
        if (out.length >= limit) {
          this.markRest(bombs, grid, queue, head, link);
          return out;
        }
      }
    }
    return out;
  }

  // Finish marking a component without collecting it (orphan search).
  private markRest(bombs: readonly SimBomb[], grid: SpatialGrid, queue: number[], head: number, link: number) {
    const linkSq = link * link;
    while (head < queue.length) {
      const a = bombs[queue[head++]];
      grid.query(a.x, a.z, link, this.near);
      for (const j of this.near) {
        if (this.stamp[j] === this.epoch) continue;
        const b = bombs[j];
        if ((b.x - a.x) ** 2 + (b.z - a.z) ** 2 > linkSq) continue;
        this.stamp[j] = this.epoch;
        queue.push(j);
      }
    }
  }
}
