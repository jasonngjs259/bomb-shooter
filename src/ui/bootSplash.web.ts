// Web: public/index.html shows a pure-CSS splash before any JS/WASM loads.
// Fade it out once the app has mounted (and fonts are ready).

export function hideBootSplash() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.classList.add("boot-hide");
  setTimeout(() => el.remove(), 350);
}

// Shown if CanvasKit / the app fails to start
export function showBootError(message: string) {
  if (typeof document === "undefined") return;
  const msg = document.getElementById("boot-splash-msg");
  if (msg) msg.textContent = message;
}
