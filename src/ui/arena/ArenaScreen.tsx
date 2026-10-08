// Arena 360 screen: owns the ArenaEngine, input state and the 3D world,
// and stacks the RN overlays (HUD, threat arrows, banner, touch controls,
// tutorial, pause, end card, lost-WebGL card). Flow:
//   intro sweep (2.8 s, skippable) -> tutorial (first run, creep paused)
//   -> play (creep on) -> end (lose / win sequence, card at 2.6 s).
// Locks landscape on phones (native); mobile web shows a rotate toast.
// A lost/blocked WebGL context pauses the game (no 2D fallback for Arena).
// Fun pass: one-time feature tips, the L5 roll lesson (creep held), the
// stars / unlock end card, progress (bs.arena.progress: the level's bests
// go into newGame so levelStars.newBest is right) and the equipped skin
// (world.setSkin, guarded until the renderer has it). `startLevel` comes
// from the HANGAR LEVELS tab (score 0); PLAY starts at L1.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArenaControls } from "../../arena/ArenaControls";
import { audio, bindArenaAudio, bindFunEvents, newArenaAudioState } from "../../audio";
import { TouchControls } from "../../arena/TouchControls";
import { useArenaDesktopControls } from "../../arena/useArenaDesktopControls";
import { ARENA_CONFIG, ArenaEngine } from "../../game/arena";
import { SkinColors, skinColors } from "../../game/arena/skins";
import { equip, isOwned, levelBest, markIntroSeen } from "../../storage/arenaProgress";
import { getProgress, updateProgress, useProgress } from "../../storage/progressStore";
import { resetPlayClock, setPlayClockPaused } from "../../arena/playClock";
import { getSimClock } from "../../game/clock";
import { getFxBus } from "../../fx/bus";
import { ArenaCanvas } from "../../render/arena/ArenaCanvas";
import { ArenaWorld, Box, RadarRect } from "../../render/arena/ArenaWorld";
import { astronautBytes } from "../../render/arena/character/astronautAsset";
import { BoardLayout } from "../../render/layout";
import { rendererStatus, useRendererStatus } from "../../render/status";
import { FxTextOverlay } from "../../render/three/FxTextOverlay";
import { lockLandscape } from "../orientation";
import { PauseMenu } from "../PauseMenu";
import { ScreenFlash } from "../ScreenFlash";
import { reduceMotion, useSettings } from "../settings";
import { palette } from "../theme";
import { ArenaEndCard } from "./ArenaEndCard";
import { ArenaHud, BOSS_ROW_H, bossRowTop, useArenaHud } from "./ArenaHud";
import { MOUSE_CHIP_W } from "./arenaHudMetrics";
import { FeatureTips } from "./FeatureTips";
import { RollTutorial, wantsRollTutorial } from "./RollTutorial";
import { Banner, ClickToPlay, LostCard, RotateToast, ThreatArrows } from "./ArenaOverlays";
import { ArenaPauseExtras } from "./ArenaPauseExtras";
import { ArenaTutorial, TUTORIAL_KEY } from "./ArenaTutorial";
import { useArenaSession } from "./useArenaSession";

type Stage = "intro" | "tutorial" | "play" | "end";

// Dev-only (web): ?arenaBombs=12 shrinks level 1 so QA can reach the win /
// NEXT LEVEL sequence quickly. Ignored in production builds and on native.
const devLevel1Bombs = (): number | null => {
  if (!__DEV__ || Platform.OS !== "web" || typeof window === "undefined") return null;
  const n = Number(new URLSearchParams(window.location.search).get("arenaBombs"));
  return Number.isFinite(n) && n >= 1 ? Math.min(150, Math.floor(n)) : null;
};

const finePointer = () =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: fine)").matches
    : false;

type SkinnableWorld = { setSkin?: (skin: SkinColors) => void };

