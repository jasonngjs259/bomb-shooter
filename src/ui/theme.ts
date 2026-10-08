// Dark theme tokens shared by the UI and the basic renderer.

export const colors = {
  background: "#0d1020",
  surface: "#161a2e",
  surfaceRaised: "#1f2440",
  board: "#141830",
  boardEdge: "#2a3060",
  shooterArea: "#10132a",
  ceiling: "#3a3f5c",
  ceilingEdge: "#5b6188",
  text: "#f2f4ff",
  textMuted: "#9aa3c7",
  accent: "#ffb347",
  accentText: "#1a1206",
  danger: "#ff4d5e",
  success: "#43d36b",
  overlay: "rgba(8, 10, 22, 0.82)",
  aim: "#ffffff",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const fontSizes = { xs: 11, sm: 13, md: 16, lg: 20, xl: 28, title: 40 } as const;
