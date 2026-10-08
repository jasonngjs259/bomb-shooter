// What happens when a shot reaches the wall: stick + match (normal, fever
// wild, Rainbow), Mega blasts, Lightning chains, and the shared pop
// resolution (armor, orphans, ticking defuses, score, fever, drops, win).
//   Armored: counts toward the 3-match; in a pop it loses its armor and stays
//   (exempt from that resolution's orphan check); an armored orphan loses its
//   armor instead of shattering; Mega removes it outright.
//   Score: (popped*10 + max(0, popped-3)*10 + shattered*20) * min(combo, 5)
//   (x2 in fever; Mega: 10 per removed bomb * combo) + 25 per armor break +
//   100 per defused ticking bomb.

import { MAX_COMBO_MULTIPLIER } from "../constants";
import type { ArenaCore } from "./arenaCore";
import { makeBomb } from "./arenaLayout";
import { SimBomb, separateOne } from "./arenaPhysics";
import { applyKnockback, borderGap, centroid, findOrphans, startShatter } from "./arenaSim";
import type { BossShieldBomb } from "./funTypes";
import type { FxBomb, ShotState, Vec2XZ } from "./types";

export const fx = (b: { id: number; x: number; z: number; colorIndex: number }): FxBomb => ({ id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex });

type ChainNode = SimBomb | BossShieldBomb;

export class Resolver {
  constructor(private readonly core: ArenaCore) {}

  // A shot reached field bomb `target` (contact at shot.x / shot.z).
  hitBomb(shot: ShotState, target: SimBomb) {
    if (shot.power === "mega") this.mega(shot.x, shot.z);
    else if (shot.power === "lightning") this.lightning(target);
    else this.stick(shot, target);
  }

  miss(x: number, z: number, deflected: boolean, pushed = false) {
    const core = this.core;
    core.combo = 0;
    core.emit("miss", pushed ? { x, z, deflected: true, pushed: true } : deflected ? { x, z, deflected: true } : { x, z });
    core.sys.fever.add(-core.fun.fever.missPenalty);
  }

  // Seat the shot as a field bomb, then match. A shot that would NOT pop and
  // whose edge would sit within deflectMargin of the border becomes a WALL
  // PUSH instead (wallPush.ts): consumed, the hit cluster is shoved outward.
  // Exception: a same-colour shot whose edge stays > push.pairMinGap outside
  // the line sticks (a pair, finished by the next match).
  private stick(shot: ShotState, target: SimBomb) {
    const core = this.core, c = core.config;
    const b = makeBomb(core.nextId++, shot.x, shot.z, shot.wild ? target.colorIndex : shot.colorIndex, true);
    b.band = target.band; // rides the band it stuck to (counter-rotating rings)
    separateOne(b, core.active, c.bombRadius, 4);
    let group: SimBomb[] | null = null;
    if (shot.power === "rainbow") {
      core.grid.build(core.active);
      const set = this.rainbowSet(b.x, b.z);
      if (set.length > 0) {
        b.colorIndex = set[0].colorIndex;
        group = set;
      } else b.colorIndex = target.colorIndex;
    }
    core.active.push(b);
    if (group) group.push(b);
    else {
      core.grid.build(core.active);
      const g = core.finder.group(core.active, core.grid, core.active.length - 1, core.link, true);
      if (g.length >= c.minMatch) group = g.map((i) => core.active[i]);
    }
    // Near the border a non-popping shot pushes, except a same-colour shot
    // landing outside the line: it sticks as a pair so the next match pops it
    // (push for room, then pair, then pop: a near-border single is always solvable).
    const gap = borderGap(b, c);
    if (!group && gap <= c.deflectMargin && !(b.colorIndex === target.colorIndex && gap > core.fun.push.pairMinGap)) {
      core.active.pop();
      core.sys.push.push(target, b.x, b.z);
      return;
    }
    core.bombs.push(b);
    core.emit("stick", { id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex, hitId: target.id });
    if (group) this.resolve(group, null, false);
    else core.combo = 0;
  }

  // Rainbow: every colour touching (x, z) whose connected group + 1 >= minMatch.
  // `grid` must be built from active. Read-only.
  rainbowSet(x: number, z: number): SimBomb[] {
    const core = this.core, out: SimBomb[] = [], seen: number[] = [];
    const linkSq = core.link * core.link;
    for (const j of core.grid.query(x, z, core.link, [])) {
      const o = core.active[j];
      if (seen.includes(o.colorIndex) || (o.x - x) ** 2 + (o.z - z) ** 2 > linkSq) continue;
      seen.push(o.colorIndex);
      const g = core.finder.groupFromPoint(core.active, core.grid, x, z, o.colorIndex, core.link);
      if (g.length + 1 >= core.config.minMatch) for (const i of g) out.push(core.active[i]);
    }
    return out;
  }

