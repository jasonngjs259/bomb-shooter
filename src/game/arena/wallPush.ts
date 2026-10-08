// WALL PUSH (replaces the old near-border deflect): a shot that would NOT pop
// and would stick with its edge within deflectMargin of the border is consumed
// and shoves the bomb it hit, plus the connected cluster (any colour) within
// ARENA_FUN.push.radius of the impact, radially outward by push.distance
// (eased out over ~0.25 s by stepCreep). A bomb pushed again within
// repeatWindow s moves repeatScale as far. Neighbours get a small outward
// kick. Combo resets and fever takes the miss penalty, so it is a save, not a
// free win. Armored / ticking bombs are pushed like any other (no armor
// break, no defuse). Events: wallPush, then miss { deflected, pushed } (back-compat).

import type { ArenaCore } from "./arenaCore";
import type { SimBomb } from "./arenaPhysics";
import { fx } from "./resolve";

export class WallPush {
  private readonly cluster: SimBomb[] = [];

  constructor(private readonly core: ArenaCore) {}

  push(target: SimBomb, x: number, z: number) {
    const core = this.core, p = core.fun.push, linkSq = core.link * core.link, rSq = p.radius * p.radius;
    const cluster = this.cluster;
    cluster.length = 0;
    cluster.push(target);
    for (let head = 0; head < cluster.length; head++) {
      const a = cluster[head];
      for (const b of core.active) {
        if (cluster.includes(b) || (b.x - a.x) ** 2 + (b.z - a.z) ** 2 > linkSq || (b.x - x) ** 2 + (b.z - z) ** 2 > rSq) continue;
        cluster.push(b);
      }
    }
    const scaleOf = (b: SimBomb) => (core.time - b.lastPush < p.repeatWindow ? p.repeatScale : 1);
    const distance = p.distance * scaleOf(target);
    for (const b of cluster) {
      b.push += p.distance * scaleOf(b);
      b.lastPush = core.time;
    }
    for (const b of core.active) {
      if (cluster.includes(b)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < p.neighbourRadius) b.kick += p.neighbourKick * (1 - d / p.neighbourRadius);
    }
    core.emit("wallPush", { x, z, bombs: cluster.map(fx), distance });
    core.sys.resolve.miss(x, z, true, true);
  }
}
