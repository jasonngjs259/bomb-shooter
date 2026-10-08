// Fun-pass event FX (fun spec 2.x), layered on ArenaFx's pools (glow
// billboards, ground decals, particles, debris, shake) plus ArenaSpecials
// (lightning arcs, roll trail, boss flashes) and the atlas sprites:
//   pickups  - spawn burst + shrinking landing marker, landing ring
//              (r 0.2 -> 0.9, 250 ms), collect burst + name float, blocked
//              red ping, expire poof;
//   powers   - muzzle burst per kind, MEGA blast (flash, double shockwave to
//              the radius, 60 particles, debris, shake, 70 ms hit-stop),
//              LIGHTNING arcs hop by hop (`hop` s apart, + the core arc);
//   freeze   - ice ring sweeping out, snow while frozen, ice tint level;
//   fever    - start burst + rainbow rings, embers + beat ring under the
//              player while active, "xN FEVER" float + down-sweep at the end;
//   specials - armor shards, ticking arm ping / red warning pulse / DEFUSED,
//              detonation (x1.5) + wall shockwave and red border flash on
//              lurch, roller telegraph rings, launch dust, rolling dust
//              trail, roller break / poof;
//   player   - roll (Roll clip, dust puffs, trim trail), hit (explosion,
//              HitRecieve, flashes, stun stars come from the stun getter),
//              PERFECT, roll-ready glint;
//   boss     - shield pops, hits (flash, sparks, WEAK float), weak-colour
//              ring, phase shockwave, attack telegraph (core swells for the
//              last 1 s before a spit / roller), Mk I spit burst, defeat
//              (implode 150 ms in real time through the hit-stop, explosion
//              + shockwave to 10 w, camera beat);
//   end      - levelStars: the earned stars punch in over the player.
// Haptics (fun spec 5, never on tick / shoot / roller loop): Light = roll,
// pickup; Medium = armor crack, defuse; Heavy = fever start, lurch, player
// hit, mega, boss phase; Success = boss down.

import { Color, Vector3 } from "three";
import type { ArenaEngine, FxBomb } from "../../game/arena";
import type { PickupKind } from "../../game/arena/funTypes";
import { TypedEmitter } from "../../game/emitter";
import { FxBusEvents } from "../../fx/bus";
import { haptics } from "../../fx/haptics";
import { bombBase, bombGlow, colorAt, HEX } from "../three/palette";
import { ArenaBombs, POWER_COLOR } from "./ArenaBombs";
import { ArenaFx } from "./ArenaFx";
import { ArenaSpecials, PICKUP_HEX, rainbowAt } from "./ArenaSpecials";
import { AtlasSprites } from "./AtlasSprites";
import { ChaseCamera } from "./ChaseCamera";
import { CELL } from "./funAtlas";
import type { Avatar } from "./avatar";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const PICKUP_NAME: Record<PickupKind, string> = { rainbow: "RAINBOW!", mega: "MEGA!", freeze: "FREEZE!", lightning: "LIGHTNING!" };
const ICE = new Color("#CFF4FF");
const GOLD = new Color(HEX.gold);
const MAGENTA = new Color(HEX.magenta);
const DANGER = new Color(HEX.danger);
const ORANGE = new Color("#FF8A3D");
const CAGE = new Color("#8B93B8");
const ZAP = new Color("#FFF36B");
const CYAN = new Color(HEX.cyan);
const WHITE = new Color(1, 1, 1);
const DUST = new Color(HEX.dust);

export class ArenaFunFx {
  ice = 0; // 0..1 smoothed freeze tint (150 ms)
  fever = 0; // 0..1 smoothed fever look
  lurchFlash = 0; // 0..1 red border flash
  feverFlash = 0; // 0..1 start burst on the border / vignette
  private t = 0;
  private realT = 0;
  private readonly offs: (() => void)[] = [];
  private readonly pick = new Map<number, { x: number; y: number; z: number; kind: PickupKind }>();
  private readonly rollerCol = new Map<number, number>();
  private readonly telegraphed = new Set<number>();
  private attackT = 0; // boss phase 2 attack clock (approximation of the engine's)
  private dustT = 0;
  private snowT = 0;
  private emberT = 0;
  private rollUntil = -1;
  private lastBolt: { x: number; z: number; t: number } | null = null;
  private stars: { t0: number; i: number; n: number }[] = [];
  private readonly mv = new Vector3();
  private readonly hv = new Vector3();
  private readonly tc = new Color();
  private readonly tc2 = new Color();

