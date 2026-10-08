// Glow helpers that keep the web build light on Chrome's compositor.
//
// Blurred shadows / text-shadows are native-only. On web, Chrome (Skia
// Graphite) re-rasterises a blurred shadow every time its layer repaints,
// and RN-web Animated (JS driver) repaints animated overlays every frame.
// On dual-GPU Macs that path-atlas work crashed the GPU process, which also
// kills the WebGL context. Web gets crisp, blur-free stand-ins instead, and
// per-frame animated overlays get their own compositor layer so Chrome
// moves them instead of repainting them.

import { Platform, TextStyle, ViewStyle } from "react-native";

export const IS_WEB = Platform.OS === "web";

// Neon text glow: blurred on native, a crisp 0-blur offset on web (or none).
export const textGlow = (color: string, radius: number, webOffset = 0): TextStyle => {
  if (!IS_WEB) return { textShadowColor: color, textShadowRadius: radius, textShadowOffset: { width: 0, height: 0 } };
  return webOffset > 0 ? { textShadowColor: color, textShadowRadius: 0, textShadowOffset: { width: 0, height: webOffset } } : {};
};

// Box glow: native shadow (and Android elevation); nothing on web.
export const boxGlow = (color: string, radius: number, opacity: number, elevation = 0): ViewStyle =>
  IS_WEB
    ? {}
    : { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: 0 }, elevation };

// Prepend to the transform of a view animated every frame from JS: a 3D
// transform promotes it to its own compositor layer on web. No-op on native.
export const ownLayer: { perspective: number }[] = IS_WEB ? [{ perspective: 1000 }] : [];
