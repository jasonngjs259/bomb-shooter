// Colour indices shared by every FX pool. Pools store a small integer per
// item instead of colour objects, so spawning never allocates.

import { SkColor } from "@shopify/react-native-skia";
import { BOMB_STYLES } from "../../../ui/theme";
import { bombColors, sceneColors } from "../palette";

const N = BOMB_STYLES.length;
const wrap = (i: number) => ((i % N) + N) % N;

export const baseC = (colorIndex: number) => wrap(colorIndex);
export const highlightC = (colorIndex: number) => N + wrap(colorIndex);
export const glowC = (colorIndex: number) => 2 * N + wrap(colorIndex);

export const C = {
  white: 3 * N,
  sparkMid: 3 * N + 1,
  dust: 3 * N + 2,
  gold: 3 * N + 3,
  magenta: 3 * N + 4,
  cyan: 3 * N + 5,
  danger: 3 * N + 6,
  metal: 3 * N + 7,
  halo: 3 * N + 8,
} as const;

let table: SkColor[] | null = null;

export const colorTable = (): SkColor[] => {
  if (table) return table;
  const s = sceneColors();
  const t: SkColor[] = [];
  for (let i = 0; i < N; i++) t.push(bombColors(i).base);
  for (let i = 0; i < N; i++) t.push(bombColors(i).highlight);
  for (let i = 0; i < N; i++) t.push(bombColors(i).glow);
  t.push(s.white, s.sparkMid, s.dust, s.gold, s.magenta, s.cyan, s.danger, s.metal, s.sparkHalo);
  table = t;
  return t;
};

// Palette used by firework bursts and the win rail chase
export const FIREWORK_COLORS = [C.magenta, C.cyan, C.gold, glowC(3), glowC(4), C.white];
