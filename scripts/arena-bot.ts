// Feature-aware human-ish Arena 360 bot (fun-pass spec section 4), used by
// scripts/arena-balance.ts. Human limits: turns at most `turnDeg` deg/s via
// turn(), decides at most every `pace` s (0.4 s in fever), tracks its chosen
// target while turning (like a player following a bomb on a rotating ring).
//   Pickups: walks to one it can take within 5 w (rolls toward it > 2.5 w from L5).
//   Powers: Rainbow / Lightning at the best previewPower(); Mega at the most dangerous sector.
//   Fever: nearest bomb in view.  Ticking: an armed bomb with <= 8 s left first.
//   Rollers: shoot with lead; roll perpendicular at time-to-contact <= 0.6 s
//   (no-roll variant: never dodges, it can only shoot them).
//   Wall push: a bomb within 0.8 of the border is popped if possible, else pushed.
//   Boss: core whenever the ray reaches it (weak colour preferred, waits for a
//   shield gap), else matching shield bombs with lead (swap if next matches).

import { ARENA_CONFIG, ArenaEngine, BossDef, LevelDef, PowerKind, levelDef } from "../src/game/arena";
import { DT, make } from "./arena-kit";

const DEG = Math.PI / 180;

export interface BotResult { won: boolean; time: number; pickups: number; fevers: number; lurches: number; rollerHits: number; rolls: number; pushes: number }
export interface BotOptions {
  roll: boolean; push?: boolean; pace?: number; turnDeg?: number; maxTime?: number; trace?: (e: ArenaEngine) => void;
  patch?: Partial<LevelDef> & { bossPatch?: Partial<BossDef> }; // tuning experiments
}

type Plan =
  | { kind: "bomb"; id: number; ax: number; az: number } // aim offset from the bomb centre (stays on target while it moves)
  | { kind: "shield"; id: number }
  | { kind: "roller"; id: number }
  | { kind: "core"; wait: number }
  | { kind: "yaw"; yaw: number };

