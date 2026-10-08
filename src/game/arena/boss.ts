// BOSS "CORE WARDEN Mk n" (L3, L6, L9, every 3rd level).
//   Core r 1.35 at distance 11.5 in a +-35 deg ring gap, creeping 0.018 w/s
//   (x3 in phase 3), riding the ring rotation. Shield: N bombs orbiting at
//   r 2.3; a matching (or wild / rainbow) shot pops one, any other colour
//   deflects; one regrows every `regrow` s in phases 1-2. HP 10 / 14 / 18;
//   1 damage per shot, 2 for the weak colour (cycles every 6 s, telegraphed
//   1 s ahead). Phase 2 at <= 60% (orbit x1.35 reversed; Mk I spits 3 bombs
//   onto the ring every 12 s, Mk II+ launches a roller every 9 s), phase 3 at
//   <= 25% (shield shatters, no regrow, core creep x3, ring creep x1.25).
//   Each shift: 1.2 s invulnerable, ring knocked ~0.5 w out, one guaranteed
//   pickup. HP 0: +1500 x Mk, the ring chain-shatters (30 ms per 22.5 deg) -> won.
//   Lose: the core edge touches the border.

import type { ArenaCore } from "./arenaCore";
import { makeBomb } from "./arenaLayout";
import { startShatter } from "./arenaSim";
import type { BossShieldBomb, BossState } from "./funTypes";
import type { FxBomb } from "./types";

