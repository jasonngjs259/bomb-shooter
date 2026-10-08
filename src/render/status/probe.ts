// WebGL availability probe (web). three.js r163+ needs WebGL2, so that is
// what we test. The probe context is released right away. Chrome returns
// null here when it has blocked WebGL for the origin after GPU resets.
// Native (expo-gl) always reports true; a failure there is caught by the
// renderer's error boundary instead.

import { Platform } from "react-native";

// Context attributes shared by the probe and the real canvas. "default"
// power preference: on dual-GPU Macs "high-performance" forces a switch to
// the discrete GPU, and GPU switches are a known source of context loss.
export const WEBGL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "default",
  failIfMajorPerformanceCaveat: false,
};

export function probeWebGL(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext("webgl2", WEBGL_ATTRIBUTES);
    if (!gl || gl.isContextLost()) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