  constructor(
    private readonly engine: ArenaEngine,
    private readonly fx: ArenaFx,
    private readonly specials: ArenaSpecials,
    private readonly sprites: AtlasSprites,
    private readonly bombs: ArenaBombs,
    private readonly avatar: () => Avatar,
    private readonly camera: ChaseCamera,
    private readonly bus: TypedEmitter<FxBusEvents>,
    private readonly project: (x: number, y: number, z: number) => { x: number; y: number },
  ) {
    const e = engine;
    const f = fx;
    const ring = (x: number, z: number, dur: number, r0: number, r1: number, c: Color, a = 0.9) => f.anim(true, x, 0.09, z, dur, r0, r1, c, a);
    const flash = (x: number, y: number, z: number, dur: number, r: number, c: Color, a = 1) => f.anim(false, x, y, z, dur, 0, r, c, a);
    const burst = (x: number, y: number, z: number, n: number, c0: Color, c1: Color, v0: number, v1: number, up: number, life = 0.6, size = 0.16) => {
      for (let i = 0; i < f.n(n); i++) {
        const a = Math.random() * Math.PI * 2;
        const v = rand(v0, v1);
        f.spawn(x, y, z, Math.cos(a) * v, rand(up * 0.3, up), Math.sin(a) * v, rand(life * 0.6, life), size, c0, c1, -5, 0.93);
      }
    };
    const float = (x: number, y: number, z: number, text: string, combo = 3, dy = 0) => {
      const s = this.project(x, y, z);
      this.bus.emit("floatText", { x: s.x, y: s.y - dy, text, kind: "combo", combo });
    };
    const kindCol = (k: PickupKind, out: Color) => (k === "rainbow" ? rainbowAt(this.t, out) : out.set(PICKUP_HEX[k]));
    const player = () => e.getShooter();

    this.offs.push(
      // ---- pickups ----
      e.on("pickupSpawned", ({ kind, from, to, flight }) => {
        const c = kindCol(kind, new Color());
        flash(from.x, 0.9, from.z, 0.25, 1.4, c);
        burst(from.x, 0.9, from.z, 14, WHITE, c, 1, 3, 7, 0.7, 0.14);
        // landing marker: a ring that closes in as the token arrives
        if (flight > 0) f.anim(true, to.x, 0.085, to.z, flight, 1.1, 0.35, c, 0.85);
      }),
      e.on("pickupLanded", ({ id }) => {
        const p = e.getPickups().find((q) => q.id === id);
        if (!p) return;
        const c = kindCol(p.kind, new Color());
        ring(p.x, p.z, 0.25, 0.2, 0.9, c, 1);
        ring(p.x, p.z, 0.4, 0.2, 1.3, WHITE, 0.4);
        burst(p.x, 0.15, p.z, 8, DUST, c, 1, 2.5, 2, 0.45, 0.12);
      }),
      e.on("pickupCollected", ({ kind, x, z }) => {
        const c = kindCol(kind, new Color());
        flash(x, 0.9, z, 0.3, 1.8, c);
        ring(x, z, 0.4, 0.3, 1.6, c, 1);
        for (let i = 0; i < f.n(20); i++) {
          const a = (i / 20) * Math.PI * 2;
          f.spawn(x, 0.4, z, Math.cos(a) * 2.2, rand(3, 6), Math.sin(a) * 2.2, rand(0.5, 0.8), 0.15, WHITE, c, -3, 0.9);
        }
        const sh = player();
        float(sh.x, 2.3, sh.z, PICKUP_NAME[kind], kind === "mega" ? 4 : 3, 40);
        haptics.light();
      }),
      e.on("pickupBlocked", ({ id }) => {
        const p = this.pick.get(id);
        if (!p) return;
        ring(p.x, p.z, 0.35, 0.3, 1.0, DANGER, 0.9);
        flash(p.x, p.y + 0.5, p.z, 0.25, 0.5, DANGER, 0.8);
      }),
      e.on("pickupExpired", ({ id, kind }) => {
        const p = this.pick.get(id);
        if (!p) return;
        burst(p.x, p.y, p.z, 12, WHITE, kindCol(kind, this.tc), 0.6, 1.8, 1.5, 0.4, 0.12);
        flash(p.x, p.y, p.z, 0.2, 0.7, DUST, 0.7);
      }),

      // ---- powers ----
      e.on("powerFired", ({ kind, yaw }) => {
        const p = this.avatar().muzzleWorld(this.mv);
        const c = kind === "rainbow" ? rainbowAt(this.t, new Color()) : POWER_COLOR[kind];
        flash(p.x, p.y, p.z, 0.16, kind === "mega" ? 1.3 : 0.9, c);
        for (let i = 0; i < f.n(14); i++) {
          const a = yaw + rand(-40, 40) * (Math.PI / 180);
          const v = rand(5, 11);
          const cc = kind === "rainbow" ? colorAt(bombGlow, i) : c;
          f.spawn(p.x, p.y, p.z, Math.cos(a) * v, rand(-1, 2.5), Math.sin(a) * v, 0.3, 0.16, WHITE, cc, 0, 0.9);
        }
        if (kind === "lightning") {
          for (let i = 0; i < 3; i++) {
            const a = rand(0, Math.PI * 2);
            this.specials.arc(p.x, p.y, p.z, p.x + Math.cos(a) * 0.6, p.y + rand(-0.3, 0.4), p.z + Math.sin(a) * 0.6, ZAP, 0, 0.15, 0.06);
          }
        }
        if (kind === "mega") f.shake(0.05, 0.2);
      }),
      e.on("megaBlast", ({ x, z, radius, bombs }) => {
        flash(x, 0.8, z, 0.3, radius * 1.3, GOLD);
        flash(x, 0.8, z, 0.18, radius * 0.8, WHITE);
        ring(x, z, 0.5, 0.3, radius * 1.15, GOLD, 1);
        f.later(0.08, () => ring(x, z, 0.6, 0.3, radius * 1.4, ORANGE, 0.6));
        burst(x, 0.6, z, 60, WHITE, GOLD, 4, 12, 9, 0.8, 0.22);
        for (const b of bombs.slice(0, 10)) this.fx.explode(b, f.n(3), 1, 1);
        f.shake(0.15, 0.45);
        f.gridPulse = 1.8;
        haptics.heavy();
      }),
      e.on("lightningChain", ({ colorIndex, path, hop }) => {
        const c = this.tc2.copy(ZAP).lerp(colorAt(bombGlow, colorIndex), 0.35).clone();
        const m = this.avatar().muzzleWorld(this.mv);
        let px = m.x, py = m.y, pz = m.z;
        path.forEach((b: FxBomb, i: number) => {
          const d = i * hop;
          this.specials.arc(px, py, pz, b.x, 0.5, b.z, c, d, 0.3, 0.13);
          f.later(d, () => flash(b.x, 0.5, b.z, 0.18, 0.9, ZAP));
          px = b.x; py = 0.5; pz = b.z;
        });
        const last = path[path.length - 1];
        if (last) this.lastBolt = { x: last.x, z: last.z, t: this.t + path.length * hop };
      }),
      e.on("freezeStart", () => {
        const s = player();
        ring(s.x, s.z, 0.7, 0.5, 14, ICE, 1);
        f.later(0.12, () => ring(s.x, s.z, 0.8, 0.5, 10, WHITE, 0.4));
        burst(s.x, 1, s.z, 30, WHITE, ICE, 2, 6, 5, 0.9, 0.16);
      }),
      e.on("freezeEnd", () => {
        const s = player();
        ring(s.x, s.z, 0.5, 0.5, 9, ICE, 0.5);
      }),
      e.on("feverStart", () => {
        const s = player();
        this.feverFlash = 1;
        for (let k = 0; k < 4; k++) f.later(k * 0.07, () => ring(s.x, s.z, 0.7, 0.4, 7 + k * 2, colorAt(bombGlow, k * 2 + 1), 0.9));
        burst(s.x, 1, s.z, 40, GOLD, MAGENTA, 3, 8, 8, 0.9, 0.2);
        f.gridPulse = 1.9;
        f.shake(0.06, 0.3);
        haptics.heavy();
      }),
      e.on("feverEnd", ({ pops }) => {
        const s = player();
        f.anim(true, s.x, 0.09, s.z, 0.5, 6, 0.4, MAGENTA, 0.7); // down-sweep
        if (pops > 0) float(s.x, 2.4, s.z, `x${pops} FEVER`, 3, 40);
      }),

      // ---- special bombs ----
      e.on("armorBroken", ({ x, z, colorIndex }) => {
        flash(x, 0.45, z, 0.12, 0.9, WHITE);
        ring(x, z, 0.3, 0.3, 1.0, CAGE, 0.8);
        if (this.fx.opts.debris) for (let i = 0; i < 6; i++) this.fx.spawnDebris(x, z, 260, CAGE);
        burst(x, 0.45, z, 10, WHITE, colorAt(bombGlow, colorIndex), 2, 5, 3, 0.35, 0.1);
        haptics.medium();
      }),
      e.on("tickingArmed", ({ id }) => {
        const b = e.getBombs().find((q) => q.id === id);
        if (!b) return;
        ring(b.x, b.z, 0.5, 0.3, 1.4, WHITE, 0.8);
        flash(b.x, 0.45, b.z, 0.2, 0.9, WHITE, 0.8);
      }),
      e.on("tickingWarning", ({ id, remaining }) => {
        const b = e.getBombs().find((q) => q.id === id);
        if (!b) return;
        const k = 1 + (5 - remaining) * 0.12;
        flash(b.x, 0.45, b.z, 0.22, 1.1 * k, DANGER);
        ring(b.x, b.z, 0.4, 0.4, 1.3 * k, DANGER, 0.9);
      }),
      e.on("tickingDefused", ({ x, z }) => {
        ring(x, z, 0.45, 0.3, 1.6, CYAN, 1);
        burst(x, 0.5, z, 16, WHITE, CYAN, 1.5, 4, 5, 0.6, 0.14);
        float(x, 1.4, z, "DEFUSED +100", 3);
        haptics.medium();
      }),
      e.on("tickingExploded", ({ x, z }) => {
        this.fx.explode({ id: -1, x, z, colorIndex: 0 }, f.n(24), this.fx.opts.debris ? 8 : 0, 1.5);
        flash(x, 0.6, z, 0.3, 3.2, ORANGE);
        ring(x, z, 0.5, 0.4, 4, DANGER, 1);
        this.lurchFlash = 1;
      }),
      e.on("lurch", ({ distance }) => {
        // wall shockwave: a red ring closing in from the wall to the border
        const gap = e.getBorderGap();
        const r0 = 6 + Math.max(0.5, gap) + distance + 0.5;
        f.anim(true, 0, 0.1, 0, 0.45, r0, 6.2, DANGER, 1);
        f.anim(true, 0, 0.1, 0, 0.6, r0 + 1, 6.4, ORANGE, 0.5);
        this.lurchFlash = 1;
        f.shake(0.08, 0.4);
        haptics.heavy();
      }),
      e.on("rollerTelegraph", ({ id, x, z }) => {
        this.telegraphed.add(id);
        ring(x, z, 0.5, 0.3, 1.3, ORANGE, 1);
        f.later(0.5, () => ring(x, z, 0.5, 0.3, 1.3, ORANGE, 1));
        flash(x, 0.45, z, 0.3, 1.2, ORANGE, 0.9);
      }),
      e.on("rollerLaunched", ({ id, x, z, colorIndex }) => {
        this.rollerCol.set(id, colorIndex);
        burst(x, 0.2, z, 12, DUST, colorAt(bombGlow, colorIndex), 1.5, 3.5, 2, 0.5, 0.18);
        ring(x, z, 0.35, 0.4, 1.4, ORANGE, 0.8);
        if (!this.telegraphed.has(id)) {
          // boss roller: spat out of the core
          const b = e.getBoss();
          if (b) this.coreSpit(b.x, b.z, b.r);
        }
        this.telegraphed.delete(id);
      }),
      e.on("rollerDestroyed", ({ id, x, z, matched }) => {
        const ci = this.rollerCol.get(id) ?? 0;
        this.fx.explode({ id, x, z, colorIndex: ci }, f.n(14), this.fx.opts.debris ? 4 : 0, 1.1);
        ring(x, z, 0.4, 0.3, 1.8, ORANGE, 0.9);
        if (matched) float(x, 1.2, z, "+50", 2);
        this.rollerCol.delete(id);
      }),
      e.on("rollerExpired", ({ id, x, z }) => {
        burst(x, 0.45, z, 10, DUST, WHITE, 0.6, 1.8, 1.5, 0.4, 0.14);
        flash(x, 0.45, z, 0.2, 0.8, DUST, 0.6);
        this.rollerCol.delete(id);
      }),

      // ---- player ----
      e.on("playerHit", ({ x, z }) => {
        flash(x, 0.7, z, 0.25, 2.2, ORANGE);
        flash(x, 0.7, z, 0.12, 1.2, WHITE);
        ring(x, z, 0.45, 0.3, 2.6, DANGER, 1);
        burst(x, 0.7, z, 30, WHITE, ORANGE, 3, 8, 6, 0.6, 0.18);
        this.avatar().hitReact();
        f.shake(0.12, 0.35);
        this.lurchFlash = Math.max(this.lurchFlash, 0.6);
        haptics.heavy();
      }),
      e.on("perfectDodge", () => {
        const s = player();
        ring(s.x, s.z, 0.45, 0.4, 2.2, CYAN, 1);
        burst(s.x, 1, s.z, 18, WHITE, CYAN, 1.5, 4, 5, 0.6, 0.14);
        float(s.x, 2.4, s.z, "PERFECT!", 4, 40);
      }),
      e.on("rollStart", ({ dirX, dirZ, duration }) => {
        const s = player();
        this.avatar().roll(duration);
        this.rollUntil = this.t + duration;
        burst(s.x, 0.15, s.z, 10, DUST, WHITE, 0.8, 2.2, 1.6, 0.45, 0.2);
        ring(s.x, s.z, 0.35, 0.3, 1.2, DUST, 0.6);
        haptics.light();
        void dirX; void dirZ;
      }),
      e.on("rollEnd", () => {
        const s = player();
        burst(s.x, 0.15, s.z, 8, DUST, WHITE, 0.6, 1.8, 1.2, 0.4, 0.18);
      }),
      e.on("rollReady", () => {
        const s = player();
        ring(s.x, s.z, 0.3, 0.6, 1.0, CYAN, 0.6);
      }),

      // ---- boss ----
      e.on("bossSpawned", () => {
        const b = e.getBoss();
        if (!b) return;
        this.specials.defeatT = -1;
        this.attackT = 0;
        ring(b.x, b.z, 1.0, 1, 6, MAGENTA, 0.8);
      }),
      e.on("bossShieldPop", ({ id, x, z, colorIndex }) => {
        this.fx.explode({ id, x, z, colorIndex }, f.n(10), this.fx.opts.debris ? 2 : 0, 0.9);
      }),
      e.on("bossShieldRegrow", () => {
        const b = e.getBoss();
        if (b) flash(b.x, b.r, b.z, 0.3, b.r * 1.6, WHITE, 0.5);
      }),
      e.on("bossHit", ({ damage, weak, x, z }) => {
        const b = e.getBoss();
        if (!b) return;
        this.specials.bossHit = 1;
        if (weak) this.specials.bossWeakHit = 1;
        const c = damage === 0 ? WHITE : weak ? GOLD : colorAt(bombGlow, b.weakColor);
        // hit point on the core surface facing the shot
        const dx = x - b.x, dz = z - b.z, l = Math.hypot(dx, dz) || 1;
        const hx = b.x + (dx / l) * b.r, hz = b.z + (dz / l) * b.r;
        flash(hx, b.r, hz, 0.2, weak ? 1.6 : 1.0, c);
        burst(hx, b.r, hz, weak ? 26 : 14, WHITE, c, 2, weak ? 8 : 5, 5, 0.5, 0.15);
        if (damage === 0) float(b.x, b.r * 2 + 0.5, b.z, "IMMUNE", 2);
        else if (weak) float(b.x, b.r * 2 + 0.5, b.z, `WEAK! -${damage}`, 4);
        else float(b.x, b.r * 2 + 0.5, b.z, `-${damage}`, 2);
        if (this.lastBolt && Math.abs(this.t - this.lastBolt.t) < 0.6) {
          this.specials.arc(this.lastBolt.x, 0.5, this.lastBolt.z, b.x, b.r, b.z, ZAP, 0, 0.35, 0.18);
          this.lastBolt = null;
        }
        f.shake(weak ? 0.06 : 0.03, 0.15);
      }),
      e.on("bossWeakColor", ({ colorIndex }) => {
        const b = e.getBoss();
        if (b) ring(b.x, b.z, 0.6, b.r, b.r + 2.4, colorAt(bombGlow, colorIndex), 0.9);
      }),
      e.on("bossPhase", ({ phase }) => {
        const b = e.getBoss();
        if (!b) return;
        const c = phase === 3 ? DANGER : MAGENTA;
        flash(b.x, b.r, b.z, 0.35, b.r * 3, c);
        ring(b.x, b.z, 0.8, b.r, 11, c, 1);
        f.later(0.12, () => ring(b.x, b.z, 0.9, b.r, 8, WHITE, 0.5));
        burst(b.x, b.r, b.z, 40, WHITE, c, 3, 10, 7, 0.9, 0.2);
        this.attackT = 0;
        f.shake(0.1, 0.5);
        f.gridPulse = 1.7;
        haptics.heavy();
      }),
      e.on("bossDefeated", () => {
        const b = e.getBoss();
        if (!b) return;
        const { x, z, r } = b;
        const wc = colorAt(bombGlow, b.weakColor).clone();
        this.specials.defeatT = 0;
        this.fx.winDelay = 1.5;
        this.camera.bossBeat(x, z);
        // implode during the engine's hit-stop (real time), then blow
        this.fx.laterReal(0.17, () => {
          flash(x, r, z, 0.4, r * 4, WHITE);
          flash(x, r, z, 0.7, r * 6, wc);
          f.anim(true, x, 0.1, z, 0.9, r, 10, WHITE, 1);
          f.anim(true, x, 0.1, z, 1.1, r, 12, wc, 0.7);
          f.later(0.15, () => f.anim(true, x, 0.1, z, 1.0, r, 9, GOLD, 0.6));
          for (let i = 0; i < f.n(110); i++) {
            const u = rand(-1, 1);
            const th = rand(0, Math.PI * 2);
            const s = Math.sqrt(1 - u * u) * rand(5, 14);
            const c = colorAt(bombBase, i);
            f.spawn(x, r, z, Math.cos(th) * s, Math.abs(u) * 10 + 2, Math.sin(th) * s, rand(0.7, 1.3), 0.26, WHITE, c, -6, 0.95);
          }
          if (this.fx.opts.debris) for (let i = 0; i < 16; i++) this.fx.spawnDebris(x, z, 420, colorAt(bombGlow, i));
          f.shake(0.22, 0.9);
          f.gridPulse = 2;
          haptics.success();
        });
      }),
      e.on("levelStars", ({ count }) => {
        for (let i = 0; i < count; i++) this.stars.push({ t0: this.realT + 0.6 + i * 0.35, i, n: count });
      }),
      e.on("featureIntro", ({ feature }) => {
        if (feature === "armored") this.bombs.armorPing = 1;
      }),
      e.on("gameOver", ({ bombId }) => {
        const b = e.getBoss();
        if (b && b.id === bombId) {
          this.fx.laterReal(0.4, () => {
            this.fx.explode({ id: b.id, x: b.x, z: b.z, colorIndex: b.weakColor }, f.n(40), this.fx.opts.debris ? 12 : 0, 3);
            this.specials.defeatT = 0;
          });
        }
      }),
    );
    this.bombs.onSpit = (x, z) => {
      const b = e.getBoss();
      this.coreSpit(x, z, b?.r ?? 1.35);
    };
  }

