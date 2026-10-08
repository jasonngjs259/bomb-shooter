// Engine events -> FX (design spec section 7). Returns an unsubscribe.

import type { SimClock } from "../../../game/simClock";
import type { GameEngineView } from "../../../game/types";
import { C, glowC } from "./colorTable";
import { FxSystem } from "./FxSystem";
import { BURST_FLASH, BURST_RING } from "./pools";
import { TEXT_BANNER, TEXT_COMBO, TEXT_SCORE } from "./texts";

const ROW_H = 34;
const MUZZLE = 44; // muzzle distance from the pivot (u)

export function attachFxEvents(engine: GameEngineView, fx: FxSystem, getClock: () => SimClock | undefined, wide: () => boolean) {
  const m = engine.getBoardMetrics();
  fx.dangerLineY = m.deadlineY;

  const offs = [
    engine.on("shoot", ({ x, y, angle, colorIndex }) => {
      fx.shootAt = fx.now;
      const a = (-angle * Math.PI) / 180;
      const mx = x + Math.cos(a) * MUZZLE;
      const my = y + Math.sin(a) * MUZZLE;
      fx.bursts.spawn(BURST_FLASH, mx, my, 0, 18, 0.09, C.white);
      fx.bursts.spawn(BURST_FLASH, mx, my, 0, 26, 0.12, glowC(colorIndex), { alpha: 0.7 });
      fx.sparks(mx, my, 6, colorIndex, a, (25 * Math.PI) / 180, 300, 500, 0.18);
    }),

    engine.on("wallBounce", ({ x, y }) => {
      const color = engine.getBomb().colorIndex;
      const left = x < m.width / 2;
      const wallX = left ? 0 : m.width;
      fx.sparks(wallX, y, 8, color, left ? 0 : Math.PI, Math.PI / 2.2);
      if (left) fx.railLeft = { at: fx.now, y };
      else fx.railRight = { at: fx.now, y };
    }),

    engine.on("snap", ({ x, y, col, row }) => {
      fx.snap = { at: fx.now, x, y, col, row, angle: fx.flightDir };
    }),

    engine.on("pop", ({ tiles, score, combo, centre }) => {
      const n = tiles.length;
      const scale = fx.particleScale();
      const perBomb = Math.max(1, Math.floor(Math.min(10, 80 / n) * scale));
      const shards = Math.min(3, Math.floor(18 / n));
      const sx = fx.snap.x;
      const sy = fx.snap.y;
      for (const t of tiles) {
        // Chain ripple: 35ms per (approximate) BFS ring from the snap cell
        const ring = Math.round(Math.hypot(t.x - sx, t.y - sy) / 40);
        fx.pops.add(t.x, t.y, t.colorIndex, Math.min(0.45, ring * 0.035), perBomb, shards);
      }

      const big = n >= 8;
      const clock = getClock();
      if (clock && (combo >= 3 || big)) clock.hitStop(0.06);
      fx.shakeOrFlash(big ? 6 : 2, big ? 0.22 : 0.12);

      // Final pop of the board: slow motion
      const remaining = engine.getTiles().some((t) => t.state === "idle");
      if (!remaining && clock) clock.slowMotion(0.35, 0.3);

      const desk = wide();
      const cx = Math.min(m.width - 50, Math.max(50, centre.x));
      fx.texts.spawn(TEXT_SCORE, `+${score}`, cx, centre.y, C.gold, desk ? 24 : 20, 0.05);
      if (combo >= 2) {
        const col = combo >= 4 ? C.gold : combo === 3 ? C.magenta : C.cyan;
        const size = combo >= 4 ? (desk ? 54 : 42) : desk ? 44 : 34;
        const cy = Math.max(70, centre.y - 46);
        fx.texts.spawn(TEXT_COMBO, `x${combo} COMBO!`, m.width / 2, cy, col, size, 0.08);
        if (combo >= 4) fx.flashScreen(0.15, 0.08);
      }
    }),

    engine.on("drop", ({ tiles }) => {
      for (const t of tiles) fx.falls.add(t.x, t.y, t.colorIndex);
    }),

    engine.on("ceilingDrop", ({ ceilingRows }) => {
      fx.slamAt = fx.now;
      fx.schedule(0.22, () => {
        fx.impactAt = fx.now;
        fx.shakeOrFlash(10, 0.3);
        fx.railFullAt = fx.now;
        fx.dust(0, m.width, ceilingRows * ROW_H, 24);
      });
    }),

    engine.on("swap", () => {
      fx.swapAt = fx.now;
    }),

    engine.on("gameOver", () => {
      fx.gameOverAt = fx.now;
      getClock()?.hitStop(0.12);
      // Bombs explode bottom-up, 50ms per row (capped at 1.4s)
      fx.schedule(0.42, () => {
        const tiles = engine.getTiles().filter((t) => t.state === "idle");
        const maxRow = tiles.reduce((a, t) => Math.max(a, t.row), 0);
        const per = Math.max(1, Math.round(4 * fx.particleScale()));
        for (const t of tiles) {
          const wait = Math.min(1.4, (maxRow - t.row) * 0.05);
          fx.pops.add(t.x, t.y, t.colorIndex, wait, per, fx.debrisOn() ? 1 : 0);
        }
        fx.boardHidden = true;
        fx.shakeOrFlash(14, 0.5);
      });
    }),

    engine.on("won", () => {
      fx.wonAt = fx.now;
      fx.texts.spawn(TEXT_BANNER, "BOARD CLEAR!", m.width / 2, m.gridHeight * 0.42, C.gold, wide() ? 48 : 34, 0.1);
      for (let i = 0; i < 5; i++) {
        fx.schedule(0.15 + i * 0.4, () => {
          fx.firework(60 + Math.random() * (m.width - 120), 60 + Math.random() * (m.gridHeight * 0.45));
        });
      }
    }),

    engine.on("phaseChanged", ({ phase, previous }) => {
      if (phase === "ready" && (previous === "title" || previous === "gameOver" || previous === "won")) {
        fx.reset();
        fx.startAt = fx.now;
        fx.bursts.spawn(BURST_RING, m.width / 2, m.height - 46, 10, 120, 0.5, C.cyan, { width: 4 });
      } else if (phase === "ready") {
        fx.reloadAt = fx.now;
      } else if (phase === "title") {
        fx.reset();
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}
