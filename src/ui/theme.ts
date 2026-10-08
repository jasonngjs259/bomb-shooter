// Neon arcade design tokens (design spec v1, section 1-2).

export const palette = {
  bgTop: "#0B0420",
  bgMid: "#1A0638",
  bgFloor: "#07020F",
  panel: "rgba(22, 10, 51, 0.82)",
  panelSolid: "#160A33",
  panelBorder: "rgba(124, 92, 255, 0.5)",
  textPrimary: "#F5F3FF",
  textSecondary: "#B9AEDC",
  textMuted: "#8B7FB8",
  cyan: "#22F2FF",
  magenta: "#FF3DCB",
  gold: "#FFD23F",
  danger: "#FF2D55",
  ink: "#0B0420", // label on the primary gradient
  overlay: "rgba(7, 2, 15, 0.75)",
} as const;

// Bomb colours (engine colour index order): base / highlight / glow.
export const BOMB_HEX = [
  { base: "#FF2D55", highlight: "#FFA3B5", glow: "#FF2D55" }, // Ember
  { base: "#FFD23F", highlight: "#FFF6C2", glow: "#FFC400" }, // Volt
  { base: "#3D7BFF", highlight: "#B0CBFF", glow: "#2F6BFF" }, // Cobalt
  { base: "#7CFF4F", highlight: "#DAFFC8", glow: "#5CFF2E" }, // Toxic
  { base: "#B04DFF", highlight: "#E4C2FF", glow: "#A238FF" }, // Plasma
  { base: "#1EE8D6", highlight: "#BDFFF7", glow: "#00F0E0" }, // Ion
] as const;

export const gradients = {
  primary: ["#22F2FF", "#FF3DCB"] as const,
};

export const fonts = {
  display: "Orbitron_900Black",
  score: "Orbitron_800ExtraBold",
  title: "Orbitron_700Bold",
  button: "Rajdhani_700Bold",
  label: "Rajdhani_600SemiBold",
  body: "Rajdhani_500Medium",
} as const;

export const motion = { fast: 120, base: 220, slow: 400 } as const;

// Legacy tokens (basic renderer and shared layout).
export const colors = {
  background: palette.bgTop,
  surface: palette.panelSolid,
  surfaceRaised: "#1f2440",
  board: "#0E0628",
  boardEdge: "#2a3060",
  shooterArea: "#10132a",
  ceiling: "#1B1236",
  ceilingEdge: "#3A2C6B",
  text: palette.textPrimary,
  textMuted: palette.textSecondary,
  accent: palette.gold,
  accentText: palette.ink,
  danger: palette.danger,
  success: "#7CFF4F",
  overlay: palette.overlay,
  aim: "#ffffff",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

export const fontSizes = { xs: 11, sm: 13, md: 16, lg: 20, xl: 28, title: 40 } as const;