  private coreSpit(x: number, z: number, r: number) {
    this.attackT = 0;
    const f = this.fx;
    f.anim(false, x, r, z, 0.3, 0, r * 2.4, ORANGE, 1);
    f.anim(true, x, 0.1, z, 0.5, r, r + 3, ORANGE, 0.9);
    for (let i = 0; i < f.n(24); i++) {
      const a = rand(0, Math.PI * 2);
      f.spawn(x, r * 1.6, z, Math.cos(a) * rand(2, 6), rand(4, 9), Math.sin(a) * rand(2, 6), rand(0.5, 0.9), 0.2, WHITE, ORANGE, -9, 0.95);
    }
    f.shake(0.05, 0.25);
  }

  reset() {
    this.pick.clear();
    this.rollerCol.clear();
    this.telegraphed.clear();
    this.stars.length = 0;
    this.attackT = 0;
    this.lurchFlash = this.feverFlash = 0;
    this.rollUntil = -1;
    this.lastBolt = null;
  }

  // dt: FX (engine-scaled) seconds; realDt: real seconds.
  update(dt: number, realDt: number, still: boolean, low: boolean) {
    const e = this.engine;
    const f = this.fx;
    this.t += dt;
    this.realT += realDt;
    const freeze = e.getFreeze();
    const fever = e.getFever();
    this.ice += ((freeze > 0 ? 1 : 0) - this.ice) * Math.min(1, realDt / 0.15);
    this.fever += ((fever.active ? 1 : 0) - this.fever) * Math.min(1, realDt / 0.25);
    this.lurchFlash = Math.max(0, this.lurchFlash - realDt / 0.5);
    this.feverFlash = Math.max(0, this.feverFlash - realDt / 0.6);
    this.bombs.armorPing = Math.max(0, this.bombs.armorPing - realDt / 1.2);

    // remember pickup positions (expire / blocked FX after they are gone)
    for (const p of e.getPickups()) {
      const m = this.pick.get(p.id);
      if (m) {
        m.x = p.x; m.y = p.y; m.z = p.z;
      } else if (this.pick.size < 12) this.pick.set(p.id, { x: p.x, y: p.y, z: p.z, kind: p.kind });
    }
    if (this.pick.size > e.getPickups().length + 4) for (const id of this.pick.keys()) if (!e.getPickups().some((p) => p.id === id)) this.pick.delete(id);

    const s = e.getShooter();
    // rollers: dust trail + colour memory
    this.dustT += dt;
    const dustNow = this.dustT >= (low ? 0.1 : 0.05);
    if (dustNow) this.dustT = 0;
    for (const r of e.getRollers()) {
      this.rollerCol.set(r.id, r.colorIndex);
      if (dustNow && r.speed > 0) {
        f.spawn(r.x - r.dirX * 0.4, 0.12, r.z - r.dirZ * 0.4, -r.dirX * 0.6 + rand(-0.4, 0.4), rand(0.4, 1.2), -r.dirZ * 0.6 + rand(-0.4, 0.4), 0.5, 0.2, DUST, DUST, 0.5, 0.9);
      }
    }
    // snow while frozen
    if (freeze > 0 && !still) {
      this.snowT += dt + realDt * 0.5;
      const every = low ? 0.08 : 0.03;
      while (this.snowT >= every) {
        this.snowT -= every;
        const a = rand(0, Math.PI * 2), r = rand(0.5, 9);
        f.spawn(s.x + Math.cos(a) * r, rand(3, 5), s.z + Math.sin(a) * r, rand(-0.3, 0.3), -rand(0.8, 1.5), rand(-0.3, 0.3), 2.5, 0.09, WHITE, ICE, 0, 1);
      }
    }
    // fever: embers off the suit + a beat ring under the player
    if (fever.active) {
      this.emberT += dt;
      while (this.emberT >= (low ? 0.08 : 0.035)) {
        this.emberT -= low ? 0.08 : 0.035;
        const a = rand(0, Math.PI * 2);
        f.spawn(s.x + Math.cos(a) * 0.35, rand(0.3, 1.6), s.z + Math.sin(a) * 0.35, Math.cos(a) * 0.4, rand(1.5, 3), Math.sin(a) * 0.4, rand(0.4, 0.7), 0.1, GOLD, MAGENTA, 0, 0.96);
      }
      const beat = (this.realT * 1.87) % 1;
      if (beat < realDt * 1.87 + 1e-6 && !still) f.anim(true, s.x, 0.08, s.z, 0.5, 0.4, 2.2, rainbowAt(this.realT, this.tc).clone(), 0.7);
    }
    // roll trail (trim colour) for 0.3 s after the roll
    if (this.t <= this.rollUntil + 0.05 && !low) {
      this.avatar().shadowXZ(this.hv);
      this.specials.trailPoint(this.hv.x, 0.75, this.hv.z);
    }
    // boss attack telegraph: the core charges for the last 1 s
    const b = e.getBoss();
    if (b && b.phase === 2 && this.specials.defeatT < 0) {
      if (freeze <= 0 && !e.isCreepPaused()) this.attackT += dt;
      const fun = e.getFunConfig().boss;
      const every = b.mk === 1 ? fun.spitEvery : fun.rollerEvery;
      const k = Math.max(0, Math.min(1, (this.attackT - (every - 1)) / 1));
      this.specials.bossTelegraph = k;
      if (k > 0 && !still && Math.random() < k * 0.5) {
        // sparks sucked into the core
        const a = rand(0, Math.PI * 2), rr = b.r * 2.6;
        f.spawn(b.x + Math.cos(a) * rr, b.r + rand(-0.5, 1), b.z + Math.sin(a) * rr, -Math.cos(a) * 5, 0, -Math.sin(a) * 5, 0.35, 0.14, ORANGE, WHITE, 0, 1);
      }
    } else this.specials.bossTelegraph = 0;

    // end-of-level stars over the player
    if (this.stars.length) {
      this.avatar().headWorld(this.hv);
      for (const st of this.stars) {
        const age = this.realT - st.t0;
        if (age < 0) continue;
        const pop = age < 0.26 ? (age < 0.13 ? (age / 0.13) * 1.25 : 1.25 - ((age - 0.13) / 0.13) * 0.25) : 1;
        const x = (st.i - (st.n - 1) / 2) * 0.7;
        const cx = Math.cos(this.camera.yaw + Math.PI / 2), cz = Math.sin(this.camera.yaw + Math.PI / 2);
        this.sprites.add(this.hv.x + cx * x, this.hv.y + 0.8 + Math.min(0.4, age * 0.4), this.hv.z + cz * x, 0.55 * pop, CELL.star, GOLD, Math.min(1, 5 - age));
        if (age < realDt + 1e-6) {
          for (let i = 0; i < f.n(14); i++) {
            const a = rand(0, Math.PI * 2);
            f.spawn(this.hv.x + cx * x, this.hv.y + 0.8, this.hv.z + cz * x, Math.cos(a) * 2.5, rand(1, 4), Math.sin(a) * 2.5, 0.6, 0.12, WHITE, GOLD, -4, 0.92);
          }
        }
      }
      if (this.stars.every((st) => this.realT - st.t0 > 5)) this.stars.length = 0;
    }
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.bombs.onSpit = null;
  }
}
