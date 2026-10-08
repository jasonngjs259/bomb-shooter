// Spec palette for the 3D renderer. THREE.Color values are linear (three's
// working space); srgb() keeps raw sRGB values for custom shaders that write
// straight to the screen.

import { Color, Vector3 } from "three";

import { BOMB_HEX } from "../../ui/theme";

export { BOMB_HEX };

export const bombBase = BOMB_HEX.map((c) => new Color(c.base));
export const bombGlow = BOMB_HEX.map((c) => new Color(c.glow));
export const bombHighlight = BOMB_HEX.map((c) => new Color(c.highlight));

export const colorAt = (list: Color[], index: number) => list[((index % list.length) + list.length) % list.length];

export const HEX = {
  bgTop: "#0B0420",
  bgMid: "#1A0638",
  bgHorizon: "#3A0A5E",
  bgFloor: "#07020F",
  sunTop: "#FFD23F",
  sunBottom: "#FF3DCB",
  glowA: "#FF3DCB",
  glowB: "#FF8A3D",
  gridNear: "#FF3DCB",
  gridFar: "#7A1FA2",
  star: "#F5F3FF",
  boardBack: "#0E0628",
  rail: "#22F2FF",
  cyan: "#22F2FF",
  magenta: "#FF3DCB",
  gold: "#FFD23F",
  danger: "#FF2D55",
  slab: "#1B1236",
  slabTop: "#3A2C6B",
  rivet: "#6E5FA8",
  metal: "#2A2340",
  fuse: "#C9B48A",
  spark: "#FFE27A",
  sparkHalo: "#FF8A3D",
  panelBorder: "#7C5CFF",
  dust: "#B9AEDC",
  white: "#FFFFFF",
} as const;

export const color = (hex: string) => new Color(hex);

// Raw sRGB components for ShaderMaterial uniforms (no colour management).
export const srgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
