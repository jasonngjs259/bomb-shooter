// Owns every three.js object of Arena 360 and drives engine + scene from
// one per-frame call (the GL loop is the game loop: if the GL context dies
// the game stops with it). React only mounts `root` and renders the radar
// pass; HUD overlays poll the plain fields below (threats, introT) so
// nothing re-renders per frame.

import { AmbientLight, Color, DirectionalLight, Group, PerspectiveCamera, PointLight, Vector3 } from "three";
import { ArenaControls } from "../../arena/ArenaControls";
import { angleDiff, hFovFor, sectorCentre } from "../../arena/arenaMath";
import type { ArenaEngine } from "../../game/arena";
import { SimClock } from "../../game/clock";
import { TypedEmitter } from "../../game/emitter";
import { FxBusEvents } from "../../fx/bus";
import { getSettings, reduceMotion } from "../../ui/settings";
import { Debris } from "../three/fx/Debris";
import { Particles } from "../three/fx/Particles";
import { bombGlow, colorAt, HEX } from "../three/palette";
import { makeGlowTexture, makeGlyphAtlas, makeRingTexture } from "../three/textures";
import { AimLaser } from "./AimLaser";
import { ArenaBombs, K } from "./ArenaBombs";
import { ArenaFx } from "./ArenaFx";
import { Billboards } from "./Billboards";
import { ChaseCamera, INTRO_TIME } from "./ChaseCamera";
import { Ground } from "./Ground";
import { GroundQuads } from "./GroundQuads";
import { Radar } from "./Radar";
import { Sky } from "./Sky";
import { Stickman } from "./Stickman";

export interface Threat { x: number; y: number; rot: number; d: number; angle: number }
export interface RadarRect { x: number; y: number; size: number } // css px, top-left origin
export interface Box { x: number; y: number; w: number; h: number } // css px

