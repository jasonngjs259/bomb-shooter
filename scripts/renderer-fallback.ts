// Headless checks for the 3D -> 2D fallback state machine and the layout
// maths QA flagged: `npx tsx scripts/renderer-fallback.ts`

import { GameEngine } from "../src/game/engine";
import { screenToBoardOrtho } from "../src/render/layout";
import { createRendererStatus, MAX_LOSSES, RESTORE_TIMEOUT_MS, StatusDeps } from "../src/render/status/core";
import { placeSky } from "../src/render/three/world/sky";
import { computeGameLayout } from "../src/ui/gameLayout";
import { barScoreWidth, PANEL_INNER, SCORE_EM_MEASURED, scoreFontFor } from "../src/ui/hudMetrics";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

// Fake platform: controllable probe, in-memory "sessionStorage", manual timers.
const fake = (probeOk: boolean, storedLosses = 0) => {
  const env = { probeOk, stored: storedLosses, timers: [] as { fn: () => void; ms: number; live: boolean }[] };
  const deps: StatusDeps = {
    probe: () => env.probeOk,
    loadLosses: () => env.stored,
    saveLosses: (n) => {
      env.stored = n;
    },
    schedule: (fn, ms) => {
      const t = { fn, ms, live: true };
      env.timers.push(t);
      return () => {
        t.live = false;
      };
    },
  };
  const fire = () => env.timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
  return { env, deps, fire };
};

// 1. Probe fails -> basic (2D) renderer chosen
{
  const { deps } = fake(false);
  const s = createRendererStatus(deps);
  assert(s.get().mode === "2d" && s.get().reason === "unavailable", "no WebGL -> 2D");
}

// 2. Probe ok -> 3D; first loss + restore -> canvas remount (epoch + 1)
{
  const { deps, env } = fake(true);
  const s = createRendererStatus(deps);
  assert(s.get().mode === "3d", "WebGL ok -> 3D");
  let notified = 0;
  s.subscribe(() => notified++);
  s.contextLost();
  assert(s.get().mode === "3d" && s.get().restoring && s.get().losses === 1, "1st loss waits for restore");
  assert(env.stored === 1, "loss count persisted");
  s.contextLost(); // duplicate event while restoring is ignored
  assert(s.get().losses === 1, "duplicate lost event ignored");
  s.contextRestored();
  assert(s.get().mode === "3d" && !s.get().restoring && s.get().epoch === 1, "restore remounts the canvas");
  assert(notified >= 2, "listeners notified");
  // 2nd loss in the session -> 2D
  s.contextLost();
  assert(s.get().mode === "2d" && s.get().reason === "lost" && s.get().losses === MAX_LOSSES, "2nd loss -> 2D");
}

// 3. Loss without restore -> 2D after the timeout
{
  const { deps, env, fire } = fake(true);
  const s = createRendererStatus(deps);
  s.contextLost();
  assert(env.timers[0]?.ms === RESTORE_TIMEOUT_MS, "restore timeout scheduled");
  fire();
  assert(s.get().mode === "2d" && s.get().reason === "lost", "no restore -> 2D");
  s.contextRestored(); // a late restore does not flip back on its own
  assert(s.get().mode === "2d", "late restore ignored");
}

// 4. Restored before the timeout cancels it
{
  const { deps, fire } = fake(true);
  const s = createRendererStatus(deps);
  s.contextLost();
  s.contextRestored();
  fire();
  assert(s.get().mode === "3d", "timer cancelled by restore");
}

// 5. Session already lost the context twice (e.g. reload after Chrome
// blocked WebGL) -> start in 2D without touching WebGL
{
  let probed = false;
  const { deps } = fake(true, MAX_LOSSES);
  const s = createRendererStatus({ ...deps, probe: () => ((probed = true), true) });
  assert(s.get().mode === "2d" && s.get().reason === "lost" && !probed, "persisted losses -> 2D, no probe");
}

