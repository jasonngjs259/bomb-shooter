// Mobile-web full screen. Pure logic over an injectable window-like object
// (scripts/arena-ui-logic.ts tests it with fakes); nothing touches `window` /
// `document` at module scope, so the native bundle never sees the DOM.
//
//  - Offer the button only on web, on a touch / coarse-pointer device, and
//    only while the page is not already full screen or a standalone /
//    fullscreen home-screen app.
//  - Fullscreen API present (Android Chrome, iPad Safari, desktop-class
//    browsers): requestFullscreen({ navigationUI: "hide" }) inside the tap,
//    webkit fallbacks; then, if Arena wants it or the device is landscape,
//    screen.orientation.lock("landscape") (Android Chrome; failures ignored).
//  - API missing (iPhone Safari): the button opens the "Add to Home Screen"
//    hint; public/index.html + manifest.json make the home-screen launch full screen.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...a: any[]) => any;

export interface FsElement {
  requestFullscreen?: Fn;
  webkitRequestFullscreen?: Fn;
  webkitEnterFullscreen?: Fn;
}

export interface FsDocument {
  documentElement?: FsElement;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  exitFullscreen?: Fn;
  webkitExitFullscreen?: Fn;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
}

export interface FsWindow {
  document?: FsDocument;
  navigator?: { maxTouchPoints?: number; standalone?: boolean; userAgent?: string; platform?: string };
  matchMedia?: (q: string) => { matches: boolean };
  screen?: { orientation?: { lock?: (o: string) => Promise<unknown> } };
  innerWidth?: number;
  innerHeight?: number;
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
}

export type FullscreenMode = "api" | "ios-hint" | "none";

export interface FullscreenEnv {
  web: boolean;
  touch: boolean;
  standalone: boolean; // home-screen app (standalone / fullscreen display-mode)
  active: boolean; // document is full screen right now
  api: boolean; // a requestFullscreen on <html> exists
  ios: boolean; // iPhone / iPod (Share -> Add to Home Screen copy)
}

const media = (w: FsWindow, q: string) => {
  try {
    return typeof w.matchMedia === "function" && w.matchMedia(q).matches;
  } catch {
    return false;
  }
};

export function isFullscreenNow(d: FsDocument | undefined): boolean {
  return !!d && (!!d.fullscreenElement || !!d.webkitFullscreenElement);
}

function requestFn(d: FsDocument | undefined): Fn | null {
  const el = d?.documentElement;
  if (!el) return null;
  if (typeof el.requestFullscreen === "function") return el.requestFullscreen.bind(el);
  if (typeof el.webkitRequestFullscreen === "function") return el.webkitRequestFullscreen.bind(el);
  if (typeof el.webkitEnterFullscreen === "function") return el.webkitEnterFullscreen.bind(el);
  return null;
}

// Read the environment (w = the global window on web; undefined on native).
export function fullscreenEnv(w: FsWindow | undefined, web: boolean): FullscreenEnv {
  if (!web || !w) return { web: false, touch: false, standalone: false, active: false, api: false, ios: false };
  const nav = w.navigator ?? {};
  const d = w.document;
  const ua = `${nav.userAgent ?? ""} ${nav.platform ?? ""}`;
  return {
    web: true,
    touch: media(w, "(pointer: coarse)") || (nav.maxTouchPoints ?? 0) > 0,
    standalone: nav.standalone === true || media(w, "(display-mode: standalone)") || media(w, "(display-mode: fullscreen)"),
    active: isFullscreenNow(d),
    api: requestFn(d) !== null && d?.fullscreenEnabled !== false && d?.webkitFullscreenEnabled !== false,
    ios: /iPhone|iPod/.test(ua),
  };
}

// Show the button? (the exit icon also shows while full screen via the API)
export function shouldOfferFullscreen(env: FullscreenEnv): boolean {
  return env.web && env.touch && !env.standalone;
}

// What a tap does when not full screen.
export function fullscreenMode(env: FullscreenEnv): FullscreenMode {
  if (!shouldOfferFullscreen(env)) return "none";
  return env.api ? "api" : "ios-hint";
}

const PREF_KEY = "bs.prefersFullscreen";

export function prefersFullscreen(w: FsWindow | undefined): boolean {
  try {
    return w?.localStorage?.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPref(w: FsWindow | undefined, on: boolean) {
  try {
    w?.localStorage?.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // private mode: no memory, fine
  }
}

// Arena asks for landscape after entering full screen (set while it is mounted).
let landscapeWanted = false;
export function setFullscreenLandscape(on: boolean) {
  landscapeWanted = on;
}

// Call INSIDE the tap handler (user gesture). Returns what happened.
export async function enterFullscreen(w: FsWindow | undefined): Promise<"entered" | "hint" | "failed"> {
  const d = w?.document;
  const req = requestFn(d);
  if (!req) return "hint";
  try {
    // the promise form; old webkit returns undefined
    await Promise.resolve(req({ navigationUI: "hide" }));
  } catch {
    return "failed";
  }
  rememberPref(w, true);
  const landscape = landscapeWanted || (w?.innerWidth ?? 0) > (w?.innerHeight ?? 0);
  const lock = w?.screen?.orientation?.lock;
  if (landscape && typeof lock === "function") {
    try {
      await lock.call(w!.screen!.orientation, "landscape");
    } catch {
      // iOS / desktop / not allowed: ignore
    }
  }
  return "entered";
}

export async function exitFullscreen(w: FsWindow | undefined): Promise<void> {
  const d = w?.document;
  rememberPref(w, false);
  if (!isFullscreenNow(d)) return;
  try {
    if (typeof d!.exitFullscreen === "function") await Promise.resolve(d!.exitFullscreen());
    else if (typeof d!.webkitExitFullscreen === "function") d!.webkitExitFullscreen();
  } catch {
    // already out
  }
}

// fullscreenchange / webkitfullscreenchange (the user can swipe out).
export function onFullscreenChange(w: FsWindow | undefined, cb: () => void): () => void {
  const d = w?.document;
  if (!d || typeof d.addEventListener !== "function") return () => undefined;
  d.addEventListener("fullscreenchange", cb);
  d.addEventListener("webkitfullscreenchange", cb);
  return () => {
    d.removeEventListener?.("fullscreenchange", cb);
    d.removeEventListener?.("webkitfullscreenchange", cb);
  };
}

export const IOS_HINT = "Add to Home Screen for full screen: tap Share ⬆︎ → Add to Home Screen";
export const GENERIC_HINT = "Full screen isn't available in this browser. Add the game to your home screen for full screen.";
