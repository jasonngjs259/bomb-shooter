// Headless checks for Arena progress + HANGAR data: the persistence reducer
// (level results -> stars bitmask and bests, totalStars -> unlocks incl.
// first boss kills, equip, introsSeen, defensive parse), the AsyncStorage
// store (write-through, load, merge of changes made before the load), the
// skins table vs the spec, and `best` passed into newGame() -> correct
// levelStars.newBest from the real engine.
// Run: npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/arena-progress.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ARENA_CONFIG, ArenaEngine, ArenaEvents, levelDef } from "../src/game/arena";
import {
  bossMkOfLevel, DEFAULT_EQUIPPED, meetsRequirement, requirementLabel, SKIN_ITEMS, skinColors, skinItem, unlockedIds,
} from "../src/game/arena/skins";
import {
  applyLevelStars, emptyProgress, equip, isOwned, levelBest, markIntroSeen, parseProgress, PROGRESS_KEY, reachLevel, starBits, starCount,
} from "../src/storage/arenaProgress";
import { __resetProgressForTests, getProgress, initProgress, setProgress, updateProgress } from "../src/storage/progressStore";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};
type LS = ArenaEvents["levelStars"];
const ev = (level: number, o: Partial<LS> = {}): LS => ({
  level, clear: true, fast: false, flawless: false, count: 1, time: 50, par: 60, bestCombo: 3,
  newBest: { score: true, combo: true, time: true }, ...o,
});

