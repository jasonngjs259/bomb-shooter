// Which board renderer is live (3D WebGL or the 2D fallback) and why.
// A tiny state machine with injected platform hooks (no React Native
// imports) so it runs headless: see scripts/renderer-fallback.ts.
//
//   start    -> 2D if WebGL can't be created or the session already lost
//               the context MAX_LOSSES times, else 3D
//   lost     -> 1st loss: wait for the browser to restore it, then remount
//               the canvas (epoch + 1); no restore in RESTORE_TIMEOUT_MS or
//               a 2nd loss -> 2D
//   error    -> 2D (renderer threw: context creation failed, shader, ...)
//   retry3D  -> probe again; 3D with a fresh canvas, or stay 2D

export type RenderMode = "3d" | "2d";
export type FallbackReason = "unavailable" | "lost" | "error";

export interface RendererStatus {
  mode: RenderMode;
  reason: FallbackReason | null; // why 2D is showing
  losses: number; // WebGL context losses this session
  restoring: boolean; // lost, waiting for the browser to restore it
  epoch: number; // bumping it remounts the GL canvas (fresh context)
  retryFailed: boolean; // the last "Retry 3D" could not create a context
}

export interface StatusDeps {
  probe: () => boolean; // can a WebGL context be created right now?
  loadLosses: () => number; // persisted loss count (this browser session)
  saveLosses: (n: number) => void;
  schedule: (fn: () => void, ms: number) => () => void; // returns cancel
}

export const MAX_LOSSES = 2;
export const RESTORE_TIMEOUT_MS = 4000;

export interface RendererStatusStore {
  get: () => RendererStatus;
  subscribe: (listener: () => void) => () => void;
  contextLost: () => void;
  contextRestored: () => void;
  failed: (error: unknown) => void;
  retry3D: () => boolean;
}

export function createRendererStatus(deps: StatusDeps): RendererStatusStore {
  let state: RendererStatus | null = null;
  let cancelRestore: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const initial = (): RendererStatus => {
    const losses = deps.loadLosses();
    const base = { losses, restoring: false, epoch: 0, retryFailed: false };
    if (losses >= MAX_LOSSES) return { ...base, mode: "2d", reason: "lost" };
    if (!deps.probe()) return { ...base, mode: "2d", reason: "unavailable" };
    return { ...base, mode: "3d", reason: null };
  };
  // Lazy: the WebGL probe runs on first use, not at import time.
  const get = () => {
    if (state === null) state = initial();
    return state;
  };
  const set = (patch: Partial<RendererStatus>) => {
    state = { ...get(), ...patch };
    listeners.forEach((l) => l());
  };
  const stopTimer = () => {
    cancelRestore?.();
    cancelRestore = null;
  };
  const fallback = (reason: FallbackReason) => {
    stopTimer();
    set({ mode: "2d", reason, restoring: false });
  };

  return {
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    contextLost() {
      const s = get();
      if (s.mode !== "3d" || s.restoring) return;
      const losses = s.losses + 1;
      deps.saveLosses(losses);
      if (losses >= MAX_LOSSES) {
        set({ losses });
        fallback("lost");
        return;
      }
      set({ losses, restoring: true });
      cancelRestore = deps.schedule(() => {
        cancelRestore = null;
        if (get().restoring) fallback("lost");
      }, RESTORE_TIMEOUT_MS);
    },
    contextRestored() {
      const s = get();
      if (s.mode !== "3d" || !s.restoring) return;
      stopTimer();
      set({ restoring: false, epoch: s.epoch + 1 });
    },
    failed() {
      if (get().mode === "3d") fallback("error");
    },
    retry3D() {
      stopTimer();
      deps.saveLosses(0);
      if (!deps.probe()) {
        set({ mode: "2d", reason: "unavailable", losses: 0, restoring: false, retryFailed: true });
        return false;
      }
      set({ mode: "3d", reason: null, losses: 0, restoring: false, retryFailed: false, epoch: get().epoch + 1 });
      return true;
    },
  };
}