  // Mega: remove every idle field bomb within megaRadius (armor ignored),
  // pop shield bombs in reach, 3 damage if the core edge is within reach.
  mega(x: number, z: number) {
    const core = this.core, w = core.fun.powers, boss = core.sys.boss.state;
    const cands = this.megaSet(x, z);
    core.emit("megaBlast", { x, z, radius: w.megaRadius, bombs: cands.map(fx) });
    if (boss) {
      for (let i = boss.shield.length - 1; i >= 0; i--) {
        const s = boss.shield[i];
        if (s.scale >= 1 && Math.hypot(s.x - x, s.z - z) <= w.megaRadius) core.sys.boss.hitShield(s.id, s.colorIndex, true);
      }
      if (Math.hypot(boss.x - x, boss.z - z) - boss.r <= w.megaRadius) core.sys.boss.damage(w.megaCoreDamage, false, x, z);
    }
    if (cands.length > 0 && core.playing) this.resolve(cands, { x, z }, true);
  }

  megaSet(x: number, z: number): SimBomb[] {
    const r = this.core.fun.powers.megaRadius;
    return this.core.active.filter((b) => (b.x - x) ** 2 + (b.z - z) ** 2 <= r * r);
  }

  // Lightning from a field bomb or a shield bomb: BFS over same-colour nodes
  // (link <= 3.0, max 18), all pop (armor strips), arc to the core for 2.
  lightning(start: ChainNode) {
    const core = this.core, w = core.fun.powers, boss = core.sys.boss.state;
    const chain = this.lightningChain(start);
    core.emit("lightningChain", { colorIndex: start.colorIndex, path: chain.map(fx), hop: w.lightningHop });
    const field: SimBomb[] = [];
    let arc = false;
    for (const n of chain) {
      if ("state" in n) field.push(n);
      else core.sys.boss.hitShield(n.id, n.colorIndex, true);
      if (boss && Math.hypot(boss.x - n.x, boss.z - n.z) - boss.r <= w.lightningCoreReach) arc = true;
    }
    if (arc && boss) core.sys.boss.damage(w.lightningCoreDamage, start.colorIndex === boss.weakColor, boss.x, boss.z);
    if (field.length > 0 && core.playing) this.resolve(field, null, false);
  }

  lightningChain(start: ChainNode): ChainNode[] {
    const core = this.core, w = core.fun.powers, boss = core.sys.boss.state;
    const color = start.colorIndex, linkSq = w.lightningLink * w.lightningLink;
    const out: ChainNode[] = [start];
    for (let head = 0; head < out.length && out.length < w.lightningMax; head++) {
      const a = out[head];
      for (const b of core.active) {
        if (out.length >= w.lightningMax) break;
        if (b.colorIndex === color && (b.x - a.x) ** 2 + (b.z - a.z) ** 2 <= linkSq && !out.includes(b)) out.push(b);
      }
      if (!boss) continue;
      for (const s of boss.shield) {
        if (out.length >= w.lightningMax) break;
        if (s.scale >= 1 && s.colorIndex === color && (s.x - a.x) ** 2 + (s.z - a.z) ** 2 <= linkSq && !out.includes(s)) out.push(s);
      }
    }
    return out;
  }

  // Shared pop resolution for a set of field bombs leaving the wall.
  resolve(cands: readonly SimBomb[], centreAt: Vec2XZ | null, mega: boolean) {
    const core = this.core, c = core.config, fun = core.fun;
    const popped: SimBomb[] = [], breaks: SimBomb[] = [], shattered: SimBomb[] = [];
    for (const b of cands) {
      if (b.armor === 1 && !mega) {
        b.armor = 0;
        breaks.push(b);
      } else {
        b.state = "popping";
        b.age = 0;
        popped.push(b);
      }
    }
    core.refreshActive();
    if (popped.length > 0) {
      core.grid.build(core.active);
      for (const o of findOrphans(core.active, popped, c, core.grid, core.finder, core.link, core.scratch)) {
        if (breaks.includes(o)) continue;
        if (o.armor === 1) {
          o.armor = 0;
          breaks.push(o);
        } else {
          startShatter(o, c);
          shattered.push(o);
        }
      }
      core.refreshActive();
    }
    const n = popped.length + shattered.length + breaks.length;
    if (n === 0) return;
    core.bumpCombo();
    const fever = core.sys.fever;
    const mult = Math.min(core.combo, MAX_COMBO_MULTIPLIER) * (fever.active ? fun.fever.scoreMult : 1);
    const base = mega
      ? fun.powers.megaScorePerBomb * (popped.length + shattered.length)
      : popped.length * 10 + Math.max(0, popped.length - 3) * 10 + shattered.length * 20;
    let bonus = breaks.length * fun.armored.score;
    const centre = centreAt ?? centroid(popped.length ? popped : breaks);
    applyKnockback(core.active, c, centre, popped.length, (popped.length + shattered.length) * (mega ? fun.powers.megaKnockScale : 1));
    const gainedPop = base * mult;
    if (popped.length) core.emit("pop", { bombs: popped.map(fx), score: gainedPop, combo: core.combo, centre });
    if (shattered.length) core.emit("shatter", { bombs: shattered.map(fx) });
    for (const b of breaks) core.emit("armorBroken", { id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex });
    for (const b of popped) bonus += core.sys.ticking.defuse(b);
    for (const b of shattered) bonus += core.sys.ticking.defuse(b);
    fever.noteScore(gainedPop);
    fever.onPop(popped.length + breaks.length, shattered.length, core.combo);
    core.addScore(gainedPop + bonus);
    core.sys.pickups.onPop(n, centre);
    core.refreshLoadout();
    if (core.active.length === 0 && !core.sys.boss.state) core.sys.stars.win();
  }
}
