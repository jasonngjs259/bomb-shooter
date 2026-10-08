// Arena 360 balance sweep: the feature-aware human-ish bot (arena-bot.ts:
// 150 deg/s turn, >= 1.2 s per decision, 0.4 s in fever) plays L1-L12 over seeds 1-20 and
// reports win rate / median clear time against the fun-pass targets, with
// and without the dodge roll, plus feature health.
//   npx tsx scripts/arena-balance.ts [--levels 1,2,3] [--seeds 20] [--variants roll,noroll] [--pace 1.2 --turn 150]

import { playBot } from "./arena-bot";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const LEVELS = arg("levels", "1,2,3,4,5,6,7,8,9,10,11,12").split(",").map(Number);
const SEEDS = Number(arg("seeds", "20"));
const VARIANTS = arg("variants", "roll,noroll").split(",");
const PACE = Number(arg("pace", "1.2"));
const TURN = Number(arg("turn", "150"));
const PATCH = JSON.parse(arg("patch", "null")); // e.g. --patch '{"creepBase":0.036,"bossPatch":{"coreHp":12}}'


const FLOOR: Record<number, number> = { 1: 0.95, 2: 0.95, 3: 0.9, 4: 0.9, 5: 0.85, 6: 0.85, 7: 0.8, 8: 0.75, 9: 0.7 };
const BAND: Record<number, [number, number]> = {
  1: [28, 42], 2: [38, 55], 3: [45, 75], 4: [50, 75], 5: [55, 80], 6: [60, 90], 7: [65, 90], 8: [65, 95], 9: [70, 100],
};
const floorOf = (lv: number) => FLOOR[lv] ?? 0.6;
const bandOf = (lv: number) => BAND[lv] ?? [70, 105];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

if (process.argv[1]?.endsWith("arena-balance.ts")) {
  const rows: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  for (const lv of LEVELS) {
    for (const v of VARIANTS) {
      const withRoll = v === "roll";
      if (!withRoll && lv < 5) continue;
      const res = Array.from({ length: SEEDS }, (_, i) => playBot(lv, i + 1, { roll: withRoll, pace: PACE, turnDeg: TURN, patch: PATCH ?? undefined }));
      const wins = res.filter((x) => x.won);
      const rate = wins.length / res.length;
      const med = median(wins.map((x) => x.time));
      const [lo, hi] = bandOf(lv);
      const flag = (rate >= floorOf(lv) ? "" : " BELOW-FLOOR") + (med >= lo && med <= hi ? "" : " OUT-OF-BAND");
      const lostAt = res.filter((x) => !x.won).map((x) => x.time);
      rows.push(
        `L${String(lv).padEnd(2)} ${withRoll ? "roll  " : "noroll"} win ${pct(rate).padStart(4)} (floor ${pct(floorOf(lv))})  median ${String(med).padStart(5)} s (band ${lo}-${hi})` +
        `  fever ${pct(res.filter((x) => x.fevers > 0).length / res.length)}  pickups ${(res.reduce((s, x) => s + x.pickups, 0) / res.length).toFixed(1)}` +
        `  lurch ${pct(res.filter((x) => x.lurches > 0).length / res.length)}  rollerHit ${pct(res.filter((x) => x.rollerHits > 0).length / res.length)}` +
        `  rolls ${(res.reduce((s, x) => s + x.rolls, 0) / res.length).toFixed(1)}${lostAt.length ? `  lost@ ${lostAt.join(",")}` : ""}${flag}`,
      );
      console.log(rows[rows.length - 1]);
    }
  }
}
