// Precomputed Skia colours for the theme and the six bomb styles, so the
// per-frame code never parses colour strings.

import { SkColor } from "@shopify/react-native-skia";
import { BOMB_STYLES, palette } from "../../ui/theme";
import { color } from "./util";

export interface BombColors {
  base: SkColor;
  highlight: SkColor;
  shade: SkColor;
  glow: SkColor;
}

let bombs: BombColors[] | null = null;

export const bombColors = (index: number): BombColors => {
  if (!bombs) {
    bombs = BOMB_STYLES.map((s) => ({
      base: color(s.base),
      highlight: color(s.highlight),
      shade: color(s.shade),
      glow: color(s.glow),
    }));
  }
  const n = bombs.length;
  return bombs[((index % n) + n) % n];
};

let scene: ReturnType<typeof makeScene> | null = null;

const makeScene = () => ({
  white: color("#FFFFFF"),
  black: color("#000000"),
  cyan: color(palette.cyan),
  magenta: color(palette.magenta),
  gold: color(palette.gold),
  danger: color(palette.danger),
  ink: color(palette.ink),
  textPrimary: color(palette.textPrimary),
  textSecondary: color(palette.textSecondary),
  gridNear: color(palette.gridNear),
  gridFar: color(palette.gridFar),
  star: color(palette.star),
  slab: color(palette.slab),
  slabEdge: color(palette.slabEdge),
  rivet: color(palette.rivet),
  metal: color(palette.metal),
  dust: color(palette.textSecondary),
  sparkCore: color("#FFFFFF"),
  sparkMid: color("#FFE27A"),
  sparkHalo: color("#FF8A3D"),
  boardBack: color("#0E0628", 0.72),
  panelBorder: color("#7C5CFF"),
  barrelTop: color("#3A2C6B"),
  barrelBottom: color("#1B1236"),
  baseTop: color("#2A1F52"),
});

export const sceneColors = () => {
  if (!scene) scene = makeScene();
  return scene;
};
