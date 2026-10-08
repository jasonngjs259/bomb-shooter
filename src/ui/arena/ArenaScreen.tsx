// Arena 360 screen: owns the ArenaEngine, input state and the 3D world,
// and stacks the RN overlays (HUD, threat arrows, banner, touch controls,
// tutorial, pause, end card, lost-WebGL card). Flow:
//   intro sweep (2.8 s, skippable) -> tutorial (first run, creep paused)
//   -> play (creep on) -> end (lose / win sequence, card at 2.6 s).
// Locks landscape on phones (native); mobile web shows a rotate toast.
// A lost/blocked WebGL context pauses the game (no 2D fallback for Arena).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArenaControls } from "../../arena/ArenaControls";
import { TouchControls } from "../../arena/TouchControls";
import { useArenaDesktopControls } from "../../arena/useArenaDesktopControls";
import { ArenaEngine } from "../../game/arena";
import { getSimClock } from "../../game/clock";
import { getFxBus } from "../../fx/bus";
import { ArenaCanvas } from "../../render/arena/ArenaCanvas";
import { ArenaWorld, RadarRect } from "../../render/arena/ArenaWorld";
import { BoardLayout } from "../../render/layout";
import { rendererStatus, useRendererStatus } from "../../render/status";
import { FxTextOverlay } from "../../render/three/FxTextOverlay";
import { lockLandscape } from "../orientation";
import { PauseMenu } from "../PauseMenu";
import { ScreenFlash } from "../ScreenFlash";
import { reduceMotion, useSettings } from "../settings";
import { palette } from "../theme";
import { ArenaEndCard } from "./ArenaEndCard";
import { ArenaHud, useArenaHud } from "./ArenaHud";
import { Banner, ClickToPlay, LostCard, RotateToast, ThreatArrows } from "./ArenaOverlays";
import { ArenaPauseExtras } from "./ArenaPauseExtras";
import { ArenaTutorial, TUTORIAL_KEY } from "./ArenaTutorial";
import { useArenaSession } from "./useArenaSession";

type Stage = "intro" | "tutorial" | "play" | "end";

const finePointer = () =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: fine)").matches
    : false;

export function ArenaScreen({ onExit, onClassic }: { onExit: () => void; onClassic: () => void }) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const W = area?.width ?? win.width;
  const H = area?.height ?? win.height;
  const engine = useMemo(() => new ArenaEngine(), []);
  const controls = useMemo(() => new ArenaControls(), []);
  const clock = getSimClock(engine);
  const bus = getFxBus(engine);
  const world = useMemo(() => new ArenaWorld(engine, controls, clock, bus), [engine, controls, clock, bus]);
  const settings = useSettings();
  const still = reduceMotion(settings);
  const status = useRendererStatus();
  const glDown = status.mode !== "3d" || status.restoring;
  const desktopInput = useRef(finePointer()).current;
  const desktopHud = desktopInput && W >= 900;
  const portrait = H > W;
  const [stage, setStage] = useState<Stage>("intro");
  const [paused, setPaused] = useState(false);
  const tutorialSeen = useRef(true);
  const session = useArenaSession(engine, still);
  const hud = useArenaHud(engine);

  // mount: landscape, new game, intro sweep with the creep paused
  useEffect(() => {
    void lockLandscape();
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((v) => (tutorialSeen.current = v !== null))
      .catch(() => undefined);
    tutorialSeen.current = false;
    engine.newGame();
    engine.setCreepPaused(true);
    world.startIntro();
    world.onIntroDone = () => setStage((s) => (s === "intro" ? (tutorialSeen.current ? "play" : "tutorial") : s));
    bus.emit("banner", { text: "READY", color: palette.cyan, duration: 1300 });
    return () => {
      world.onIntroDone = null;
      clock.reset();
      world.dispose();
    };
  }, [engine, world, bus, clock]);

  // creep only runs in "play"; GO! banner when play starts
  useEffect(() => {
    engine.setCreepPaused(stage !== "play");
    if (stage === "play") bus.emit("banner", { text: "GO!", color: palette.gold, duration: 900 });
  }, [stage, engine, bus]);

  useEffect(() => {
    if (session.result) setStage("end");
  }, [session.result]);

  const live = (stage === "tutorial" || stage === "play") && !paused && !glDown;
  useEffect(() => {
    world.playing = live;
    clock.paused = paused || glDown;
  }, [world, clock, live, paused, glDown]);

  const restart = useCallback(
    (next: boolean) => {
      const level = engine.getLevel();
      if (next) engine.newGame({ level: level + 1, keepScore: true });
      else engine.newGame();
      world.restart();
      controls.clear();
      session.reset(next);
      setPaused(false);
      setStage("play");
      bus.emit("banner", { text: next ? `LEVEL ${level + 1}` : "GO!", color: palette.gold, duration: 900 });
    },
    [engine, world, controls, session, bus]
  );

  const onIdleKey = useCallback(() => {
    if (stage === "intro") world.chase.skipIntro();
    else if (stage === "end" && session.visible && session.armed) restart(session.result?.won === true);
  }, [stage, world, session, restart]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const { lock, requestLock, releaseLock } = useArenaDesktopControls({
    enabled: desktopInput, engine, controls, world, active: live, onPause: togglePause, onIdleKey,
  });
  useEffect(() => {
    if (paused || stage === "end" || glDown) releaseLock();
  }, [paused, stage, glDown, releaseLock]);

  // radar viewport (css px, top-left origin) and HUD placement
  const radar: RadarRect = desktopHud
    ? { x: W - 24 - 240 + 40, y: Math.max(16, H / 2 - 260) + 8, size: 160 }
    : { x: insets.left + 12, y: insets.top + 12, size: portrait ? 80 : 88 };
  useEffect(() => {
    world.radarRect = stage === "intro" ? null : radar;
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
    <View style={styles.root} onLayout={onLayout}>
      <ArenaCanvas world={world} />
      <FxTextOverlay engine={engine} layout={floatLayout} />
      {stage !== "intro" && stage !== "end" && (
        <ArenaHud
          hud={hud} best={session.best} desktop={desktopHud} radarSize={radar.size} left={hudLeft}
          top={desktopHud ? Math.max(16, H / 2 - 260) : insets.top + 12} width={desktopHud ? W : W - hudLeft - insets.right - 12}
          onPause={togglePause}
        />
      )}
      {live && <ThreatArrows world={world} engine={engine} controls={controls} />}
      {!desktopInput && live && (
        <TouchControls
          engine={engine} controls={controls} width={W} height={H} insets={insets} portrait={portrait}
          currentColor={hud.current} nextColor={hud.next}
        />
      )}
      <ArenaTutorial
        engine={engine} controls={controls} desktop={desktopInput} active={stage === "tutorial" && !paused}
        bottom={insets.bottom + (desktopInput ? 32 : 200)} onDone={() => setStage("play")} onLaserWide={setLaserWide}
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
          combo={res.combo} landscape={!portrait} armed={session.armed}
          onAgain={() => restart(false)} onNext={() => restart(true)} onMenu={onExit}
        />
      )}
      {glDown && <LostCard onRetry={() => rendererStatus.retry3D()} onClassic={onClassic} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bgTop, overflow: "hidden" },
});
