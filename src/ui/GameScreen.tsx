// The single game screen. The board renderer fills the whole window (the
// Skia renderer draws its own synthwave background there); the HUD, title,
// end card, pause menu and first-run hint are RN overlays on top, so they
// never shake. Everything is driven by engine phase.
//
// Layout: phone = HUD bar on top + board below (8pt side gutter);
// wide web (>= 1100pt) = board 92% of the height between two side panels.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { attachHaptics } from "../fx/haptics";
import { useGameEngine } from "../game/useGameEngine";
import { useAimInput } from "../input/useAimInput";
import { activeRenderer, screenToBoard } from "../render";
import { fitBoardInRect } from "../render/layout";
import { useSettings } from "../storage/settings";
import { FirstRunHint } from "./FirstRunHint";
import { GameOverOverlay } from "./GameOverOverlay";
import { HUD_BAR_HEIGHT, HudBar, SidePanels } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { TitleScreen } from "./TitleScreen";
import { colors } from "./theme";
import { useBestScore } from "./useBestScore";

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const TITLE_EXIT_MS = 560; // fuse burn + detonation + white wipe

export function GameScreen() {
  const renderer = activeRenderer;
  const { engine, clock, frame } = useGameEngine({ reactFrames: !renderer.selfAnimated });
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { best, isNewBest } = useBestScore(engine);
  const { reducedMotion } = useSettings();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [menu, setMenu] = useState<"none" | "pause" | "settings">("none");
  const [titleExiting, setTitleExiting] = useState(false);
  const [maxCombo, setMaxCombo] = useState(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => attachHaptics(engine), [engine]);

  // Biggest combo of the current game (for the end card)
  useEffect(() => {
    const offs = [
      engine.on("pop", ({ combo }) => setMaxCombo((m) => Math.max(m, combo))),
      engine.on("phaseChanged", ({ phase, previous }) => {
        if (phase === "ready" && previous !== "shooting" && previous !== "resolving") setMaxCombo(0);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [engine]);

  useEffect(() => {
    clock.paused = menu === "pause";
  }, [clock, menu]);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    []
  );

  const W = size?.width ?? window.width;
  const H = size?.height ?? window.height;
  // Side panels need room: 2 x (240 panel + 32 gap + 16 margin) beside the board
  const wide = W >= 1100 && H >= 600;
  const metrics = engine.getBoardMetrics();
  const frameInsets = renderer.frameInsets ?? NO_INSETS;

  const layout = useMemo(() => {
    if (wide) {
      const rect = { x: 288, y: H * 0.04, width: W - 576, height: H * 0.92 };
      return fitBoardInRect(W, H, rect, metrics.width, metrics.height, frameInsets, 1.6);
    }
    const top = insets.top + 6 + HUD_BAR_HEIGHT + 6;
    const rect = {
      x: insets.left + 8,
      y: top,
      width: W - insets.left - insets.right - 16,
      height: H - top - insets.bottom - 8,
    };
    return fitBoardInRect(W, H, rect, metrics.width, metrics.height, frameInsets);
  }, [wide, W, H, insets.top, insets.bottom, insets.left, insets.right, metrics.width, metrics.height, frameInsets]);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  // Start / restart. From the title, play the detonation first.
  const startGame = useCallback(() => {
    if (menuRef.current !== "none") return;
    if (engine.getPhase() !== "title") {
      clock.reset();
      engine.newGame();
      return;
    }
    if (exitTimer.current) return;
    setTitleExiting(true);
    exitTimer.current = setTimeout(
      () => {
        exitTimer.current = null;
        clock.reset();
        engine.newGame();
        setTitleExiting(false);
      },
      reducedMotion ? 150 : TITLE_EXIT_MS
    );
  }, [engine, clock, reducedMotion]);

  const togglePause = useCallback(() => {
    setMenu((m) => (m === "pause" ? "none" : m === "none" ? "pause" : m));
  }, []);

  const toMenu = useCallback(() => {
    setMenu("none");
    clock.reset();
    engine.showTitle();
  }, [engine, clock]);

  const restart = useCallback(() => {
    setMenu("none");
    clock.reset();
    engine.newGame();
  }, [engine, clock]);

  const { gesture, showAimGuide } = useAimInput({
    engine,
    layout,
    screenToBoard,
    onStart: startGame,
    onPause: togglePause,
    blocked: () => menuRef.current !== "none",
  });

  const phase = engine.getPhase();
  const playing = phase === "ready" || phase === "shooting" || phase === "resolving";
  const Renderer = renderer.Component;
  const hudData = {
    score: engine.getScore(),
    best,
    combo: engine.getCombo(),
    shotsUntilCeiling: engine.getShotsUntilCeiling(),
    nextColorIndex: engine.getNextBomb().colorIndex,
  };

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      <GestureDetector gesture={gesture}>
        {/* collapsable={false}: Android must keep this view for the gesture handler */}
        <View style={[StyleSheet.absoluteFill, wide && styles.crosshair]} collapsable={false}>
          <Renderer engine={engine} frame={frame} layout={layout} showAimGuide={showAimGuide} clock={clock} />
        </View>
      </GestureDetector>

      {playing && !wide && (
        <View style={[styles.hudBar, { top: insets.top + 6 }]}>
          <HudBar data={hudData} onPause={togglePause} reduced={reducedMotion} width={Math.min(W - 32, 520)} />
        </View>
      )}
      {playing && wide && (
        <SidePanels data={hudData} layout={layout} onPause={togglePause} onSwap={() => engine.swapBomb()} reduced={reducedMotion} />
      )}

      {playing && <FirstRunHint engine={engine} phase={phase} layout={layout} reduced={reducedMotion} />}

      {phase === "title" && (
        <TitleScreen
          best={best}
          exiting={titleExiting}
          reduced={reducedMotion}
          onPlay={startGame}
          onSettings={() => setMenu("settings")}
        />
      )}
      {(phase === "gameOver" || phase === "won") && (
        <GameOverOverlay
          key={`${phase}-${engine.getScore()}`}
          won={phase === "won"}
          score={engine.getScore()}
          best={best}
          isNewBest={isNewBest}
          maxCombo={maxCombo}
          reduced={reducedMotion}
          onRetry={startGame}
          onMenu={toMenu}
        />
      )}
      {menu !== "none" && (
        <PauseMenu
          mode={menu}
          onResume={() => setMenu("none")}
          onRestart={menu === "pause" ? restart : undefined}
          onMenu={menu === "pause" ? toMenu : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, overflow: "hidden" },
  hudBar: { position: "absolute", left: 0, right: 0, alignItems: "center", pointerEvents: "box-none" },
  // RN's types only know auto/pointer; react-native-web passes any CSS cursor
  crosshair: { cursor: "crosshair" } as unknown as ViewStyle,
});