// 6. Renderer error (error boundary) -> 2D; Retry 3D
{
  const { deps, env } = fake(true);
  const s = createRendererStatus(deps);
  s.failed(new Error("THREE.WebGLRenderer: Error creating WebGL context."));
  assert(s.get().mode === "2d" && s.get().reason === "error", "renderer error -> 2D");
  env.probeOk = false;
  assert(s.retry3D() === false && s.get().mode === "2d" && s.get().retryFailed, "retry while unavailable stays 2D");
  env.probeOk = true;
  const epoch = s.get().epoch;
  assert(s.retry3D() === true && s.get().mode === "3d" && s.get().epoch === epoch + 1, "retry -> 3D, fresh canvas");
  assert(s.get().losses === 0 && env.stored === 0 && !s.get().retryFailed, "retry resets the loss count");
}

// 7. Layout: HUD score fits, board fits, aiming is the exact inverse
const m = new GameEngine().getBoardMetrics();
const noInsets = { top: 0, bottom: 0, left: 0, right: 0 };
for (const [W, H] of [[320, 568], [360, 800], [390, 844], [430, 932], [1280, 800], [1600, 900]]) {
  const gl = computeGameLayout(W, H, noInsets, m);
  const b = gl.board;
  if (!gl.desktop) {
    const leftW = barScoreWidth(gl.bar.width);
    const fs = scoreFontFor(leftW, 26);
    assert(SCORE_EM_MEASURED * fs <= leftW, `${W}pt: "000,000" at ${fs}pt fits ${leftW.toFixed(1)}pt`);
    console.log(`  ${W}x${H}: bar ${gl.bar.width}pt, score box ${leftW.toFixed(1)}pt, font ${fs}pt needs ${(SCORE_EM_MEASURED * fs).toFixed(1)}pt`);
    const floor = H - (b.offsetY + b.height);
    const sky = b.offsetY - 30 * b.scale - (b.skyTop ?? 0);
    console.log(`  ${W}x${H}: board scale ${b.scale.toFixed(3)}, sky above ${sky.toFixed(0)}pt, floor below ${floor.toFixed(0)}pt`);
    assert(floor >= 8 && floor <= 8 + 48 + 0.5, `${W}x${H}: floor ${floor}`);
  } else {
    const fs = scoreFontFor(PANEL_INNER, 36);
    assert(SCORE_EM_MEASURED * fs <= PANEL_INNER, `desktop panel score ${fs}pt fits`);
  }
  assert(b.offsetX >= 0 && b.offsetX + b.width <= W, `${W}x${H}: board within width`);
  assert(b.offsetY + b.height <= H, `${W}x${H}: board within height`);
  const p = screenToBoardOrtho(b, b.offsetX + 230 * b.scale, b.offsetY + 532 * b.scale);
  assert(Math.abs(p.x - 230) < 1e-9 && Math.abs(p.y - 532) < 1e-9, `${W}x${H}: screenToBoard inverse`);
  // Sun: some of its disc is above the slab or beside the board
  const sky = placeSky(b, false, 12, 26);
  const R = sky.sunR;
  const cy = sky.horizon * H - 0.55 * R;
  const slabTop = b.offsetY - 26 * b.scale;
  const aboveBoard = cy - R < slabTop && cy - R < H && slabTop > Math.max(0, cy - R);
  const besideBoard = R > b.width / 2 + 12 * b.scale;
  assert(aboveBoard || besideBoard, `${W}x${H}: sun partly visible (R ${R.toFixed(0)}, cy ${cy.toFixed(0)}, slab ${slabTop.toFixed(0)})`);
  console.log(`  ${W}x${H}: sun R ${R.toFixed(0)} centre y ${cy.toFixed(0)}, slab top ${slabTop.toFixed(0)}`);
}

console.log(`renderer-fallback: ${checks} checks passed`);
