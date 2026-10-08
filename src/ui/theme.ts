// Neon-arcade theme tokens (design spec v1, section 1 + 2). Shared by the UI,
// the Skia renderer and the basic fallback renderer.

export const palette = {
  bgTop: "#0B0420",
  bgMid: "#1A0638",
  bgHorizon: "#3A0A5E",
  bgFloor: "#07020F",
  horizonGlowA: "#FF3DCB",
  horizonGlowB: "#FF8A3D",
  sunTop: "#FFD23F",
  sunBottom: "#FF3DCB",
  gridNear: "#FF3DCB",
  gridFar: "#7A1FA2",
  star: "#F5F3FF",
  panel: "rgba(22, 10, 51, 0.82)",
  panelSolid: "#160A33",
  panelBorder: "rgba(124, 92, 255, 0.5)",
  boardBack: "rgba(14, 6, 40, 0.72)",
  rail: "#22F2FF",
  textPrimary: "#F5F3FF",
  textSecondary: "#B9AEDC",
  textMuted: "#8B7FB8",
  cyan: "#22F2FF",
  magenta: "#FF3DCB",
  gold: "#FFD23F",
  danger: "#FF2D55",
  ink: "#0B0420",
  slab: "#1B1236",
  slabEdge: "#3A2C6B",
  rivet: "#6E5FA8",
  metal: "#2A2340",
} as const;

// Bomb colours by engine colour index (red, yellow, blue, green, purple, cyan)
export interface BombStyle {
  name: string;
  base: string;
  highlight: string;
  shade: string;
  glow: string;
  glyph: "triangle" | "dot" | "square" | "plus" | "diamond" | "star";
}

export const BOMB_STYLES: readonly BombStyle[] = [
  { name: "Ember", base: "#FF2D55", highlight: "#FFA3B5", shade: "#7A0A22", glow: "#FF2D55", glyph: "triangle" },
  { name: "Volt", base: "#FFD23F", highlight: "#FFF6C2", shade: "#8A5B00", glow: "#FFC400", glyph: "dot" },
  { name: "Cobalt", base: "#3D7BFF", highlight: "#B0CBFF", shade: "#0C2A7A", glow: "#2F6BFF", glyph: "square" },
  { name: "Toxic", base: "#7CFF4F", highlight: "#DAFFC8", shade: "#1F6E0A", glow: "#5CFF2E", glyph: "plus" },
  { name: "Plasma", base: "#B04DFF", highlight: "#E4C2FF", shade: "#43107A", glow: "#A238FF", glyph: "diamond" },
  { name: "Ion", base: "#1EE8D6", highlight: "#BDFFF7", shade: "#04645C", glow: "#00F0E0", glyph: "star" },
];

export const bombStyle = (colorIndex: number): BombStyle =>
  BOMB_STYLES[((colorIndex % BOMB_STYLES.length) + BOMB_STYLES.length) % BOMB_STYLES.length];

// Legacy names kept for the basic renderer and shared components
export const colors = {
  background: palette.bgTop,
  surface: palette.panelSolid,
  surfaceRaised: "#22164A",
  board: "#0E0628",
  boardEdge: "#3A2C6B",
  shooterArea: "#0B0420",
  ceiling: palette.slab,
  ceilingEdge: palette.magenta,
  text: palette.textPrimary,
  textMuted: palette.textSecondary,
  accent: palette.cyan,
  accentText: palette.ink,
  danger: palette.danger,
  success: palette.gold,
  overlay: "rgba(7, 2, 15, 0.75)",
  aim: "#ffffff",
} as const;

// Font family names registered with expo-font (see src/ui/fonts.ts)
export const fonts = {
  display: "Orbitron_900Black",
  score: "Orbitron_800ExtraBold",
  title: "Orbitron_700Bold",
  button: "Rajdhani_700Bold",
  label: "Rajdhani_600SemiBold",
  body: "Rajdhani_500Medium",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 6, md: 10, lg: 16, card: 24, pill: 999 } as const;

export const fontSizes = { xs: 11, sm: 13, md: 16, lg: 20, xl: 28, title: 40 } as const;

// Motion tokens (ms)
export const motion = { fast: 120, base: 220, slow: 400 } as const;
