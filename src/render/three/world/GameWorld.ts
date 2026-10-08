// Owns every three.js object of the 3D renderer and drives them from one
// per-frame call. React only mounts `root` and calls frame(); all animation
// is imperative (refs, typed arrays), so nothing re-renders per frame.

import {
  AmbientLight, Color, DirectionalLight, Group, PerspectiveCamera, PointLight, Vector3,
} from "three";
import { getSimClock } from "../../../game/clock";
import { GameEngineView, RenderTile } from "../../../game/types";
import { getFxBus } from "../../../fx/bus";
import { getSettings, reduceMotion, updateSettings } from "../../../ui/settings";
import { BoardLayout } from "../../layout";
import { Debris } from "../fx/Debris";
import { FxDirector } from "../fx/FxDirector";
import { Particles } from "../fx/Particles";
import { SpriteBatch } from "../fx/SpriteBatch";
import { bombBase, color, colorAt, HEX } from "../palette";
import { makeGlowTexture, makeGlyphAtlas, makeRingTexture } from "../textures";
import { AimGuide } from "./AimGuide";
import { Background } from "./Background";
import { BoardFrame, SLAB_HEIGHT } from "./BoardFrame";
import { BombBatch } from "./BombBatch";
import { Cannon } from "./Cannon";
import { DEG, clamp01, easeOutBack } from "./easing";
import { placeSky } from "./sky";
import { TitleScene } from "./TitleScene";

const FOV = 30;
const PLAYING = new Set(["ready", "shooting", "resolving"]);

export class GameWorld {
  readonly root = new Group();
  private readonly board = new Group();
  private readonly bg = new Background();
  private readonly frameMesh: BoardFrame;
  private readonly bombs: BombBatch;
  private readonly cannon = new Cannon();
  private readonly aim = new AimGuide();
  private readonly glow: SpriteBatch;
  private readonly rings: SpriteBatch;
  private readonly shadows: SpriteBatch;
  private readonly particles = new Particles(400);
  private readonly debris = new Debris(48);
  readonly fx: FxDirector;
  private readonly title: TitleScene;
  private readonly textures = [makeGlowTexture(), makeRingTexture(), makeGlyphAtlas()];
  private readonly offs: (() => void)[] = [];
  private layout: BoardLayout | null = null;
  showAimGuide = false;
  titleMode = true;
  private realT = 0;
  private aimAlpha = 0;
  private parallax = 0;
  private parallaxV = 0;
  private introT0 = -99;
  private wasTitle = true;
  private quality: "high" | "low" = "high";
  private perfFrames = 0;
  private perfTime = 0;
  private readonly railL = new Color();
  private readonly railR = new Color();
  private readonly cyan = color(HEX.cyan);
  private readonly magenta = color(HEX.magenta);
  private readonly white = color(HEX.white);
  private lastCam = "";
  private lastCamera: PerspectiveCamera | null = null;
  private horizon = -1;
  private sunR = -1;

