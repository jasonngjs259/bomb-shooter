// Board bombs: the engine's idle tiles drawn as sprite instances, in two
// passes (glow/shadow, then bodies). Adds the snap squash on the landed
// bomb, the neighbour nudge, the ceiling-slam offset and danger sparks.
// Popping / dropping tiles are skipped: the FX system owns their visuals.

import { SkCanvas } from "@shopify/react-native-skia";
import { RenderTile } from "../../game/types";
import { SnapState } from "./fx/FxSystem";
import { SparkDrawer } from "./sparks";
import { SpriteDrawer } from "./spriteDraw";

const SQUASH_TIME = 0.35;
const NUDGE_TIME = 0.2;
const NUDGE = 3;
// Spring(stiffness 500, damping 14) as a closed-form damped oscillation
const OMEGA = Math.sqrt(500);
const ZETA = 14 / (2 * OMEGA);
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);

export interface BombsFrame {
  slamDy: number; // ceiling slam offset (u), <= 0
  snap: SnapState;
  snapT: number; // seconds since the snap
  hidden: boolean; // game over: FX owns every bomb
  time: number;
  dangerSparks: boolean; // flicker sparks on the bottom two rows
}

export class BoardBombs {
  private sparks = new SparkDrawer();

  draw(canvas: SkCanvas, tiles: RenderTile[], sprites: SpriteDrawer, layer: 0 | 1, f: BombsFrame) {
    if (f.hidden) return;
    const snapActive = f.snapT >= 0 && f.snapT < SQUASH_TIME;
    const nudgeActive = f.snapT >= 0 && f.snapT < NUDGE_TIME;
    const { snap } = f;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.state !== "idle") continue;
      let x = t.x;
      let y = t.y + f.slamDy;
      if (snapActive && t.col === snap.col && t.row === snap.row) {
        // Landed bomb: (1.18, 0.84) along its velocity, springing back to 1
        const s = Math.exp(-ZETA * OMEGA * f.snapT) * Math.cos(OMEGA_D * f.snapT);
        sprites.drawTransformed(canvas, t.colorIndex, layer, x, y, 0, 1 + 0.18 * s, 1 - 0.16 * s, 1, snap.angle);
        continue;
      }
      if (nudgeActive) {
        const dx = t.x - snap.x;
        const dy = t.y - snap.y;
        const d = Math.hypot(dx, dy);
        if (d > 1 && d < 46) {
          const k = Math.sin(Math.PI * (f.snapT / NUDGE_TIME)) * NUDGE;
          x += (dx / d) * k;
          y += (dy / d) * k;
        }
      }
      sprites.draw(canvas, t.colorIndex, layer, x, y);
    }
  }

  // Bottom-two-row bombs get live sparks when the board is about to blow
  drawDangerSparks(canvas: SkCanvas, tiles: RenderTile[], f: BombsFrame) {
    if (f.hidden || !f.dangerSparks) return;
    let lowest = -1;
    for (const t of tiles) if (t.state === "idle" && t.row > lowest) lowest = t.row;
    let drawn = 0;
    for (const t of tiles) {
      if (t.state !== "idle" || t.row < lowest - 1) continue;
      this.sparks.draw(canvas, t.x, t.y + f.slamDy, 1, f.time, t.id);
      if (++drawn >= 22) break;
    }
  }
}