export class ArenaWorld {
  readonly root = new Group();
  readonly chase = new ChaseCamera();
  readonly radar: Radar;
  readonly stick = new Stickman();
  readonly fx: ArenaFx;
  readonly threats: Threat[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, rot: 0, d: 0, angle: 0 }));
  threatCount = 0;
  radarRect: RadarRect | null = null;
  // Threat arrows sit on the ellipse inscribed in arrowRect (the playfield
  // minus HUD bands) and are pushed out of `arrowAvoid` boxes (HUD cards,
  // touch clusters) so they never cover - or steal taps from - other UI.
  arrowRect: Box | null = null;
  arrowAvoid: Box[] = [];
  laserWide = 1; // tutorial highlight
  playing = false; // controls + aim guide live (intro done, not paused/ended)
  private readonly fxSpace = new Group();
  private readonly ground: Ground;
  private readonly sky = new Sky();
  private readonly bombs: ArenaBombs;
  private readonly laser = new AimLaser();
  private readonly particles = new Particles(400);
  private readonly debris = new Debris(48);
  private readonly glow: Billboards;
  private readonly decals: GroundQuads;
  private readonly textures = [makeGlowTexture(), makeRingTexture(), makeGlyphAtlas()];
  private readonly muzzleColor = new Color(HEX.cyan);
  private readonly mv = new Vector3();
  private readonly pv = new Vector3();
  private cam: PerspectiveCamera | null = null;
  private W = 1;
  private H = 1;
  private lastYaw = -Math.PI / 2;
  private realT = 0;
  private aimAlpha = 0;
  private quality: "high" | "low" | null = null;
  onIntroDone: (() => void) | null = null;
  private introFired = false;

  constructor(private engine: ArenaEngine, private controls: ArenaControls, private clock: SimClock, bus: TypedEmitter<FxBusEvents>) {
    const r = engine.getConfig().arenaRadius;
    const [glowTex, ringTex, glyphTex] = this.textures;
    this.ground = new Ground(r);
    this.radar = new Radar(r);
    this.glow = new Billboards(900, glowTex, 10);
    this.decals = new GroundQuads(160, ringTex, true, 4);
    this.bombs = new ArenaBombs(glyphTex, glowTex, this.glow);
    this.fxSpace.scale.setScalar(K);
    this.fxSpace.add(this.bombs.batch.bombs, this.bombs.batch.hardware, this.bombs.batch.glyphs, this.glow.mesh, this.particles.points, this.debris.mesh);
    const key = new DirectionalLight("#ffffff", 3.1);
    key.position.set(-8, 14, 6);
    const rim = new PointLight(HEX.magenta, 4.7, 60, 0);
    rim.position.set(0, 8, -30);
    this.root.add(
      new AmbientLight("#3B2A6B", 1.4), key, key.target, rim, this.sky.mesh, this.ground.group, this.stick.group,
      this.fxSpace, this.bombs.shadows.mesh, this.bombs.shells, this.decals.mesh, this.laser.group,
    );
    this.fx = new ArenaFx(engine, this.particles, this.debris, this.glow, this.decals, this.bombs, this.stick, this.chase, clock, bus,
      (x, y, z) => this.project(x, y, z));
  }

  setSize(w: number, h: number) {
    this.W = Math.max(1, w);
    this.H = Math.max(1, h);
  }

  // World point -> container css px (for floating texts).
  project(x: number, y: number, z: number) {
    if (!this.cam) return { x: this.W / 2, y: this.H / 2 };
    this.pv.set(x, y, z).project(this.cam);
    return { x: (this.pv.x * 0.5 + 0.5) * this.W, y: (-this.pv.y * 0.5 + 0.5) * this.H };
  }

  startIntro() {
    this.introFired = false;
    this.chase.startIntro(reduceMotion());
  }

  get introT() {
    return this.chase.introT;
  }

  restart() {
    this.fx.reset();
    this.stick.reset();
    this.chase.chase();
  }

  frame(camera: PerspectiveCamera, dtReal: number, dpr: number) {
    this.cam = camera;
    const dt = Math.min(dtReal, 1 / 20);
    this.realT += dt;
    const e = this.engine;
    const settings = getSettings();
    const still = reduceMotion(settings);
    const low = settings.quality === "low";
    if (this.quality !== settings.quality) {
      this.quality = settings.quality;
      this.bombs.setQuality(!low);
    }
    this.fx.opts = { particles: (low ? 0.5 : 1) * (still ? 0.4 : 1), debris: !low && !still, shake: !still, still };
    this.chase.still = still;
    const simDt = dt * this.clock.scale();

    this.controls.enabled = this.playing && simDt > 0;
    this.controls.apply(e, this.chase.yaw, dt);
    e.update(simDt);

    const s = e.getShooter();
    const cfg = e.getConfig();
    const speed = Math.hypot(s.vx, s.vz);
    const fwd = speed > 1e-3 ? (s.vx * Math.cos(s.yaw) + s.vz * Math.sin(s.yaw)) / speed : 1;
    const yawRate = dt > 0 ? angleDiff(this.lastYaw, s.yaw) / dt : 0;
    this.lastYaw = s.yaw;
    this.stick.update(simDt, s.x, s.z, s.yaw, speed / cfg.moveSpeed, fwd, yawRate, !low);
    this.muzzleColor.lerp(colorAt(bombGlow, e.getCurrentBomb()), 1 - Math.exp(-dt * 20));
    this.stick.setMuzzleColor(this.muzzleColor);

    // camera
    const sectors = e.getDangerByAngle(16);
    let rear = 0;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(angleDiff(s.yaw + Math.PI, sectorCentre(i))) <= Math.PI / 3) rear = Math.max(rear, sectors[i]);
    }
    this.chase.update(camera, dt, s.x, s.z, s.yaw, this.W / this.H, e.getDangerLevel(), rear, this.fx.shakeX, this.fx.shakeY);
    if (!this.introFired && this.chase.introDone && this.chase.introT >= INTRO_TIME) {
      this.introFired = true;
      this.onIntroDone?.();
    }

    this.glow.begin();
    this.decals.begin();
    this.fx.update(simDt);
    const ray = e.getAimRay();
    const want = this.playing && e.getPhase() === "playing" && !e.getShot() && s.cooldown <= 0 ? 1 : 0;
    this.aimAlpha = want ? Math.min(1, this.aimAlpha + dt / 0.12) : 0;
    this.bombs.frame(e, this.stick, { t: this.realT, still, low, colourAssist: settings.colourAssist, showPop: this.aimAlpha > 0.5 });
    this.glow.end();
    this.decals.end();
    this.laser.update(ray, this.stick.muzzleWorld(this.mv), s.yaw, this.muzzleColor, this.realT, this.aimAlpha, still, this.laserWide);

    this.ground.update({
      time: this.realT, danger: e.getDangerLevel(), sectors, playerX: s.x, playerZ: s.z, low,
      pulse: this.fx.gridPulse, flash: this.fx.borderFlash, surge: this.fx.surge, chase: this.fx.chase,
    });
    this.sky.update(this.realT, camera.position.x, camera.position.y, camera.position.z, low);
    const hfov = hFovFor(camera.fov, this.W / this.H);
    this.radar.update(e, hfov);
    this.particles.setProjection((K * this.H * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360)), 1);
    this.updateThreats(camera, sectors);
  }

  // Off-screen threat arrows: merged runs of sectors with danger >= 0.5
  // whose centre is outside the view; max 4, strongest first.
  private updateThreats(camera: PerspectiveCamera, sectors: readonly number[]) {
    const s = this.engine.getShooter();
    // walk the ring starting after a calm sector so a run never wraps
    let start = sectors.findIndex((d) => d < 0.5);
    if (start < 0) start = 0;
    const clusters: { d: number; first: number; n: number; a: number }[] = [];
    let open = false;
    for (let k = 1; k <= 16; k++) {
      const i = (start + k) % 16;
      if (sectors[i] < 0.5) {
        open = false;
        continue;
      }
      const last = clusters[clusters.length - 1];
      if (open && last) {
        last.d = Math.max(last.d, sectors[i]);
        last.n++;
      } else {
        clusters.push({ d: sectors[i], first: i, n: 1, a: 0 });
        open = true;
      }
    }
    for (const c of clusters) c.a = sectorCentre(c.first) + ((c.n - 1) / 2) * ((Math.PI * 2) / 16);
    clusters.sort((p, q) => q.d - p.d);
    let n = 0;
    const r = this.arrowRect ?? { x: 0, y: 0, w: this.W, h: this.H };
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (const c of clusters) {
      if (n >= 4) break;
      const px = Math.cos(c.a) * 6.5;
      const pz = Math.sin(c.a) * 6.5;
      this.pv.set(px, 0.3, pz).project(camera);
      const behind = this.pv.z > 1;
      if (!behind && Math.abs(this.pv.x) < 0.95 && Math.abs(this.pv.y) < 0.95) continue;
      const rel = angleDiff(this.chase.yaw, Math.atan2(pz - s.z, px - s.x)); // 0 = ahead, + = right
      const t = this.threats[n++];
      t.x = cx + Math.sin(rel) * Math.max(0, r.w / 2 - 28);
      t.y = cy - Math.cos(rel) * Math.max(0, r.h / 2 - 28);
      for (const b of this.arrowAvoid) {
        if (t.x > b.x - 28 && t.x < b.x + b.w + 28 && t.y > b.y - 28 && t.y < b.y + b.h + 28) {
          // move vertically out of the box towards the rect centre
          t.y = t.y > cy ? b.y - 30 : b.y + b.h + 30;
        }
      }
      t.rot = (rel * 180) / Math.PI;
      t.d = c.d;
      t.angle = Math.atan2(pz - s.z, px - s.x);
    }
    this.threatCount = n;
  }

  dispose() {
    this.fx.dispose();
    this.ground.dispose();
    this.sky.dispose();
    this.bombs.dispose();
    this.laser.dispose();
    this.particles.dispose();
    this.debris.dispose();
    this.glow.dispose();
    this.decals.dispose();
    this.radar.dispose();
    this.stick.dispose();
    this.textures.forEach((t) => t.dispose());
  }
}