  constructor(private engine: GameEngineView) {
    const m = engine.getBoardMetrics();
    const [glowTex, ringTex, glyphTex] = this.textures;
    this.glow = new SpriteBatch({ capacity: 900, texture: glowTex, renderOrder: 10 });
    this.rings = new SpriteBatch({ capacity: 160, texture: ringTex, renderOrder: 11 });
    this.shadows = new SpriteBatch({ capacity: 240, texture: glowTex, additive: false, opacity: 0.4, renderOrder: 2 });
    this.bombs = new BombBatch(260, glyphTex, this.glow, this.shadows);
    this.frameMesh = new BoardFrame(m);
    const clock = getSimClock(engine);
    const bus = getFxBus(engine);
    this.fx = new FxDirector(this.particles, this.debris, this.glow, this.rings, clock, bus, (out) => this.cannon.muzzleWorld(out));
    this.fx.attach(engine);
    this.title = new TitleScene(this.fx, bus);
    this.cannon.setNextOffset(engine.getNextBomb().x - engine.getShooter().x);

    // Lights (spec values x PI for three's physically based units)
    const centre = new Vector3(m.width / 2, -m.height / 2, 0);
    const key = new DirectionalLight("#ffffff", 3.8);
    key.position.copy(centre).add(new Vector3(-200, 300, 400));
    key.target.position.copy(centre);
    const rim = new PointLight(HEX.magenta, 4.7, 900, 0);
    rim.position.copy(centre).add(new Vector3(300, 200, -150));
    const fill = new PointLight(HEX.cyan, 1.9, 900, 0);
    fill.position.copy(centre).add(new Vector3(-250, -300, 120));
    this.root.add(new AmbientLight("#3B2A6B", 1.1), key, key.target, rim, fill);

    this.board.add(this.frameMesh.group, this.cannon.group, this.aim.group);
    this.root.add(
      this.bg.mesh, this.bg.vignette, this.board, this.bombs.bombs, this.bombs.hardware, this.bombs.glyphs,
      this.glow.mesh, this.rings.mesh, this.shadows.mesh, this.particles.points, this.debris.mesh
    );
    this.offs.push(
      engine.on("shoot", () => this.cannon.onShoot()),
      engine.on("swap", () => this.cannon.onSwap()),
      engine.on("phaseChanged", ({ phase, previous }) => {
        if (phase === "ready" && !PLAYING.has(previous)) this.introT0 = this.realT;
      }),
      bus.on("titleDetonate", () => this.title.detonate())
    );
  }

  setLayout(layout: BoardLayout) {
    this.layout = layout;
  }

  setTitleMode(on: boolean) {
    if (on && !this.titleMode) this.title.reset();
    this.titleMode = on;
  }

  private applyQuality(q: "high" | "low") {
    if (q === this.quality) return;
    this.quality = q;
    this.bombs.setQuality(q === "high");
    this.bombs.haloAlpha = q === "high" ? 0.9 : 0.6;
  }

  frame(camera: PerspectiveCamera, dpr: number, dtReal: number) {
    const layout = this.layout;
    if (!layout) return;
    const dt = Math.min(dtReal, 1 / 20);
    const e = this.engine;
    const settings = getSettings();
    const still = reduceMotion(settings);
    this.applyQuality(settings.quality);
    const low = this.quality === "low";
    const simDt = dt * getSimClock(e).scale();
    this.realT += dt;
    const fx = this.fx;
    fx.opts = { particleScale: (low ? 0.5 : 1) * (still ? 0.4 : 1), debris: !low && !still, shake: !still, still };
    this.title.still = still;
    this.bombs.glyphAlpha = settings.colourAssist ? 0.6 : 0.28;

    const phase = e.getPhase();
    const title = this.titleMode;
    if (this.wasTitle && !title) this.introT0 = this.realT;
    this.wasTitle = title;
    const playing = PLAYING.has(phase) && !title;
    this.measure(dtReal, playing);

    const bomb = e.getBomb();
    const shooter = e.getShooter();
    const next = e.getNextBomb();
    const danger = title ? 0 : e.getDangerLevel();
    const ceiling = e.getCeilingRows();
    const m = e.getBoardMetrics();
    if (title) this.title.update(dt, layout);
    fx.slamBottom = ceiling.length * m.rowHeight;
    fx.update(simDt, bomb);

    // Camera: straight-on perspective whose z = 0 plane matches `layout`
    // exactly (so screenToBoard stays the orthographic inverse).
    const W = layout.containerWidth;
    const H = layout.containerHeight;
    const s = layout.scale;
    const D = H / s / (2 * Math.tan((FOV / 2) * DEG));
    const cx = (W / 2 - layout.offsetX) / s;
    const cy = (H / 2 - layout.offsetY) / s;
    camera.position.set(cx + fx.shakeX, -cy + fx.shakeY, D);
    camera.rotation.set(0, 0, 0);
    const camKey = `${W}|${H}|${D}`;
    // a remounted canvas (context restore) brings a fresh camera
    if (camKey !== this.lastCam || camera !== this.lastCamera || camera.fov !== FOV) {
      this.lastCam = camKey;
      this.lastCamera = camera;
      camera.fov = FOV;
      camera.aspect = W / H;
      camera.near = Math.max(1, D - 1200);
      camera.far = D + 2000;
      camera.updateProjectionMatrix();
    }
    this.particles.setProjection(s * dpr, D);

    // Background
    const aimTarget = title || still ? 0 : -Math.sin((90 - shooter.angle) * DEG) * 8;
    this.parallaxV += (120 * (aimTarget - this.parallax) - 20 * this.parallaxV) * dt;
    this.parallax += this.parallaxV * dt;
    // Sun + horizon follow the free sky; eased so title -> game glides.
    const sky = placeSky(layout, title, 12, SLAB_HEIGHT);
    const ease = this.horizon < 0 || still ? 1 : 1 - Math.exp(-dt * 5);
    this.horizon += (sky.horizon - this.horizon) * ease;
    this.sunR += (sky.sunR - this.sunR) * ease;
    this.bg.update({
      width: W, height: H, time: this.realT, scroll: still || low ? 0 : this.realT * 0.25,
      horizon: this.horizon, sunR: this.sunR, parallax: this.parallax, heat: clamp01((danger - 0.7) / 0.3),
      pulse: fx.gridPulse, fade: clamp01(this.realT / 0.6), stars: low ? 0.2 : 0.55,
      vignette: title ? 0 : 0.35 * danger * danger,
    });

    this.glow.begin();
    this.rings.begin();
    this.shadows.begin();
    this.bombs.begin();
    this.board.visible = !title;
    if (title) this.title.submitBombs(this.bombs);
    else this.drawBoard(dt, simDt, danger, still, low, phase);
    fx.submitBombs(this.bombs);
    fx.render(bomb.colorIndex);
    this.bombs.end();
    this.glow.end();
    this.rings.end();
    this.shadows.end();
  }