export function playBot(level: number, seed: number, o: BotOptions): BotResult {
  const pace = o.pace ?? 1.2, maxTurn = (o.turnDeg ?? 150) * DEG * DT;
  const e = make(seed);
  const r: BotResult = { won: false, time: 0, pickups: 0, fevers: 0, lurches: 0, rollerHits: 0, rolls: 0, pushes: 0 };
  e.on("wallPush", () => r.pushes++);
  e.on("pickupCollected", () => r.pickups++);
  e.on("feverStart", () => r.fevers++);
  e.on("lurch", () => r.lurches++);
  e.on("playerHit", () => r.rollerHits++);
  e.on("rollStart", () => r.rolls++);
  if (o.patch) {
    const { bossPatch, ...rest } = o.patch;
    const d = { ...levelDef(ARENA_CONFIG, level), ...rest };
    if (d.boss && bossPatch) d.boss = { ...d.boss, ...bossPatch };
    e.newGame({ level, levelDef: d });
  } else e.newGame({ level });
  const c = e.getConfig();
  let plan: Plan | null = null;
  let walkTo: { x: number; z: number } | null = null;
  let lastShot = -99;

  const idle = () => e.getBombs().filter((b) => b.state === "idle");
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const shotSpeed = () => (e.getFever().active ? 24 : c.shotSpeed);
  const aim = (x: number, z: number) => {
    e.aimAt(x, z);
    return e.getAimRay();
  };
  const bombPlan = (id: number, x: number, z: number): Plan => {
    const b = e.getBombs().find((q) => q.id === id)!;
    return { kind: "bomb", id, ax: x - b.x, az: z - b.z };
  };

  // Lead point for a shield bomb / roller (one iteration).
  const shieldPoint = (id: number) => {
    const boss = e.getBoss(), s = e.getShooter();
    const sh = boss?.shield.find((q) => q.id === id);
    if (!boss || !sh) return null;
    const a = sh.angle + boss.orbitSpeed * (dist(sh, s) / shotSpeed());
    return { x: boss.x + Math.cos(a) * boss.shieldRadius, z: boss.z + Math.sin(a) * boss.shieldRadius };
  };
  const rollerPoint = (id: number) => {
    const ro = e.getRollers().find((q) => q.id === id), s = e.getShooter();
    if (!ro) return null;
    const t = dist(ro, s) / shotSpeed();
    return { x: ro.x + ro.dirX * ro.speed * t, z: ro.z + ro.dirZ * ro.speed * t };
  };

  // Pop (or stick) candidates of `color` (-1 = any), most dangerous first when the wall is close.
  // Building (no pop) always grows the innermost group, and never where the shot would deflect.
  const popPlan = (color: number, wantPop: boolean, limit = 12): Plan | null => {
    const s = e.getShooter(), byRadius = !wantPop || e.getDangerLevel() >= 0.35;
    const key = (b: { x: number; z: number }) => (byRadius ? Math.hypot(b.x, b.z) : dist(b, s));
    const cands = idle().filter((b) => color < 0 || b.colorIndex === color).sort((a, b) => key(a) - key(b));
    for (const b of cands.slice(0, limit)) {
      const ray = aim(b.x, b.z);
      if (ray.target !== "bomb") continue;
      const landGap = ray.landing ? Math.hypot(ray.landing.x, ray.landing.z) - 6.45 : -1;
      const sticks = landGap > c.deflectMargin + 0.05 || (b.colorIndex === e.getCurrentBomb() && landGap > 0.25); // same colour pairs near the line
      if (wantPop ? ray.wouldPopIds.length > 0 : ray.hitBombId === b.id && sticks) {
        return bombPlan(b.id, b.x, b.z);
      }
    }
    return null;
  };

  const powerPlan = (kind: PowerKind): Plan | null => {
    const s = e.getShooter();
    if (kind === "mega") {
      const sectors = e.getDangerByAngle(16);
      let best = 0;
      sectors.forEach((v, i) => (v > sectors[best] ? (best = i) : 0));
      const a = ((best + 0.5) / 16) * Math.PI * 2, p = { x: Math.cos(a) * 6, z: Math.sin(a) * 6 };
      const t = idle().sort((m, n) => dist(m, p) - dist(n, p))[0];
      return t ? bombPlan(t.id, t.x, t.z) : null;
    }
    let best: Plan | null = null, bestN = 0;
    for (const b of idle().sort((m, n) => dist(m, s) - dist(n, s)).slice(0, 16)) {
      const n = e.previewPower(kind, Math.atan2(b.z - s.z, b.x - s.x)).length;
      if (n > bestN) {
        bestN = n;
        best = bombPlan(b.id, b.x, b.z);
      }
    }
    return best;
  };

  const tickingPlan = (): Plan | null => {
    const tick = idle().filter((b) => b.kind === "ticking" && b.armed && (b.timer ?? 99) <= 8).sort((a, b) => (a.timer ?? 0) - (b.timer ?? 0))[0];
    if (!tick) return null;
    const fever = e.getFever().active;
    if (!fever && e.getCurrentBomb() !== tick.colorIndex && e.getNextBomb() === tick.colorIndex && !e.getPowerSlot()) e.swapBomb();
    if (!fever && e.getCurrentBomb() !== tick.colorIndex) return null;
    for (const b of idle().filter((x) => x.colorIndex === tick.colorIndex && dist(x, tick) < 2.5)) {
      if (aim(b.x, b.z).wouldPopIds.includes(tick.id)) return bombPlan(b.id, b.x, b.z);
    }
    return aim(tick.x, tick.z).hitBombId === tick.id ? bombPlan(tick.id, tick.x, tick.z) : null;
  };

  // A bomb about to touch the border: pop it if any colour on hand can,
  // else WALL PUSH it (a non-popping shot within deflectMargin shoves it back).
  const emergencyPlan = (): Plan | null => {
    const close = idle().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (!close || Math.hypot(close.x, close.z) - 6.45 > 0.6) return null;
    const near = idle().filter((b) => dist(b, close) < 2.5);
    const tryPop = () => {
      for (const b of near) if (aim(b.x, b.z).wouldPopIds.includes(close.id)) return bombPlan(b.id, b.x, b.z);
      return null;
    };
    let p = tryPop();
    if (!p && !e.getPowerSlot() && !e.getFever().active) {
      e.swapBomb();
      p = tryPop();
    }
    if (p) return p;
    // any pop that clears something within 1.0 of the border beats a push
    const hot = new Set(idle().filter((b) => Math.hypot(b.x, b.z) - 6.45 <= 1.0).map((b) => b.id));
    for (const b of idle().filter((x) => x.colorIndex === e.getCurrentBomb() && Math.hypot(x.x, x.z) < 9.5)) {
      if (aim(b.x, b.z).wouldPopIds.some((id) => hot.has(id))) return bombPlan(b.id, b.x, b.z);
    }
    const ray = aim(close.x, close.z);
    if (ray.target === "bomb" && ray.wouldPopIds.length === 0 && ray.landing && Math.hypot(ray.landing.x, ray.landing.z) - 6.45 <= c.deflectMargin) {
      return bombPlan(ray.hitBombId!, close.x, close.z);
    }
    return null;
  };

  const bossPlan = (): Plan | null => {
    const boss = e.getBoss();
    if (!boss || (e.getDangerLevel() > 0.6 && e.getRemaining() > 6)) return null;
    const fever = e.getFever().active, s = e.getShooter();
    if (!fever && e.getNextBomb() === boss.weakColor && e.getCurrentBomb() !== boss.weakColor && !e.getPowerSlot()) e.swapBomb();
    if (aim(boss.x, boss.z).target === "core" || boss.shield.length <= Math.floor(e.getLevelDef().boss!.shield / 2)) return { kind: "core", wait: 1.5 };
    const tryShield = (): Plan | null => {
      for (const sh of [...boss.shield].sort((a, b) => dist(a, s) - dist(b, s))) {
        if (sh.scale < 1 || (!fever && !e.getPowerSlot() && sh.colorIndex !== e.getCurrentBomb())) continue;
        const p = shieldPoint(sh.id)!;
        const tg = aim(p.x, p.z).target;
        if (tg === "shield" || tg === "core") return { kind: "shield", id: sh.id };
      }
      return null;
    };
    let p = tryShield();
    if (!p && !fever && !e.getPowerSlot() && boss.shield.some((sh) => sh.colorIndex === e.getNextBomb())) {
      e.swapBomb();
      p = tryShield();
    }
    return p;
  };

  const rollerPlan = (): Plan | null => {
    const s = e.getShooter();
    for (const ro of [...e.getRollers()].sort((a, b) => dist(a, s) - dist(b, s))) {
      const p = rollerPoint(ro.id)!;
      const tg = aim(p.x, p.z).target;
      if (tg === "roller" || tg === null) return { kind: "roller", id: ro.id };
    }
    return null;
  };

  const decide = (): Plan | null => {
    const yaw0 = e.getShooter().yaw;
    const fever = e.getFever().active, slot = e.getPowerSlot();
    let p = rollerPlan();
    if (!p && slot) p = powerPlan(slot);
    if (!p) p = tickingPlan();
    if (!p && o.push !== false) p = emergencyPlan();
    if (!p) p = bossPlan();
    if (!p && fever) p = popPlan(-1, true, 8) ?? popPlan(-1, false, 8);
    if (!p) {
      p = popPlan(e.getCurrentBomb(), true);
      if (!p && !slot) {
        e.swapBomb();
        p = popPlan(e.getCurrentBomb(), true);
      }
      if (!p) p = popPlan(e.getCurrentBomb(), false);
    }
    if (!p) {
      for (let k = 0; k < 64; k++) {
        e.setYaw((k / 64) * Math.PI * 2);
        if (e.getAimRay().target === null) {
          p = { kind: "yaw", yaw: e.getShooter().yaw };
          break;
        }
      }
    }
    walkTo = null;
    if (p?.kind === "bomb") {
      const b = e.getBombs().find((q) => q.id === p!.id);
      if (b && dist(b, e.getShooter()) > 6) walkTo = { x: b.x, z: b.z };
    }
    e.setYaw(yaw0); // a human has to turn there first
    return p;
  };

  // Where the current plan wants the aim, or null if the target is gone.
  const planPoint = (p: Plan): { x: number; z: number } | null => {
    switch (p.kind) {
      case "bomb": {
        const b = e.getBombs().find((q) => q.id === p.id && q.state === "idle");
        return b ? { x: b.x + p.ax, z: b.z + p.az } : null;
      }
      case "shield": return shieldPoint(p.id);
      case "roller": return rollerPoint(p.id);
      case "core": {
        const b = e.getBoss();
        return b ? { x: b.x, z: b.z } : null;
      }
      default: return null;
    }
  };

  const steer = () => {
    const s = e.getShooter();
    for (const ro of e.getRollers()) {
      const dx = s.x - ro.x, dz = s.z - ro.z, d = Math.hypot(dx, dz);
      const closing = (ro.dirX * dx + ro.dirZ * dz) / (d || 1);
      if (closing <= 0.3 || ro.speed <= 0) continue;
      const ttc = d / (ro.speed * closing);
      let px = -ro.dirZ, pz = ro.dirX;
      if (px * -s.x + pz * -s.z < 0) {
        px = -px;
        pz = -pz;
      }
      if (o.roll && ttc <= 0.6 && e.getRoll().state === "ready") {
        e.roll(px, pz);
        return;
      }
    }
    const slot = e.getPowerSlot();
    const pk = e.getPickups()
      .filter((p) => p.state !== "flying" && (p.kind === "freeze" || !slot) && dist(p, s) <= 5)
      .sort((a, b) => dist(a, s) - dist(b, s))[0];
    if (pk) {
      const d = dist(pk, s);
      e.setMoveInput((pk.x - s.x) / d, (pk.z - s.z) / d);
      if (o.roll && e.getLevelDef().roll && d > 2.5 && e.getRoll().state === "ready" && e.getRollers().length === 0) e.roll(pk.x - s.x, pk.z - s.z);
      return;
    }
    if (walkTo && dist(walkTo, s) > 6) e.setMoveInput(walkTo.x - s.x, walkTo.z - s.z);
    else e.setMoveInput(-s.x * 0.3, -s.z * 0.3);
  };

  while (e.getPhase() === "playing" && e.getTime() < (o.maxTime ?? 300)) {
    const s = e.getShooter(), fever = e.getFever().active;
    steer();
    const ready = e.getShots().length < (fever ? 4 : 1) && s.cooldown === 0 && e.getTime() - lastShot >= (fever ? 0.4 : pace) &&
      e.getStun() === 0 && e.getRoll().state !== "rolling";
    if (ready && !plan) plan = decide();
    if (plan) {
      let yaw = plan.kind === "yaw" ? plan.yaw : NaN;
      const pt = planPoint(plan);
      if (pt) yaw = Math.atan2(pt.z - s.z, pt.x - s.x);
      if (!Number.isFinite(yaw)) plan = null; // target gone: re-decide next frame
      else {
        const diff = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw));
        e.turn(Math.max(-maxTurn, Math.min(maxTurn, diff)));
        if (Math.abs(diff) <= maxTurn) {
          if (plan.kind === "core" && e.getAimRay().target !== "core" && (plan.wait -= DT) > 0) {
            // hold on the core until a shield gap lines up
          } else {
            if (e.fire()) lastShot = e.getTime();
            plan = null;
          }
        }
      }
    }
    e.update(DT * e.getTimeScale());
    o.trace?.(e);
  }
  r.won = e.getPhase() === "won";
  r.time = +e.getTime().toFixed(1);
  return r;
}