const DEG = Math.PI / 180;
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Boss {
  state: BossState | null = null;
  private dist = 0;
  private angle = 0;
  private offset = 0; // shield ring rotation
  private dir = 1;
  private regrowT = 0;
  private spitT = 0;
  private rollerT = 0;
  private invulnT = 0;
  private slots: (BossShieldBomb | null)[] = [];

  constructor(private readonly core: ArenaCore) {}

  get coreAngle() {
    return this.angle;
  }

  reset(angle: number | null) {
    const core = this.core, d = core.def.boss, b = core.fun.boss;
    this.slots = [];
    if (!d || angle === null) {
      this.state = null;
      return;
    }
    this.dist = b.coreDist;
    this.angle = angle;
    this.offset = 0;
    this.dir = 1;
    this.regrowT = this.spitT = this.rollerT = this.invulnT = 0;
    const weak = core.pickColor();
    this.state = {
      mk: d.mk, id: core.nextId++, x: 0, z: 0, r: b.coreR, hp: d.coreHp, maxHp: d.coreHp, phase: 1,
      weakColor: weak, nextWeakColor: this.otherColor(weak), weakIn: b.weakCycle, shield: [], shieldRadius: b.shieldR,
      orbitSpeed: 0, invulnerable: false,
    };
    for (let i = 0; i < d.shield; i++) this.slots.push(this.newShield(i, 1));
    this.place();
  }

  // Level start events (after phaseChanged -> playing).
  announce() {
    const st = this.state;
    if (!st) return;
    this.core.emit("bossSpawned", { mk: st.mk, hp: st.hp, shield: st.shield.length });
    this.core.emit("bossWeakColor", { colorIndex: st.weakColor, next: st.nextWeakColor, in: st.weakIn });
    this.core.intro("boss");
  }

  // Edge-to-border gap of the core (Infinity without a boss).
  coreGap() {
    return this.state ? this.dist - this.state.r - this.core.config.arenaRadius : Infinity;
  }

  ringCreepScale() {
    return this.state && this.state.phase === 3 ? this.core.fun.boss.p3RingCreepScale : 1;
  }

  update(dt: number) {
    const st = this.state;
    if (!st || st.hp <= 0) return;
    const core = this.core, b = core.fun.boss, d = core.def.boss!;
    const run = core.worldPaused ? 0 : dt;
    this.invulnT = Math.max(0, this.invulnT - dt);
    st.invulnerable = this.invulnT > 0;
    // Weak colour cycle (game time; it is the player's information)
    st.weakIn -= dt;
    if (st.weakIn <= 0) {
      st.weakColor = st.nextWeakColor;
      st.nextWeakColor = this.otherColor(st.weakColor);
      st.weakIn += b.weakCycle;
      core.emit("bossWeakColor", { colorIndex: st.weakColor, next: st.nextWeakColor, in: st.weakIn });
    }
    // Creep + ride the rotation + orbit
    this.dist -= b.creep * (st.phase === 3 ? b.p3CreepScale : 1) * run;
    this.angle += core.sys.ring.omega[0] * dt;
    const orbit = d.orbit * DEG * (st.phase >= 2 ? b.p2OrbitScale : 1) * this.dir;
    st.orbitSpeed = core.worldPaused ? 0 : orbit;
    this.offset += orbit * run;
    // Regrow (phases 1-2)
    let count = 0;
    for (const s of this.slots) if (s) count++;
    if (st.phase < 3 && count < d.shield) {
      this.regrowT += run;
      if (this.regrowT >= d.regrow) {
        this.regrowT = 0;
        this.regrow();
      }
    } else this.regrowT = 0;
    for (const s of this.slots) if (s && s.scale < 1) s.scale = Math.min(1, s.scale + run / b.growTime);
    // Phase 2 attacks
    if (st.phase === 2) {
      if (d.mk === 1) {
        this.spitT += run;
        if (this.spitT >= b.spitEvery) {
          this.spitT = 0;
          this.spit();
        }
      } else {
        this.rollerT += run;
        if (this.rollerT >= b.rollerEvery && core.sys.rollers.live < core.def.rollersLive) {
          this.rollerT = 0;
          const s = core.shooter, dx = s.x - st.x, dz = s.z - st.z, l = Math.hypot(dx, dz) || 1;
          core.sys.rollers.spawn(core.nextId++, st.x + (dx / l) * (st.r + 0.5), st.z + (dz / l) * (st.r + 0.5), core.pickColor());
        }
      }
    }
    this.place();
  }

  // A shot (or Mega / Lightning) reached shield bomb `id`. `any` = colour
  // doesn't matter (wild, rainbow, mega, lightning). True = popped.
  hitShield(id: number, colorIndex: number, any: boolean): boolean {
    const i = this.slots.findIndex((s) => s !== null && s.id === id);
    if (i < 0) return false;
    const s = this.slots[i]!;
    if (!any && s.colorIndex !== colorIndex) return false;
    this.popShield(i, true);
    return true;
  }

  // Core damage. Returns the damage dealt (0 while invulnerable).
  damage(amount: number, weak: boolean, x: number, z: number): number {
    const st = this.state, core = this.core, b = core.fun.boss;
    if (!st || st.hp <= 0) return 0;
    const dealt = st.invulnerable ? 0 : Math.min(st.hp, amount);
    st.hp -= dealt;
    core.emit("bossHit", { damage: dealt, weak, hp: st.hp, maxHp: st.maxHp, x, z });
    if (dealt === 0) return 0;
    const pts = (weak ? b.weakScore : b.hitScore) * (core.sys.fever.active ? core.fun.fever.scoreMult : 1);
    core.sys.fever.noteScore(pts);
    core.addScore(pts);
    if (st.hp <= 0) this.kill();
    else this.checkPhase();
    return dealt;
  }

  // Dev / tests.
  debugSetHp(hp: number) {
    const st = this.state;
    if (!st) return;
    st.hp = Math.max(0, Math.min(st.maxHp, Math.round(hp)));
    if (st.hp <= 0) this.kill();
    else this.checkPhase();
  }

  private checkPhase() {
    const st = this.state!, b = this.core.fun.boss;
    const to: 1 | 2 | 3 = st.hp <= st.maxHp * b.p3At ? 3 : st.hp <= st.maxHp * b.p2At ? 2 : 1;
    if (to <= st.phase) return;
    const previous = st.phase;
    st.phase = to;
    this.invulnT = b.shiftInvuln;
    st.invulnerable = true;
    if (previous < 2) this.dir = -this.dir;
    if (to === 3) for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.popShield(i, false);
    this.core.sys.ring.kickOutward(b.shiftKick);
    this.core.sys.pickups.forceDrop(st.x, st.z);
    this.core.emit("bossPhase", { phase: to, previous });
  }

  private kill() {
    const core = this.core, st = this.state!, b = core.fun.boss;
    const bonus = b.killScorePerMk * st.mk;
    core.emit("bossDefeated", { mk: st.mk, score: bonus, time: core.time });
    core.timeScale.trigger(b.hitStopScale, b.hitStop, 0);
    core.emit("slowMo", { scale: b.hitStopScale, realDuration: b.hitStop, ramp: 0 });
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = null;
    this.syncShield();
    const shattered: FxBomb[] = [];
    const sector = b.sectorDeg * DEG;
    for (const o of core.active) {
      startShatter(o, core.config);
      o.age = -Math.floor(angDist(Math.atan2(o.z, o.x), this.angle) / sector) * b.chainPerSector;
      shattered.push({ id: o.id, x: o.x, z: o.z, colorIndex: o.colorIndex });
    }
    core.refreshActive();
    if (shattered.length) core.emit("shatter", { bombs: shattered });
    core.addScore(bonus + shattered.length * b.chainScore);
    core.sys.stars.win();
  }

  private popShield(i: number, scored: boolean) {
    const core = this.core, s = this.slots[i]!;
    this.slots[i] = null;
    this.syncShield();
    core.emit("bossShieldPop", { id: s.id, x: s.x, z: s.z, colorIndex: s.colorIndex, remaining: this.state!.shield.length });
    if (!scored) return;
    core.bumpCombo();
    core.sys.fever.add(core.fun.fever.shieldPopFill);
    const pts = core.fun.boss.shieldScore * (core.sys.fever.active ? core.fun.fever.scoreMult : 1);
    core.sys.fever.noteScore(pts);
    core.addScore(pts);
  }

  private regrow() {
    const empty: number[] = [];
    this.slots.forEach((s, i) => s === null && empty.push(i));
    if (!empty.length) return;
    const i = empty[Math.floor(this.core.random() * empty.length)];
    const s = this.newShield(i, 0);
    this.slots[i] = s;
    this.syncShield();
    this.core.emit("bossShieldRegrow", { id: s.id });
  }

  // Mk I phase 2: 3 bombs land just outside random ring bombs.
  private spit() {
    const core = this.core, b = core.fun.boss;
    if (core.active.length === 0) return;
    for (let k = 0; k < b.spitCount; k++) {
      const o = core.active[Math.floor(core.random() * core.active.length)];
      const r = Math.hypot(o.x, o.z) || 1, out = r + core.config.bombRadius * 2.05;
      const nb = makeBomb(core.nextId++, (o.x / r) * out, (o.z / r) * out, core.pickColor());
      core.bombs.push(nb);
      core.active.push(nb);
    }
  }

  // Shield colour: present in the ring, never equal to a neighbour slot.
  private newShield(i: number, scale: number): BossShieldBomb {
    const core = this.core, n = this.core.def.boss!.shield;
    const avoid = [this.slots[(i + n - 1) % n]?.colorIndex, this.slots[(i + 1) % n]?.colorIndex];
    let color = core.pickColor();
    for (let t = 0; t < 8 && avoid.includes(color); t++) color = core.pickColor();
    if (avoid.includes(color)) for (let c = 0; c < core.config.colorCount; c++) if (!avoid.includes(c)) { color = c; break; }
    return { id: core.nextId++, angle: 0, x: 0, z: 0, colorIndex: color, scale };
  }

  private otherColor(not: number) {
    let c = this.core.pickColor();
    for (let t = 0; t < 8 && c === not && this.core.config.colorCount > 1; t++) c = this.core.pickColor();
    return c;
  }

  private place() {
    const st = this.state!, n = this.slots.length;
    st.x = Math.cos(this.angle) * this.dist;
    st.z = Math.sin(this.angle) * this.dist;
    for (let i = 0; i < n; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.angle = this.offset + (i / n) * Math.PI * 2;
      const r = st.shieldRadius * (0.35 + 0.65 * s.scale);
      s.x = st.x + Math.cos(s.angle) * r;
      s.z = st.z + Math.sin(s.angle) * r;
    }
    if (st.shield.length === 0 && this.slots.some((s) => s)) this.syncShield();
  }

  private syncShield() {
    const st = this.state!;
    st.shield.length = 0;
    for (const s of this.slots) if (s) st.shield.push(s);
  }
}