  private drawBoard(dt: number, simDt: number, danger: number, still: boolean, low: boolean, phase: string) {
    const e = this.engine;
    const fx = this.fx;
    const m = e.getBoardMetrics();
    const bomb = e.getBomb();
    const shooter = e.getShooter();
    const ceiling = e.getCeilingRows();
    const t = this.realT;
    const slam = fx.slamOffset;
    const shots = e.getShotsUntilCeiling();
    const rattle = shots === 1 && PLAYING.has(phase) && !still ? Math.sin(t * 2 * Math.PI * 20) * 1.5 : 0;
    const introAge = t - this.introT0;
    const intro = still ? 1 : clamp01(introAge / 0.25);
    const slabBottom = ceiling.length * m.rowHeight + slam - (1 - easeOutBack(intro)) * 120;

    // Rails: pulse, bounce/slam flash, win colour chase
    const pulse = 0.8 + 0.2 * Math.sin((t * Math.PI * 2) / 2.4);
    this.railL.copy(this.cyan).lerp(this.white, fx.railFlashL);
    this.railR.copy(this.cyan).lerp(this.white, fx.railFlashR);
    if (fx.chase >= 0) {
      this.railL.copy(colorAt(bombBase, Math.floor(fx.chase * 10)));
      this.railR.copy(colorAt(bombBase, Math.floor(fx.chase * 10) + 3));
    }
    let dangerAlpha = (0.25 + 0.6 * danger) * (0.75 + 0.25 * Math.sin((t * Math.PI * 2) / (1.2 - 0.8 * danger)));
    if (fx.dangerFlash > 0) dangerAlpha = Math.floor((1 - fx.dangerFlash) / 0.15) % 2 === 0 ? 1 : 0.2;
    this.frameMesh.update({
      slabBottom, rattle, gridOffsetY: slam, parity: ceiling.length % 2, shotsUsed: 5 - shots,
      pipBlink: shots === 1 && PLAYING.has(phase), time: t, dangerAlpha,
      railLeft: this.railL, railRight: this.railR, railBright: pulse,
    });
    const H = m.height + SLAB_HEIGHT;
    for (let i = 0; i < 6; i++) {
      const y = -(-SLAB_HEIGHT + (H * (i + 0.5)) / 6);
      this.glow.add(-3, y, -6, 30, H / 3.4, this.railL, 0.32 * pulse + 0.4 * fx.railFlashL);
      this.glow.add(m.width + 3, y, -6, 30, H / 3.4, this.railR, 0.32 * pulse + 0.4 * fx.railFlashR);
    }
    for (let i = 0; i < 5; i++) {
      this.glow.add((m.width * (i + 0.5)) / 5, -(slabBottom + 1), 12, m.width / 3, 22, this.magenta, 0.35);
    }

    // Board bombs
    const tiles = e.getTiles();
    let lowest = 0;
    for (const tile of tiles) if (tile.state === "idle" && tile.row > lowest) lowest = tile.row;
    const flickerRows = danger > 0.5 ? lowest - 1 : 99;
    const d = this.bombs.draw;
    for (const tile of tiles) {
      if (tile.state !== "idle" || fx.hidden.has(tile.id)) continue;
      this.tileDraw(tile, slam, introAge, still);
      fx.applyJelly(tile.x, -tile.y, d);
      const hot = tile.row >= flickerRows;
      d.glow = hot ? 0.7 : 0.35;
      d.spark = hot ? 0.8 + Math.random() * 0.45 : 1;
      this.bombs.add();
    }

    // Launcher and its bombs
    const playing = PLAYING.has(phase) || phase === "title";
    this.cannon.update(simDt, shooter, bomb, !low);
    this.cannon.group.position.y -= (1 - easeOutBack(clamp01((introAge - 0.15) / 0.35))) * (still ? 0 : 160);
    const flicker = still ? 1 : 0.8 + Math.random() * 0.45;
    if (playing || bomb.visible) this.cannon.submitBombs(this.bombs, bomb, e.getNextBomb(), shooter, flicker);

    // Aim guide fades in over 120ms when a shot is ready
    const want = this.showAimGuide && phase === "ready" ? 1 : 0;
    this.aimAlpha = want ? Math.min(1, this.aimAlpha + dt / 0.12) : 0;
    this.aim.update(e.getAimPath(), this.aimAlpha, bomb.colorIndex, t, still, tiles, this.glow, this.rings);
  }