export function ArenaScreen({ onExit, onClassic, startLevel = 1 }: { onExit: () => void; onClassic: () => void; startLevel?: number }) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const W = area?.width ?? win.width;
  const H = area?.height ?? win.height;
  const engine = useMemo(() => {
    const dev = devLevel1Bombs();
    return new ArenaEngine(dev ? { config: { earlyLevels: [{ bombs: dev, creepScale: 0.85 }, ...ARENA_CONFIG.earlyLevels.slice(1)] } } : {});
  }, []);
  const rootRef = useRef<View>(null);
  const controls = useMemo(() => new ArenaControls(), []);
  const clock = getSimClock(engine);
  const bus = getFxBus(engine);
  const world = useMemo(() => new ArenaWorld(engine, controls, clock, bus, astronautBytes), [engine, controls, clock, bus]);
  const settings = useSettings();
  const still = reduceMotion(settings);
  const status = useRendererStatus();
  const glDown = status.mode !== "3d" || status.restoring;
  const desktopInput = useRef(finePointer()).current;
  const desktopHud = desktopInput && W >= 900;
  const portrait = H > W;
  const [stage, setStage] = useState<Stage>("intro");
  const [paused, setPaused] = useState(false);
  const [tutorialRan, setTutorialRan] = useState(false);
  const tutorialSeen = useRef(true);
  const session = useArenaSession(engine, still);
  const hud = useArenaHud(engine);
  const progress = useProgress();
  const [rollTut, setRollTut] = useState(false);
  const [rollNew, setRollNew] = useState(false);
  const newGameAt = useCallback(
    (level: number, keepScore: boolean) => {
      engine.newGame({ level, keepScore, best: levelBest(getProgress(), level) });
      resetPlayClock(engine, true); // released by the clock effect once real play starts
    },
    [engine]
  );
  // Dev-only (web): expose the engine + world for QA scripts (window.__arena).
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web" || typeof window === "undefined") return;
    const w = window as unknown as { __arena?: { engine: ArenaEngine; world: ArenaWorld } };
    w.__arena = { engine, world };
    return () => {
      delete w.__arena;
    };
  }, [engine, world]);

  // Audio: engine + banner events -> sounds (before the mount effect below,
  // so its READY banner and new game are heard); fun-feature events in
  // funEvents.ts (stars / unlock / tip chimes are played by the UI).
  useEffect(() => {
    const st = newArenaAudioState();
    const offs = [bindArenaAudio(engine, audio, st, bus), bindFunEvents(engine, audio, st)];
    audio.music.setScene("game", true);
    return () => {
      offs.forEach((off) => off());
      audio.music.setFever(false);
      audio.music.setBoss(0);
    };
  }, [engine, bus]);

  // mount: landscape, new game, intro sweep with the creep paused
  useEffect(() => {
    void lockLandscape();
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((v) => (tutorialSeen.current = v !== null))
      .catch(() => undefined);
    tutorialSeen.current = false;
    newGameAt(startLevel, false);
    engine.setCreepPaused(true);
    world.startIntro();
    world.onIntroDone = () => setStage((s) => (s === "intro" ? (tutorialSeen.current ? "play" : "tutorial") : s));
    bus.emit("banner", { text: "READY", color: palette.cyan, duration: 1300 });
    return () => {
      world.onIntroDone = null;
      clock.reset();
      world.dispose();
    };
    // mount only: the start level is fixed for this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, world, bus, clock]);

  // GO! banner when play starts (creep + play clock: see below the controls)
  useEffect(() => {
    if (stage === "play") bus.emit("banner", { text: "GO!", color: palette.gold, duration: 900 });
  }, [stage, bus]);

  // L5 roll lesson: once, when play starts on the level that introduces roll
  useEffect(() => {
    if (stage === "play" && wantsRollTutorial(engine)) setRollTut(true);
    if (stage !== "play") setRollTut(false);
  }, [stage, hud.level, engine]);
  // ROLL button "NEW" badge the first time it shows (phone)
  useEffect(() => {
    if (!hud.rollOn || getProgress().introsSeen.includes("rollButton")) return;
    setRollNew(true);
    updateProgress((p) => markIntroSeen(p, "rollButton"));
    const t = setTimeout(() => setRollNew(false), 4000);
    return () => clearTimeout(t);
  }, [hud.rollOn]);

  // equipped skin -> renderer (setSkin lands with the renderer's fun pass)
  const skinKey = `${progress.equipped.trim}|${progress.equipped.cannon}|${progress.equipped.plates}`;
  useEffect(() => {
    const w = world as unknown as SkinnableWorld;
    if (typeof w.setSkin === "function") w.setSkin(skinColors(getProgress().equipped, (id) => isOwned(getProgress(), id)));
  }, [world, skinKey]);

  useEffect(() => {
    if (session.result) setStage("end");
  }, [session.result]);
  useEffect(() => {
    if (stage === "tutorial") setTutorialRan(true);
  }, [stage]);

  const live = (stage === "tutorial" || stage === "play") && !paused && !glDown;
  useEffect(() => {
    world.playing = live;
    clock.paused = paused || glDown;
    audio.setGamePaused(paused || glDown);
  }, [world, clock, live, paused, glDown]);
  useEffect(() => () => audio.setGamePaused(false), []);

  // next: the following level, score kept (the PLAY run); retry: this level from score 0
  const restart = useCallback(
    (next: boolean) => {
      const level = engine.getLevel();
      if (next) newGameAt(level + 1, true);
      else newGameAt(level, false);
      world.restart();
      controls.clear();
      session.reset(next);
      setPaused(false);
      setRollTut(false);
      setStage("play");
      bus.emit("banner", { text: next ? `LEVEL ${level + 1}` : `LEVEL ${level}`, color: palette.gold, duration: 900 });
    },
    [engine, world, controls, session, bus, newGameAt]
  );

  const onIdleKey = useCallback(() => {
    if (stage === "intro") world.chase.skipIntro();
    else if (stage === "end" && session.visible && session.armed) restart(session.result?.won === true);
  }, [stage, world, session, restart]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  // radar viewport (css px, top-left origin) and HUD placement
  const radar: RadarRect = desktopHud
    ? { x: W - 16 - 140, y: 16, size: 140 }
    : { x: insets.left + 12, y: insets.top + 12, size: portrait ? 80 : 88 };
  // Threat arrows: playfield minus HUD bands; pushed out of HUD cards and
  // the touch clusters (they render above the touch zones, see below).
  const arrowRect: Box = desktopHud
    ? { x: 16, y: 16, w: W - 32, h: H - 16 - 44 }
    : { x: insets.left + 16, y: insets.top + (portrait ? 128 : 72), w: W - insets.left - insets.right - 32, h: 0 };
  if (!desktopHud) arrowRect.h = H - insets.bottom - 16 - arrowRect.y;
  const bossTop = bossRowTop(desktopHud, insets.top);
  const bossBox: Box | null = hud.bossMk > 0 ? { x: W / 2 - (desktopHud ? 330 : 260), y: bossTop, w: desktopHud ? 660 : 520, h: BOSS_ROW_H } : null;
  const arrowAvoid: Box[] = desktopHud
    ? [{ x: 16, y: 16, w: 236, h: 330 }, { x: radar.x, y: 16, w: 140, h: 140 + 8 + 130 }, { x: 16, y: H - 44, w: 640, h: 32 }]
    : desktopInput
      ? [
          { x: W / 2 - 220, y: H - insets.bottom - 44, w: 440, h: 36 },
          { x: W - 12 - MOUSE_CHIP_W, y: H - insets.bottom - 12 - 170, w: MOUSE_CHIP_W, h: 170 },
        ]
      : [
          { x: W - insets.right - 230, y: H - insets.bottom - 220, w: 230, h: 220 },
          { x: insets.left + 20, y: H - insets.bottom - 16 - 150, w: 160, h: 150 },
          { x: W / 2 - 220, y: H - insets.bottom - 44, w: 440, h: 36 },
        ];
  if (bossBox) arrowAvoid.push(bossBox);
  const tipTop = hud.bossMk > 0 ? bossTop + BOSS_ROW_H + 8 : desktopHud ? 64 : insets.top + 12 + 52 + 8;
  const radarBox: Box = { x: radar.x, y: radar.y, w: radar.size, h: radar.size };
  const { lock, requestLock, releaseLock } = useArenaDesktopControls({
    enabled: desktopInput, engine, controls, world, active: live, onPause: togglePause, onIdleKey, rootRef,
    uiBoxes: desktopHud ? arrowAvoid : desktopInput ? [radarBox, ...arrowAvoid] : [radarBox],
  });
  useEffect(() => {
    if (paused || stage === "end" || glDown) releaseLock();
  }, [paused, stage, glDown, releaseLock]);
  // Real play only: the creep runs in "play" (not during the L5 roll lesson
  // or the CLICK TO PLAY gate); the par / star clock is also held while
  // paused, during the intro, the L1 tutorial and the end sequence.
  const gateUp = desktopInput && live && lock === "none";
  const creepHeld = stage !== "play" || rollTut || gateUp;
  const clockHeld = creepHeld || paused || glDown;
  useEffect(() => {
    engine.setCreepPaused(creepHeld);
  }, [creepHeld, engine]);
  useEffect(() => {
    setPlayClockPaused(engine, clockHeld);
  }, [clockHeld, engine]);
  useEffect(() => {
    world.radarRect = stage === "intro" ? null : radar;
    world.arrowRect = arrowRect;
    world.arrowAvoid = arrowAvoid;
  });
  const hudLeft = radar.x + radar.size + 12;
  const floatLayout: BoardLayout = useMemo(
    () => ({ scale: 1, offsetX: 0, offsetY: 0, width: W, height: H, containerWidth: W, containerHeight: H }),
    [W, H]
  );
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((p) => (p && p.width === width && p.height === height ? p : { width, height }));
  }, []);
  const setLaserWide = useCallback((w: number) => (world.laserWide = w), [world]);
  const res = session.result;

  return (
    <View ref={rootRef} style={styles.root} onLayout={onLayout}>
      <ArenaCanvas world={world} />
      <FxTextOverlay engine={engine} layout={floatLayout} />
      {/* touch zones first: everything tappable below renders above them */}
      {!desktopInput && live && (
        <TouchControls
          engine={engine} controls={controls} width={W} height={H} insets={insets} portrait={portrait}
          currentColor={hud.current} nextColor={hud.next} power={hud.power} rollOn={hud.rollOn} rollFill={hud.rollFill}
          rolling={hud.rolling} rollNew={rollNew}
        />
      )}
      {stage !== "intro" && stage !== "end" && (
        <ArenaHud
          hud={hud} best={session.best} desktop={desktopHud} radarSize={radar.size} left={hudLeft}
          top={insets.top + 12} width={desktopHud ? W : W - hudLeft - insets.right - 12}
          screenW={W} insetTop={insets.top} insetBottom={insets.bottom} mouse={desktopInput && !desktopHud} onPause={togglePause}
        />
      )}
      <FeatureTips engine={engine} allowed={live && stage === "play" && !rollTut && !gateUp} top={tipTop} />
      <RollTutorial
        engine={engine} desktop={desktopInput} active={rollTut && live && stage === "play"} bottom={insets.bottom + (desktopHud ? 48 : desktopInput ? 170 : 200)}
        onDone={() => setRollTut(false)}
      />
      {live && <ThreatArrows world={world} engine={engine} controls={controls} />}
      <ArenaTutorial
        engine={engine} controls={controls} desktop={desktopInput} active={stage === "tutorial" && !paused}
        swapHintEnabled={tutorialRan && stage === "play" && !paused}
        swapLocked={hud.power !== null}
        bottom={insets.bottom + (desktopHud ? 32 : desktopInput ? 170 : 200)} onDone={() => setStage("play")} onLaserWide={setLaserWide}
      />
      <Banner owner={engine} />
      <ScreenFlash engine={engine} />
      {stage === "intro" && (
        <Pressable accessibilityRole="button" accessibilityLabel="Skip intro" style={StyleSheet.absoluteFill} onPress={() => world.chase.skipIntro()} />
      )}
      {desktopInput && live && lock === "none" && <ClickToPlay onPress={requestLock} fallbackHint={false} />}
      {Platform.OS === "web" && !desktopInput && portrait && <RotateToast />}
      {paused && stage !== "end" && !glDown && (
        <PauseMenu title="PAUSED" onResume={() => setPaused(false)} onRestart={() => restart(false)} onMenu={onExit}>
          <ArenaPauseExtras desktop={desktopInput} />
        </PauseMenu>
      )}
      {stage === "end" && session.visible && res && !glDown && (
        <ArenaEndCard
          won={res.won} score={res.score} best={session.best} isNewBest={session.isNewBest} level={res.level} time={res.time}
          combo={res.combo} stars={session.stars} unlocks={session.unlocks}
          equipped={[progress.equipped.trim, progress.equipped.cannon, progress.equipped.plates]} still={still}
          landscape={!portrait} armed={session.armed}
          onRetry={() => restart(false)} onNext={() => restart(true)} onMenu={onExit}
          onEquip={(id) => updateProgress((p) => equip(p, id))}
        />
      )}
      {glDown && <LostCard onRetry={() => rendererStatus.retry3D()} onClassic={onClassic} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bgTop, overflow: "hidden" },
});
