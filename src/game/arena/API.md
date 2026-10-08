# Arena 360 engine API (fun pass)

The contract between the engine (`src/game/arena`, pure TypeScript), the renderer/UI and audio.
Data shapes are in `types.ts` and `funTypes.ts`. Every tunable number is in `ARENA_CONFIG`
(`arenaLayout.ts`), `ARENA_FUN` (`arenaFun.ts`) or the `LEVELS` table (`arenaLevels.ts`).

Units: world units (w, arena radius 6, bomb r 0.45), seconds, radians unless a name says `deg`.
Positions are `(x, z)` on the ground with the origin at the arena centre. Angles go from +x towards +z.

The engine is deterministic for a given `random`, and time only moves through `update(dt)`. Getters
return **live objects** that are reused every frame: read them and copy anything you want to keep. They
don't allocate.

## Construction

```ts
new ArenaEngine({ config?: Partial<ArenaConfig>, fun?: ArenaFunOverrides, random?: () => number })
// fun overrides merge per section, e.g. { fever: { duration: 8 }, roller: { speed: 3 } }
```

## Time scale (slow-mo)

The engine owns slow-mo. **The renderer must step it as `engine.update(realDt * engine.getTimeScale())`.**
The engine works out real time from the scale it reported, so the hold and ramp times are in real seconds.
Triggers:
- First pop of a fever: 0.3 for 0.35 s, then a 0.2 s ramp back to 1.
- Perfect dodge, outside fever: 0.5 for 0.15 s, then a 0.1 s ramp.
- Boss kill hit-stop: 0.05 for 0.2 s.

Each trigger also emits `slowMo`.

## Getters (also on `ArenaEngineView`)

| Getter | Returns |
|---|---|
| `getLevelDef()` | `LevelDef`: bombs, creepBase, armored, ticking, tickTimer, rollers, rollersLive, `rotation: [deg/s band0, deg/s band1]`, doubleRing, `boss: BossDef \| null`, pickups, fever, roll, par, `features`, `introduces` |
| `getPickups()` | `Pickup[]`: `{ id, kind, x, z, y, state: "flying"\|"ground"\|"blinking", age, ttl, locked }` |
| `getPowerSlot()` | `"rainbow" \| "mega" \| "lightning" \| null`, the loaded POWER, fired before the current colour |
| `getFreeze()` | seconds of Freeze left (0 = off) |
| `getFever()` | `{ meter 0..100, active, remaining, lockout }`. While active, `meter` is the 6 s drain bar |
| `getShots()` | `ShotState[]`, up to 4 in fever: `{ id, x, z, dirX, dirZ, colorIndex, travelled, speed, power, wild }`. `getShot()` returns the first one or null |
| `getRollers()` | `Roller[]`: `{ id, x, z, dirX, dirZ, speed, colorIndex, age }`. `speed` is 0 while frozen |
| `getRoll()` | `{ state: "locked"\|"ready"\|"rolling"\|"cooldown", t, cooldown, iFrames, dirX, dirZ }` |
| `getStun()` | seconds of stun left |
| `getBoss()` | `BossState \| null`: `{ mk, id, x, z, r, hp, maxHp, phase, weakColor, nextWeakColor, weakIn, shield[], shieldRadius, orbitSpeed (rad/s, signed), invulnerable }`. Each shield entry is `{ id, angle, x, z, colorIndex, scale }` |
| `getTimeScale()` | current slow-mo scale (1 = normal) |
| `getStarProgress()` | `{ time, par, flawless, maxDanger }`. `flawless` is whether FLAWLESS is still possible |
| `getBestCombo()` | best combo this level. The combo count has no cap; only the score multiplier caps at x5 |
| `getFunConfig()` | the merged `ARENA_FUN` |

`ArenaBomb` gains the following fields:
- `kind`: one of `normal`, `armored`, `ticking` or `roller`.
- `armor`: 1 until the first match.
- `band`: 0 for the inner band, 1 for the outer band.
- `timer`: seconds left on a ticking bomb.
- `armed`: whether a ticking bomb's countdown is running.
- `telegraph`: seconds until a roller detaches, or -1.

