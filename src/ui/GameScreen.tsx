// The Classic game screen + title. A full-bleed renderer (the 3D scene
// fills the window) under RN overlays: HUD, title (mode select), pause /
// settings, end card, first-run hint and screen flashes. Screens follow the
// engine phase plus a UI-only "menu" flag (back to title from the end card /
// pause). Choosing ARENA 360 detonates the logo bomb, then hands over to
// the App (onArena). Keyboard restart from the end card waits for the
// card's buttons to arm (same 1.5 s rule as clicking).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { audio, bindClassicAudio } from "../audio";
import { getFxBus } from "../fx/bus";
import { attachHaptics } from "../fx/haptics";
import { getSimClock } from "../game/clock";
import { useGameEngine } from "../game/useGameEngine";
import { useAimInput } from "../input/useAimInput";
import { activeRenderer, screenToBoard } from "../render";
import { ARENA_BEST_KEY, loadBestScore } from "../storage/bestScore";
import { ARENA_PLAYED_KEY } from "./arena/useArenaSession";
import { ARM_MS } from "./arena/ArenaEndCard";
import { computeGameLayout } from "./gameLayout";
import { GameOverOverlay } from "./GameOverOverlay";
import { HudBar, HudSide } from "./Hud";
import { GameMode } from "./ModeButtons";
import { lockPortrait } from "./orientation";
import { PauseMenu } from "./PauseMenu";
import { RendererNotice } from "./RendererNotice";
import { ScreenFlash } from "./ScreenFlash";
import { reduceMotion, useSettings } from "./settings";
import { palette } from "./theme";
import { TitleScreen } from "./TitleScreen";
import { TutorialHint } from "./TutorialHint";
import { useBestScore } from "./useBestScore";

const PLAYING = new Set(["ready", "shooting", "resolving"]);

const LAST_MODE_KEY = "bs.lastMode";

export function GameScreen({ onArena, autoStart = false }: { onArena: () => void; autoStart?: boolean }) {
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
  const [endArmed, setEndArmed] = useState(false);
  const endArmedRef = useRef(false);
  endArmedRef.current = endArmed;
  const [selected, setSelected] = useState<GameMode>("arena");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [arenaNew, setArenaNew] = useState(false);
  const [bestArena, setBestArena] = useState(0);
  const pendingMode = useRef<GameMode>("classic");
  const biggestCombo = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => attachHaptics(engine), [engine]);
  useEffect(() => bindClassicAudio(engine, audio), [engine]);

  // Title + Classic are portrait on phones; mode memory for the title
  useEffect(() => {
    void lockPortrait();
    if (autoStart) {
      setSelected("classic");
      AsyncStorage.setItem(LAST_MODE_KEY, "classic").catch(() => undefined);
      engine.newGame();
    }
    let alive = true;
    AsyncStorage.multiGet([LAST_MODE_KEY, ARENA_PLAYED_KEY])
      .then(([[, last], [, played]]) => {
        if (!alive) return;
        if (!autoStart && (last === "arena" || last === "classic")) setSelected(last);
        setArenaNew(played === null);
      })
      .catch(() => undefined);
    loadBestScore(ARENA_BEST_KEY).then((v) => alive && setBestArena(v));
    return () => {
      alive = false;
    };
  }, []);

  const phase = engine.getPhase();
  const playing = PLAYING.has(phase);
  const showTitle = phase === "title" || menu;
  // Audio: menu loop on the title, game loop in play (level starts restart it)
  useEffect(() => {
    if (showTitle) audio.music.setScene("menu");
    else if (PLAYING.has(engine.getPhase())) audio.music.setScene("game");
  }, [showTitle, engine]);

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
    AsyncStorage.setItem(LAST_MODE_KEY, pendingMode.current).catch(() => undefined);
    if (pendingMode.current === "arena") {
      onArena();
      return;
    }
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

  const startGame = useCallback((mode?: GameMode) => {
    if (engine.getPhase() === "title" || menuRef.current) {
      if (detonatingRef.current) return;
      pendingMode.current = mode ?? selectedRef.current;
      setSelected(pendingMode.current);
      detonatingRef.current = true;
      setDetonating(true);
      getFxBus(engine).emit("titleDetonate", {});
    } else {
      const p = engine.getPhase();
      // end card: keyboard / tap restart only once its buttons are armed
      if ((p === "gameOver" || p === "won") && !endArmedRef.current) return;
      engine.newGame();
    }
  }, [engine]);
  const onStartKey = useCallback(() => startGame(), [startGame]);
  // no mouse aiming under the pause / settings / title menus
  const aimBlocked = useRef(false);
  aimBlocked.current = paused || settingsOpen || menu;
  const isAimBlocked = useCallback(() => aimBlocked.current, []);
  const { gesture, showAimGuide } = useAimInput({ engine, layout, screenToBoard, onStart: onStartKey, blocked: isAimBlocked });

  // Title keys: Left/Right choose a mode, 1 / 2 play Arena / Classic
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (engine.getPhase() !== "title" && !menuRef.current) return;
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") setSelected((m) => (m === "arena" ? "classic" : "arena"));
      else if (e.code === "Digit1" || e.code === "Numpad1") startGame("arena");
      else if (e.code === "Digit2" || e.code === "Numpad2") startGame("classic");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, startGame]);

  // Pause freezes the sim clock (engine + FX); auto-resume outside play.
  useEffect(() => {
    getSimClock(engine).paused = paused && playing;
    audio.setGamePaused(paused && playing);
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
      const delay = still ? 400 : phase === "won" ? 1300 : 1500;
      const id = setTimeout(() => setEndVisible(true), delay);
      const arm = setTimeout(() => setEndArmed(true), delay + ARM_MS);
      return () => {
        clearTimeout(id);
        clearTimeout(arm);
      };
    }
    setEndVisible(false);
    setEndArmed(false);
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
          bestArena={bestArena}
          arenaNew={arenaNew}
          selected={selected}
          onSelect={setSelected}
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
          armed={endArmed}
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
