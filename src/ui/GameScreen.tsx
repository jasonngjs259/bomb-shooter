// The single game screen. A full-bleed renderer (the 3D scene fills the
// window) under RN overlays: HUD, title, pause/settings, end card, first-run
// hint and screen flashes. Screens follow the engine phase plus a UI-only
// "menu" flag (back to title from the end card / pause).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFxBus } from "../fx/bus";
import { attachHaptics } from "../fx/haptics";
import { getSimClock } from "../game/clock";
import { useGameEngine } from "../game/useGameEngine";
import { useAimInput } from "../input/useAimInput";
import { activeRenderer, screenToBoard } from "../render";
import { computeGameLayout } from "./gameLayout";
import { GameOverOverlay } from "./GameOverOverlay";
import { HudBar, HudSide } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { RendererNotice } from "./RendererNotice";
import { ScreenFlash } from "./ScreenFlash";
import { reduceMotion, useSettings } from "./settings";
import { palette } from "./theme";
import { TitleScreen } from "./TitleScreen";
import { TutorialHint } from "./TutorialHint";
import { useBestScore } from "./useBestScore";

const PLAYING = new Set(["ready", "shooting", "resolving"]);

export function GameScreen() {
  const { engine, frame } = useGameEngine();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const { best, isNewBest } = useBestScore(engine);
  const settings = useSettings();
  const still = reduceMotion(settings);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [detonating, setDetonating] = useState(false);
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endVisible, setEndVisible] = useState(false);
  const biggestCombo = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => attachHaptics(engine), [engine]);

  const phase = engine.getPhase();
  const playing = PLAYING.has(phase);
  const showTitle = phase === "title" || menu;

  const W = area?.width ?? win.width;
  const H = area?.height ?? win.height;
  const metrics = engine.getBoardMetrics();
  const gl = useMemo(
    () => computeGameLayout(W, H, insets, metrics),
    [W, H, insets, metrics]
  );
  const layout = gl.board;

  const onAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  // Title PLAY: the renderer detonates the logo bomb, then the game starts.
  const detonatingRef = useRef(false);
  const finishTitle = useRef(() => undefined as void);
  finishTitle.current = () => {
    if (!detonatingRef.current) return;
    detonatingRef.current = false;
    engine.newGame();
    setMenu(false);
    setDetonating(false);
  };
  useEffect(() => getFxBus(engine).on("titleDetonated", () => finishTitle.current()), [engine]);
  useEffect(() => {
    if (!detonating) return;
    const id = setTimeout(() => finishTitle.current(), 1200); // renderer without a title scene
    return () => clearTimeout(id);
  }, [detonating]);

  const startGame = useCallback(() => {
    if (engine.getPhase() === "title" || menuRef.current) {
      if (detonatingRef.current) return;
      detonatingRef.current = true;
      setDetonating(true);
      getFxBus(engine).emit("titleDetonate", {});
    } else {
      engine.newGame();
    }
  }, [engine]);
  const { gesture, showAimGuide } = useAimInput({ engine, layout, screenToBoard, onStart: startGame });

  // Pause freezes the sim clock (engine + FX); auto-resume outside play.
  useEffect(() => {
    getSimClock(engine).paused = paused && playing;
    if (!playing && paused) setPaused(false);
  }, [engine, paused, playing]);

  // Biggest combo of the current game
  useEffect(() => {
    const offs = [
      engine.on("pop", ({ combo }) => {
        biggestCombo.current = Math.max(biggestCombo.current, combo);
      }),
      engine.on("phaseChanged", ({ phase: p, previous }) => {
        if (p === "ready" && !PLAYING.has(previous)) biggestCombo.current = 0;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [engine]);

  // End card waits for the game-over / win FX sequence
  useEffect(() => {
    if (phase === "gameOver" || phase === "won") {
      const id = setTimeout(() => setEndVisible(true), still ? 400 : phase === "won" ? 1300 : 1500);
      return () => clearTimeout(id);
    }
    setEndVisible(false);
    return undefined;
  }, [phase, still]);

  // Esc / P toggles pause on desktop web
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        if (PLAYING.has(engine.getPhase()) && !menuRef.current) setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const restart = () => {
    setPaused(false);
    engine.newGame();
  };
  const toMenu = () => {
    setPaused(false);
    setEndVisible(false);
    setMenu(true);
  };

  const Renderer = activeRenderer.Component;
  const onPause = useCallback(() => setPaused(true), []);
  const hudProps = {
    score: engine.getScore(),
    best,
    combo: engine.getCombo(),
    shotsUntilCeiling: engine.getShotsUntilCeiling(),
    nextColorIndex: engine.getNextBomb().colorIndex,
    onPause,
  };

  return (
    <View style={styles.root} onLayout={onAreaLayout}>
      <GestureDetector gesture={gesture}>
        {/* collapsable={false}: Android must keep this view for the gesture handler */}
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Renderer
            engine={engine}
            frame={frame}
            layout={layout}
            showAimGuide={showAimGuide}
            scene={showTitle ? "title" : "game"}
          />
        </View>
      </GestureDetector>

      {!showTitle && !gl.desktop && (
        <View style={[styles.abs, { left: gl.bar.left, top: gl.bar.top, width: gl.bar.width }]}>
          <HudBar {...hudProps} width={gl.bar.width} />
        </View>
      )}
      {!showTitle && gl.desktop && (
        <>
          <View style={[styles.abs, gl.leftPanel]}>
            <HudSide {...hudProps} side="left" />
          </View>
          <View style={[styles.abs, gl.rightPanel]}>
            <HudSide {...hudProps} side="right" />
          </View>
        </>
      )}

      {!showTitle && (
        <TutorialHint engine={engine} layout={layout} active={phase === "ready" && !paused} still={still} />
      )}

      <ScreenFlash engine={engine} />

      {showTitle && (
        <TitleScreen
          width={W}
          height={H}
          best={best}
          still={still}
          detonating={detonating}
          topInset={insets.top}
          onPlay={startGame}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {!showTitle && endVisible && (phase === "gameOver" || phase === "won") && (
        <GameOverOverlay
          won={phase === "won"}
          score={engine.getScore()}
          best={best}
          isNewBest={isNewBest}
          biggestCombo={biggestCombo.current}
          still={still}
          onRetry={restart}
          onMenu={toMenu}
        />
      )}
      {paused && playing && !showTitle && (
        <PauseMenu title="PAUSED" onResume={() => setPaused(false)} onRestart={restart} onMenu={toMenu} />
      )}
      {settingsOpen && showTitle && <PauseMenu title="SETTINGS" onResume={() => setSettingsOpen(false)} />}
      {!paused && !settingsOpen && !endVisible && <RendererNotice bottom={insets.bottom + 6} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bgTop, overflow: "hidden" },
  abs: { position: "absolute" },
});