`AimRay` gains `target` (`"bomb" | "roller" | "shield" | "core" | null`) and `targetId`. It stops at whichever comes first. `wouldPopIds` takes the loaded power and fever wild shots into account.

The unchanged getters are `getBombs`, `getShooter`, `getCurrentBomb/NextBomb`, `getAimRay`, `getDangerLevel`, `getDangerByAngle`, `getBorderGap` (this now includes the boss core), `getCreepSpeed`, `isCreepPaused`, `getScore`, `getCombo`, `getLevel`, `getPhase`, `getRemaining` (counts ring bombs only), `getTime`, `getRevision` and `getConfig`.

## Commands

| Command | Notes |
|---|---|
| `newGame({ level?, keepScore?, levelDef?, best? })` | `levelDef` overrides the table. `best: { score?, combo?, time? }` holds the persisted bests and is used for `levelStars.newBest` |
| `fire(): boolean` | Fires the loaded power first, without advancing the colour queue. Rejected while rolling or stunned, but the press is buffered: during a roll it fires at roll end, and during the last 0.2 s of a stun it fires when the stun ends |
| `swapBomb(): boolean` | Returns false while a power is loaded. The UI plays the "denied" blip |
| `roll(dirX, dirZ): boolean` | Takes a world-space vector. If its length is ≤ 0.3, the engine uses the move input instead, and if that is also ≤ 0.3 it rolls backward (−facing). Returns true if the roll started or was buffered (pressed ≤ 0.2 s before ready). Before L5 it returns false and `getRoll().state === "locked"` |
| `setFireHeld(held)` | Auto-repeats fire, but only while fever is active |
| `previewPower(kind, yaw): number[]` | Field bomb ids that `kind` would remove if fired along `yaw` |
| `turn(delta)` | Turns at half rate while stunned |
| `setCreepPaused(p)` | Pauses creep, surges, rotation, ticking timers, wall-roller clocks and the boss orbit, creep and regrow. Rollers already rolling keep going, which the L5 tutorial needs |
| dev/tests | `debugSpawnPickup(kind, x, z)`, `debugSetFever(v)`, `debugSetBossHp(hp)`, `debugLaunchRoller(id?, speedScale = 1)` (use 0.7 for the L5 tutorial, which picks a bomb in front of the player), `debugArmTicking(id?)` |

## Events (`engine.on(name, cb)` returns unsubscribe)

Existing events are unchanged: `shoot`, `stick`, `pop`, `shatter`, `miss`, `creepSurge`, `dangerChanged`, `swap`, `gameOver`, `won`, `scoreChanged` and `phaseChanged`.
- `pop` also fires for Rainbow, Lightning and Mega removals. For Mega and Lightning, `megaBlast` or `lightningChain` comes first.
- Armored bombs count toward a match but stay in the field, so `pop.bombs` can hold fewer than 3.
- `miss.deflected` also covers a wrong-colour shot bouncing off the boss shield.
- `gameOver.bombId` is the boss core's id when the core reaches the border.