  private tileDraw(tile: RenderTile, slam: number, introAge: number, still: boolean) {
    const d = this.bombs.draw;
    const k = still ? 1 : clamp01((introAge - tile.row * 0.045 - tile.col * 0.01) / 0.4);
    const drop = k >= 1 ? 0 : (1 - easeOutBack(k, 1.2)) * 420;
    d.x = tile.x;
    d.y = -(tile.y + slam) + drop;
    d.z = 0;
    d.scale = k <= 0 ? 0 : 1;
    const seed = tile.id * 1.7;
    d.rotX = still ? 0 : Math.sin(this.realT * 0.7 + seed) * 0.12;
    d.rotY = still ? 0 : Math.sin(this.realT * 0.9 + seed * 1.3) * 0.32;
    d.rotZ = 0;
    d.squash = 0;
    d.colorIndex = tile.colorIndex;
    d.tint = 0;
    d.halo = 1;
    d.shadow = true;
  }

  // Auto low tier: average frame time over the first 120 game frames > 20ms.
  private measure(dtReal: number, playing: boolean) {
    if (!playing || this.perfFrames >= 130 || getSettings().quality === "low") return;
    this.perfFrames++;
    if (this.perfFrames <= 10) return; // skip warm-up / shader compiles
    this.perfTime += dtReal;
    if (this.perfFrames === 130 && this.perfTime / 120 > 0.02) updateSettings({ quality: "low" }, false);
  }

  dispose() {
    this.offs.forEach((off) => off());
    this.fx.detach();
    this.bg.dispose();
    this.frameMesh.dispose();
    this.bombs.dispose();
    this.cannon.dispose();
    this.aim.dispose();
    this.glow.dispose();
    this.rings.dispose();
    this.shadows.dispose();
    this.particles.dispose();
    this.debris.dispose();
    this.textures.forEach((t) => t.dispose());
  }
}
