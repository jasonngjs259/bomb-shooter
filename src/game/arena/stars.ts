// STARS per level (three independent badges, a win is needed for any):
//   CLEAR = win, FAST = play time <= par (ArenaCore.playTime: stops while the
//   creep is paused or setClockPaused(true) - intro, tutorials, gates, pause), FLAWLESS = no roller hit, no lurch and
//   danger never >= 0.9. Win also adds the clear bonus max(0, par - time) x 20,
//   then emits phaseChanged(won), won and levelStars (pure data: the UI
//   persists bests). Best combo is tracked by ArenaCore.bumpCombo.

import type { ArenaCore } from "./arenaCore";
import type { LevelBest, StarProgress } from "./funTypes";

export class Stars {
  readonly progress: StarProgress = { time: 0, par: 0, flawless: true, maxDanger: 0 };
  private best: LevelBest = {};

  constructor(private readonly core: ArenaCore) {}

  reset(best: LevelBest = {}) {
    Object.assign(this.progress, { time: 0, par: this.core.def.par, flawless: true, maxDanger: 0 });
    this.best = best;
  }

  noteDanger(level: number) {
    const p = this.progress;
    if (level > p.maxDanger) p.maxDanger = level;
    if (level >= this.core.fun.stars.flawlessDanger) p.flawless = false;
  }

  breakFlawless() {
    this.progress.flawless = false;
  }

  read(): StarProgress {
    this.progress.time = this.core.playTime;
    return this.progress;
  }

  // The level is won: clear bonus, phase, won, levelStars.
  win() {
    const core = this.core;
    if (!core.playing) return;
    const def = core.def, p = this.read(), time = core.playTime;
    core.sys.shots.clear();
    core.sys.pickups.slot = null;
    core.addScore(Math.round(Math.max(0, def.par - time) * core.fun.stars.clearBonusPerSec));
    core.setPhase("won");
    core.emit("won", { score: core.score, time });
    const fast = time <= def.par;
    const b = this.best;
    core.emit("levelStars", {
      level: core.level, clear: true, fast, flawless: p.flawless, count: 1 + (fast ? 1 : 0) + (p.flawless ? 1 : 0),
      time, par: def.par, bestCombo: core.bestCombo,
      newBest: {
        score: b.score === undefined || core.score > b.score,
        combo: b.combo === undefined || core.bestCombo > b.combo,
        time: b.time === undefined || time < b.time,
      },
    });
  }
}