| Event | Payload | Fires when |
|---|---|---|
| `featureIntro` | `{ feature }` | A feature is first seen this level (the UI filters by `introsSeen`). Some fire at level start: armored, rotation, roll, doubleRing and boss. The rest fire on first occurrence: `pickups` on first landing, each pickup kind on first collect, `fever` when the meter first reaches 40, `ticking` on first arm and `roller` on first telegraph |
| `pickupSpawned` | `{ id, kind, from, to, flight }` | Drop starts its 0.7 s arc. `flight` is 0 for debug spawns |
| `pickupLanded` | `{ id }` | It lands |
| `pickupCollected` | `{ id, kind, x, z, loaded }` | `loaded` means it went into the POWER slot (false for Freeze) |
| `pickupBlocked` | `{ id }` | Player touches a locked pickup (throttled 1/s) |
| `pickupExpired` | `{ id, kind }` | 10 s on the floor |
| `powerFired` | `{ kind, x, z, yaw }` | Comes right after `shoot` for a power shot |
| `megaBlast` | `{ x, z, radius, bombs: FxBomb[] }` | Mega contact |
| `lightningChain` | `{ colorIndex, path: FxBomb[], hop }` | `path` is in hop order. `hop` is the FX seconds per hop (0.04) |
| `freezeStart` | `{ duration }` | Freeze collected or stacked. `duration` is the new seconds left |
| `freezeEnd` | `{}` | Freeze over |
| `feverChanged` | `{ meter, delta }` | Pop, shield pop, roller shot, miss, roller hit, or every 5 points of decay |
| `feverStart` | `{ duration }` | Meter reached 100 (6 s) |
| `feverEnd` | `{ pops, score }` | Fever over. The 4 s lockout starts |
| `slowMo` | `{ scale, realDuration, ramp }` | See Time scale |
| `armorBroken` | `{ id, x, z, colorIndex }` | Armor stripped by a match, an orphan strip or Lightning |
| `tickingArmed` | `{ id, timer }` | Countdown starts |
| `tickingWarning` | `{ id, remaining }` | Each whole second from 5 to 1 |
| `tickingDefused` | `{ id, x, z, remaining }` | A ticking bomb left by pop, shatter or power (+100) |
| `tickingExploded` | `{ id, x, z }` | Countdown hit 0. The bomb is removed with a popping fade |
| `lurch` | `{ distance, angle }` | Wall moves `distance` inward over 0.4 s (easeOutCubic). `angle` is the bomb's |
| `rollerTelegraph` | `{ id, x, z, launchIn }` | Wall bomb `id` shakes for 1 s |
| `rollerLaunched` | `{ id, x, z, dirX, dirZ, speed, colorIndex }` | It detaches from the wall (the bomb `id` leaves `getBombs()` and becomes roller `id`), or the boss spits one |
| `rollerDestroyed` | `{ id, x, z, matched }` | Shot, or exploded on the player (`matched: false`, right after `playerHit`) |
| `rollerExpired` | `{ id, x, z }` | Left the arena or 8 s old |
| `playerHit` | `{ by: "roller", x, z, knockX, knockZ, stun }` | `knockX/knockZ` is the 1.2 w knock-back vector |
| `perfectDodge` | `{ rollerId }` | +50 |
| `rollStart` | `{ dirX, dirZ, duration, distance }` | |
| `rollEnd` | `{}` | |
| `rollReady` | `{}` | Cooldown done |
| `bossSpawned` | `{ mk, hp, shield }` | Right after `phaseChanged → playing` on boss levels |
| `bossShieldPop` | `{ id, x, z, colorIndex, remaining }` | Popped by a shot or power, or by the phase 3 shatter |
| `bossShieldRegrow` | `{ id }` | Grows from the core over 0.5 s (`scale` 0→1) |
| `bossHit` | `{ damage, weak, hp, maxHp, x, z }` | `damage` is 0 while invulnerable |
| `bossWeakColor` | `{ colorIndex, next, in }` | Weak colour changed (every 6 s). Flicker `next` when `weakIn <= 1` |
| `bossPhase` | `{ phase, previous }` | At ≤ 60% and ≤ 25% HP, after `bossHit` |
| `bossDefeated` | `{ mk, score, time }` | Core HP 0. Followed by `shatter` for the ring chain, then `won` and `levelStars` |
| `levelStars` | `{ level, clear, fast, flawless, count, time, par, bestCombo, newBest: { score, combo, time } }` | Right after `won`. This is pure data; the UI persists it |

