// App-wide renderer status: the core state machine wired to the platform
// (WebGL probe, sessionStorage on web for the loss count, setTimeout).

import { useSyncExternalStore } from "react";
import { createRendererStatus, RendererStatus } from "./core";
import { probeWebGL } from "./probe";

const KEY = "bs.webglLosses";

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // blocked storage throws on access
  }
};

export const rendererStatus = createRendererStatus({
  probe: probeWebGL,
  loadLosses: () => {
    try {
      const n = Number(storage()?.getItem(KEY) ?? 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  },
  saveLosses: (n) => {
    try {
      storage()?.setItem(KEY, String(n));
    } catch {
      // not persisted: the in-memory count still applies
    }
  },
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
});

export const useRendererStatus = (): RendererStatus =>
  useSyncExternalStore(rendererStatus.subscribe, rendererStatus.get, rendererStatus.get);

export type { RendererStatus, RenderMode, FallbackReason } from "./core";