async function main() {
  console.log("- skins table (spec section 3 unlocks)");
  {
    const req = (id: string) => skinItem(id)?.req;
    const stars: [string, number][] = [
      ["cannon.violet", 3], ["trim.magenta", 6], ["cannon.ice", 10], ["trim.sunset", 14], ["cannon.neonpink", 18], ["trim.whitehot", 22], ["trim.prism", 27],
    ];
    for (const [id, n] of stars) assert(JSON.stringify(req(id)) === JSON.stringify({ stars: n }), `${id} needs ${n} stars`);
    assert(JSON.stringify(req("cannon.gold")) === JSON.stringify({ boss: 1 }), "Gold cannon = beat Mk I");
    assert(JSON.stringify(req("plates.chrome")) === JSON.stringify({ boss: 2 }), "Chrome plates = beat Mk II");
    assert(JSON.stringify(req("plates.obsidian")) === JSON.stringify({ boss: 3 }), "Obsidian plates = beat Mk III");
    assert(skinItem("trim.prism")?.prism === true, "Prism hue-cycles");
    const hex: Record<string, string> = {
      "cannon.violet": "#7C5CFF", "trim.magenta": "#FF3DCB", "cannon.gold": "#FFD23F", "cannon.ice": "#CFF4FF", "trim.sunset": "#FF8A3D",
      "plates.chrome": "#B8C2D9", "cannon.neonpink": "#FF5FA2", "trim.whitehot": "#F5F3FF", "plates.obsidian": "#2B2540",
    };
    for (const [id, h] of Object.entries(hex)) assert(skinItem(id)?.hex === h, `${id} colour ${h}`);
    assert(skinItem("plates.chrome")?.metal === 0.8, "chrome metal 0.8");
    for (const slot of ["trim", "cannon", "plates"] as const) assert(skinItem(DEFAULT_EQUIPPED[slot])?.req === null, `default ${slot} is free`);
    assert(new Set(SKIN_ITEMS.map((s) => s.id)).size === SKIN_ITEMS.length, "unique ids");
    assert(requirementLabel({ stars: 10 }) === "★ 10" && requirementLabel({ boss: 2 }) === "BOSS Mk II", "requirement labels");
    // the unlock thresholds 3/6/10/14/18/22/27
    const at = (n: number) => unlockedIds(n, []).length;
    assert(at(2) === 0 && at(3) === 1 && at(6) === 2 && at(10) === 3 && at(14) === 4 && at(18) === 5 && at(22) === 6 && at(27) === 7, "star thresholds");
    assert(unlockedIds(0, [1, 2, 3]).join() === "cannon.gold,plates.chrome,plates.obsidian", "boss unlocks");
    assert(!meetsRequirement({ boss: 2 }, 99, [1]), "stars never buy a boss unlock");
    // boss levels match the engine's level table
    for (let l = 1; l <= 15; l++) assert((levelDef(ARENA_CONFIG, l).boss?.mk ?? 0) === bossMkOfLevel(l), `boss Mk of L${l}`);
    // renderer skin: plain hex, prism flag, unknown / unowned fall back
    const c = skinColors({ trim: "trim.prism", cannon: "cannon.gold", plates: "nope" });
    assert(c.prism && c.trim === "#22F2FF" && c.cannon === "#FFD23F" && c.plates === "#DCD6F7", "skinColors");
    const d = skinColors({ trim: "trim.magenta", cannon: "cannon.violet", plates: "plates.lilac" }, (id) => id === "cannon.violet");
    assert(d.trim === "#22F2FF" && d.cannon === "#7C5CFF" && !d.prism, "skinColors drops unowned items");
  }

  console.log("- reducer: level results -> stars and bests");
  {
    assert(starBits({ clear: true, fast: true, flawless: false }) === 3 && starCount(7) === 3 && starCount(5) === 2, "bitmask");
    let p = emptyProgress();
    assert(p.maxLevel === 1 && p.totalStars === 0 && p.equipped.trim === "trim.cyan", "empty progress");
    let r = applyLevelStars(p, ev(1, { fast: true, time: 40, bestCombo: 4 }), 3000);
    p = r.progress;
    assert(p.levels[1].stars === 3 && p.levels[1].bestTime === 40 && p.levels[1].bestScore === 3000 && p.levels[1].bestCombo === 4, "first clear");
    assert(r.newBest.score && r.newBest.combo && r.newBest.time, "first clear: all new bests");
    assert(p.totalStars === 2 && p.maxLevel === 2 && r.starsGained === 2, "totals + maxLevel");
    // worse run: nothing drops, no new bests; flawless adds a star
    r = applyLevelStars(p, ev(1, { flawless: true, time: 55, bestCombo: 2 }), 1000);
    p = r.progress;
    assert(p.levels[1].stars === 7 && p.levels[1].bestTime === 40 && p.levels[1].bestScore === 3000 && p.levels[1].bestCombo === 4, "best of each kept");
    assert(!r.newBest.score && !r.newBest.combo && !r.newBest.time, "no new bests on a worse run");
    assert(p.totalStars === 3 && r.starsGained === 1, "stars only go up");
    assert(r.newlyUnlocked.join() === "cannon.violet", "3 stars -> Violet cannon");
    // better time only
    r = applyLevelStars(p, ev(1, { time: 39, bestCombo: 1 }), 10);
    assert(r.newBest.time && !r.newBest.score && !r.newBest.combo && r.progress.levels[1].bestTime === 39, "new best time only");
    assert(r.newlyUnlocked.length === 0, "no repeat unlocks");
    p = r.progress;
    // boss L3 first kill -> Gold cannon (plus star unlocks)
    r = applyLevelStars(p, ev(3, { fast: true, flawless: true }), 9000);
    assert(r.bossBeaten === 1 && r.newlyUnlocked.includes("cannon.gold") && r.newlyUnlocked.includes("trim.magenta"), "Mk I kill -> Gold; 6 stars -> Magenta");
    p = r.progress;
    assert(p.maxLevel === 4, "maxLevel after L3");
    assert(applyLevelStars(p, ev(3), 1).bossBeaten === 0, "second Mk I kill: not a first kill");
    // levelBest -> newGame best
    assert(JSON.stringify(levelBest(p, 1)) === JSON.stringify({ score: 3000, combo: 4, time: 39 }), "levelBest");
    assert(JSON.stringify(levelBest(p, 8)) === "{}", "levelBest unknown level");
    assert(reachLevel(p, 6).maxLevel === 6 && reachLevel(p, 2) === p, "reachLevel");
    // all stars for L1-9 -> everything
    let all = emptyProgress();
    for (let l = 1; l <= 9; l++) all = applyLevelStars(all, ev(l, { fast: true, flawless: true }), 100).progress;
    assert(all.totalStars === 27 && all.unlocked.length === SKIN_ITEMS.filter((s) => s.req).length, "27 stars + 3 bosses unlock all");
  }

  console.log("- equip + introsSeen");
  {
    let p = emptyProgress();
    assert(equip(p, "cannon.violet") === p, "locked item: no-op");
    assert(equip(p, "bogus") === p, "unknown item: no-op");
    p = applyLevelStars(p, ev(1, { fast: true, flawless: true }), 1).progress;
    assert(isOwned(p, "cannon.violet") && !isOwned(p, "trim.magenta") && isOwned(p, "trim.cyan"), "isOwned");
    p = equip(p, "cannon.violet");
    assert(p.equipped.cannon === "cannon.violet" && p.equipped.trim === "trim.cyan", "equip into its slot");
    assert(equip(p, "cannon.violet") === p, "re-equip: same object");
    p = equip(p, "cannon.dusk");
    assert(p.equipped.cannon === "cannon.dusk", "defaults always equippable");
    const q = markIntroSeen(p, "fever");
    assert(q.introsSeen.join() === "fever" && markIntroSeen(q, "fever") === q, "introsSeen once");
  }

  console.log("- parse (defensive) + schema round trip");
  {
    assert(parseProgress(null).maxLevel === 1 && parseProgress("{bad json").totalStars === 0, "missing / corrupt -> empty");
    let p = applyLevelStars(emptyProgress(), ev(1, { fast: true, flawless: true }), 500).progress;
    p = markIntroSeen(equip(p, "cannon.violet"), "pickups");
    const raw = JSON.stringify(p);
    const o = JSON.parse(raw);
    assert(
      Object.keys(o).sort().join() === "equipped,introsSeen,levels,maxLevel,totalStars,unlocked" &&
        Object.keys(o.levels[1]).sort().join() === "bestCombo,bestScore,bestTime,stars" &&
        Object.keys(o.equipped).sort().join() === "cannon,plates,trim",
      "stored schema matches the spec"
    );
    const back = parseProgress(raw);
    assert(JSON.stringify(back) === raw, "round trip");
    // tampered: equipped locked item, stars out of range, wrong totals -> sanitised + recomputed
    const bad = parseProgress(JSON.stringify({ ...o, equipped: { trim: "trim.prism", cannon: 5, plates: "plates.chrome" }, totalStars: 99, levels: { 1: { stars: 255, bestTime: "x" }, foo: {} } }));
    assert(bad.equipped.trim === "trim.cyan" && bad.equipped.cannon === "cannon.dusk" && bad.equipped.plates === "plates.lilac", "locked / bad equips reset");
    assert(bad.levels[1].stars === 7 && bad.levels[1].bestTime === null && bad.totalStars === 3 && !("foo" in bad.levels), "levels sanitised, totals recomputed");
    assert(bad.maxLevel === 2, "maxLevel at least last clear + 1");
  }

  console.log("- store: AsyncStorage write-through + early-change merge");
  {
    __resetProgressForTests();
    const stored = applyLevelStars(emptyProgress(), ev(2, { fast: true }), 700).progress;
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(stored));
    // a change before the load finishes (e.g. a tip shown) is merged, not lost
    updateProgress((p) => markIntroSeen(p, "armored"));
    await initProgress();
    const g = getProgress();
    assert(g.levels[2]?.stars === 3 && g.introsSeen.includes("armored") && g.maxLevel === 3, "stored + early change merged");
    const saved = parseProgress(await AsyncStorage.getItem(PROGRESS_KEY));
    assert(saved.introsSeen.includes("armored") && saved.levels[2]?.stars === 3, "merged copy persisted");
    setProgress(equip(applyLevelStars(getProgress(), ev(1, { fast: true, flawless: true }), 1).progress, "cannon.violet"));
    await Promise.resolve();
    const again = parseProgress(await AsyncStorage.getItem(PROGRESS_KEY));
    assert(again.equipped.cannon === "cannon.violet" && again.totalStars === 5, "write-through after load");
  }

  console.log("- engine: newGame({ best }) -> levelStars.newBest");
  {
    const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const win = (best?: { score?: number; combo?: number; time?: number }) => {
      const e = new ArenaEngine({ random: seeded(5), config: { earlyLevels: [{ bombs: 3, creepScale: 0.85 }, ...ARENA_CONFIG.earlyLevels.slice(1)] } });
      let got: LS | null = null;
      e.on("levelStars", (x) => (got = x));
      e.newGame({ level: 1, best });
      for (let i = 0; i < 4000 && e.getPhase() === "playing"; i++) {
        if (i % 20 === 0) {
          const b = e.getBombs().find((x) => x.state === "idle");
          if (b) e.aimAt(b.x, b.z);
          if (!e.getPowerSlot()) e.debugSpawnPickup("mega", e.getShooter().x, e.getShooter().z);
          e.fire();
        }
        e.update(1 / 30);
      }
      return { ev: got as LS | null, score: e.getScore() };
    };
    const first = win();
    assert(first.ev !== null, "debug win reached");
    if (first.ev) {
      assert(first.ev.newBest.score && first.ev.newBest.time, "no best -> everything new");
      const p = applyLevelStars(emptyProgress(), first.ev, first.score).progress;
      const second = win(levelBest(p, 1));
      assert(second.ev !== null && !second.ev.newBest.score && !second.ev.newBest.time && !second.ev.newBest.combo, "same run with persisted bests -> no new bests");
      const r = applyLevelStars(p, second.ev!, second.score);
      assert(!r.newBest.score && !r.newBest.time, "reducer agrees with the engine");
    }
  }

  console.log(`arena-progress: ${checks} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