**Order within one update:** `pop` → `shatter` → `armorBroken` → `tickingDefused` → `feverChanged` → `scoreChanged` → `pickupSpawned`, then `phaseChanged(won)` → `won` → `levelStars`. `bossHit` comes before `bossPhase`. On a boss kill the order is `bossHit` → `bossDefeated` → `slowMo` → `shatter` → `scoreChanged` → `phaseChanged(won)` → `won` → `levelStars`.

## Notes for the renderer / UI

- **Bombs.** Show a cage when `kind === "armored" && armor === 1`, and play the shard FX on `armorBroken`. For ticking bombs, show the dial and digit using `timer`/`armed`, and blink when `timer <= 5`. For a wall roller, show the tread band, and shake it while `telegraph >= 0`. Bombs whose `age < 0` while shattering are a delayed chain shatter: hold them still at alpha 1.
- **Interpolate.**
  - Pickup `x/y/z`: the engine already flies it along the arc.
  - Roller `x/z`: spin = speed / r.
  - Boss core `x/z` and shield `x/z/scale`.
  - Roll displacement: the engine moves the shooter, so play the Roll clip in place.
  - Knock-back: the engine moves the shooter with a spring.
- **Rotation.** Bombs move on their own, so the renderer only reads positions.
- **Freeze tint.** Use `getFreeze() > 0`.
- **Fever.** Drive the vignette and rainbow laser from `getFever().active`.
- **HUD.**
  - Show the POWER chip from `getPowerSlot()`, and lock NEXT while it is set.
  - Drive the ROLL ring from `getRoll().cooldown / 1.6`.
  - Drive the boss bar from `getBoss()`: `hp/maxHp`, ticks at 0.6 and 0.25, and pips from `shield.length`.
  - Show par from `getStarProgress()`.
- **Persistence and controls.** Persist `levelStars`. Map Space or a ROLL button to `roll(moveX, moveZ)` and hold-fire to `setFireHeld`.

## Notes for audio

| Sound | Trigger |
|---|---|
| `shoot` | `shoot` |
| `stick` | `stick` |
| `pop_0..7` | `pop` (pitch from `combo`; fever uses `pop_7`) |
| `pop_big` | `pop` when `bombs.length + shatter >= 6` |
| `shatter` | `shatter` |
| `deflect` | `miss` with `deflected` |
| `miss` | `miss` without `deflected` |
| `swap` | `swap` |
| `denied` | `swapBomb()` returns false |
| `surge_*` | `creepSurge` |
| heartbeat | `getDangerLevel()` |
| `pickup_spawn/collect/expire` | `pickupSpawned` / `pickupCollected` / `pickupExpired` |
| `rainbow_fire` | `powerFired` |
| `mega_blast` | `megaBlast` |
| `lightning_hop` | `lightningChain`: one per `path` entry, spaced `hop` s apart |
| `freeze_on/off` | `freezeStart` / `freezeEnd` |
| `fever_start/end` | `feverStart` / `feverEnd` (music FEVER stem from `getFever().active`) |
| `armor_crack` | `armorBroken` |
| `tick` | `tickingWarning`, plus your own cadence from `timer` |
| `defuse` | `tickingDefused` |
| `lurch` | `lurch` |
| `roller_telegraph` | `rollerTelegraph` |
| `roller_loop` | while `getRollers().length` |
| `roller_break` | `rollerDestroyed` |
| `player_hit` | `playerHit` |
| `perfect` | `perfectDodge` |
| `roll` | `rollStart` |
| `roll_ready` | `rollReady` |
| `boss_intro` | `bossSpawned` |
| `shield_pop` | `bossShieldPop` |
| `core_hit` / `core_weak` | `bossHit` (`weak`) |
| `boss_phase` | `bossPhase` |
| `boss_down` | `bossDefeated` |
| win/lose jingles, stars | `won` / `gameOver` / `levelStars` |

- **Music.** TENSE and CRIT come from `getDangerLevel()` and `getBoss()?.phase`. FEVER overrides both.
- **Ducking.** Duck on `megaBlast`, `lurch`, `bossPhase`, `bossDefeated` and `playerHit`.
