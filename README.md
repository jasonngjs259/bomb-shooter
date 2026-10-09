# Bomb Shooter

A hex-grid bubble shooter built with **Expo SDK 57** (React Native + TypeScript).
Runs in **Expo Go** on iOS/Android and in a desktop **web browser**.

Fire coloured bombs from the launcher; match 3 or more of the same colour to pop
them, and anything left hanging falls for bonus points. Consecutive popping shots
build a combo multiplier (up to x5). Every 5 shots a solid ceiling row pushes the
whole board down — if a bomb reaches the red line, it's game over. Clear the
board to win.

## Requirements

- Node.js 24 (npm 11)
- [Expo Go](https://expo.dev/go) on your phone (SDK 57) for mobile testing

## Getting started

```bash
npm install
npx expo start
```

- **Phone:** scan the QR code with Expo Go (Android) or the Camera app (iOS).
- **Web:** press `w` in the Expo terminal, or run `npm run web`.

Other scripts: `npm run ios`, `npm run android`, `npm run typecheck`.
Engine sanity check (headless): `npx tsx scripts/engine-sanity.ts`.
Renderer fallback + layout check (headless): `npx tsx scripts/renderer-fallback.ts`.
Arena checks (headless): `npx tsx scripts/arena-sanity.ts`, `npx tsx scripts/arena-controls.ts`.
Audio logic check (headless, fake players): `npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/audio-sanity.ts`.
Native startup guard: `node scripts/check-native-bundle.mjs` exports an unminified Android bundle, fails on Node-only code (three's `build/three.cjs`, `process.emitWarning()`, module-scope Node / DOM APIs) and load-tests the app's module graph in a `process`-less vm. `metro.config.js` pins `three` to `build/three.module.js` on every platform; after changing it, start Metro with `npx expo start -c`.

## Controls

| Action | Desktop (web) | Mobile |
| --- | --- | --- |
| Aim | Move the mouse, or hold ← → / A D | Touch and drag (aim guide shows while your finger is down) |
| Fire | Click, or Space | Release your finger |
| Swap current / next bomb | X or Shift, or click NEXT | Tap the NEXT bomb (on the board or in the HUD) |
| Start / retry | Space or Enter | Tap PLAY / RETRY |

## 3D (three.js) build

This branch renders the game in real 3D with **three.js** through
**@react-three/fiber** (native: `expo-gl`, web: the DOM canvas) in a neon
synthwave style: lit glossy bomb spheres with fuses and sparks, a rotating
cannon with recoil, a drifting perspective grid floor with a slit sun, neon
rails, a ceiling slab that slams down, and pooled FX (shockwaves, particles,
tumbling debris, falling bombs, screen shake, hit-stop).

Run it exactly like the base app:

```bash
npm install
npx expo start          # scan the QR code with Expo Go (SDK 57), or press w
npx expo start --web    # desktop browser
```

- **Expo Go (iOS / Android):** drag anywhere on the board to aim, release to
  fire; tap the NEXT bomb to swap; the pause button (top right) has Resume,
  Restart, Menu and the Haptics / Reduce motion / Colour assist toggles.
- **Web:** move the mouse to aim and click to fire, or use ← → / A D to aim and
  Space to fire; X or Shift swaps; Esc or P pauses; Space / Enter starts.

The gameplay camera looks straight at the board (no tilt), so aiming is exact:
the board plane is fitted to the same screen rect as the 2D renderers. Effects
honour the OS reduce-motion setting, and the renderer drops to a cheaper
quality tier automatically if the first 120 frames average over 20 ms.
Renderer code lives in `src/render/three/` (`world/` scene parts, `fx/` effect
pools); switch renderers in `src/render/index.ts`.

**2D fallback.** The board is mounted through `src/render/adaptive/`, which
runs the 3D renderer when WebGL works and the plain-View 2D renderer
(`src/render/basic/`) otherwise, with a small "3D graphics unavailable —
running in 2D mode" notice and a **Retry 3D** button. Web probes for WebGL2
before mounting the canvas; a lost context is `preventDefault()`ed and the
canvas remounts when the browser restores it; no restore within 4 s, a second
loss in the same browser session, or any renderer error (error boundary, also
on native) switches to 2D. State machine: `src/render/status/`.

## Arena 360 (new mode)

Pick **ARENA 360** on the title (Classic is still there). You are a neon
astronaut with an arm-cannon standing in a round arena; a ring of bombs
surrounds it on all sides (360°) and slowly creeps inwards.

**Character.** A rigged, animated GLB (`src/assets/models/astronaut.glb`,
loaded with three's GLTFLoader; `src/render/arena/character/`): legs blend
idle / walk / run / strafe / backpedal clips by velocity on one shared gait
phase (no foot sliding; diagonals turn the legs up to 45-60 deg and play one
clip), the torso twists onto the aim and a CCD pass keeps the barrel on the
laser; lean, stop settle, breathing, relaxed stance + fidgets, turn-in-place
steps, recoil, swap reach, surge flinch, death and victory clips. Movement,
key turning, touch drags (1 euro filter) and the chase camera run on
frame-rate independent springs. If the model can't load or animate the
original stick figure (`Stickman.ts`) takes over, so the game never breaks.
Dev web builds expose `window.__arena = { engine, world }` for QA scripts.

**Rules**
- Shoot a bomb into the field: if it touches **3 or more of the same colour**
  (including itself), they pop; small groups cut loose by a pop shatter for a
  bonus, and every pop knocks nearby bombs back outwards.
- Walk around inside the arena to get closer or find a better angle.
- **You lose** when a creeping bomb crosses the arena's border line. Your
  own shots can't lose the game, and a bomb at the line is never hopeless:
  a non-popping shot that would stick within 1 unit of the line becomes a
  **WALL PUSH** (the shot is used up and shoves the bomb it hit, plus its
  cluster, about 1.5 units back out; a second push on the same bomb within
  2 s goes half as far; combo resets). A same-colour shot that still lands
  outside the line sticks as a pair instead, so push for room, then pair
  and pop. A freshly stuck shot gets 1.5 s of grace, and while a bomb is
  within 2 units of the line your next colours favour the closest bombs.
- **You win** when every bomb is cleared; then go on to the next level
  (more bombs, faster creep; the creep also surges every 20 s). The first
  levels ramp gently: 60, 75, 90 bombs, then +12 per level.
- A wall push shows **PUSH!** with a ground shockwave; a shot bouncing off
  the boss shield shows **DEFLECT**.
- Help: the ground danger ring and the radar show where bombs are close,
  red arrows point at off-screen threats (threats behind you sit on the lower
  edge with a "!"), and the aim laser highlights the bombs that would pop.

**Controls**

| Action | Desktop (web) | Phone (landscape) |
| --- | --- | --- |
| Turn / aim | Mouse (click to lock the pointer), Q/E or ← → | Drag on the right side of the screen |
| Move | W A S D (relative to the camera) | Left thumb joystick (appears where you touch) |
| Fire | Left click or Space | FIRE button (fires on touch) |
| Swap current / next | X, Shift or right click | NEXT button |
| Face the biggest threat | R | Tap a red threat arrow (TURN 180 button turns around) |
| Pause | Esc or P | Pause button (top right) |

Phones switch to landscape for Arena (portrait for the title and Classic);
mobile web can't lock orientation, so it uses a portrait layout and asks you
to rotate. The first game shows a 3-step tutorial (move, turn, fire). Pause
has Arena settings: mouse speed (desktop) and aim assist (touch). Arena needs
3D: if WebGL is lost or unavailable the game pauses with **Retry 3D** /
**Play Classic**. Headless checks: `npx tsx scripts/arena-sanity.ts` (rules)
and `npx tsx scripts/arena-controls.ts` (controls + camera maths + render
passes); `npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/arena-smoke.ts`
runs the real Arena frame driver headless (stub renderer) through intro,
play, win and loss; `node scripts/check-no-prototype-calls.mjs` guards against calling
three.js methods through `.prototype`. Dev builds on web accept
`?arenaBombs=12` to shrink level 1 (to reach the win screen quickly); it is
ignored in production builds.

## Project structure

```
App.tsx, index.ts           Expo entry (gesture + safe-area providers)
src/game/                   Framework-free engine: types, constants, hex grid,
                            physics, animation, GameEngine, useGameEngine hook
src/input/                  Pointer / touch / keyboard -> engine commands
src/render/                 Renderer contract, layout fitting, basic RN renderer
src/render/three/           three.js / react-three-fiber 3D renderer
src/render/adaptive/        Active renderer: 3D with automatic 2D fallback
src/render/status/          WebGL probe + context-loss / fallback state
src/game/arena/             Arena 360 engine (framework-free)
src/arena/                  Arena controls (maths, desktop, touch)
src/render/arena/           Arena 360 three.js world (character, camera, FX)
src/ui/arena/               Arena 360 screen, HUD, tutorial, end card
src/ui/                     HUD, title, pause, game-over card, hints, theme
src/fx/bus.ts               Renderer <-> UI presentation events
src/game/clock.ts           Hit-stop / slow motion / pause clock
src/storage/bestScore.ts    Best score (AsyncStorage; localStorage on web)
src/fx/haptics.ts           expo-haptics wrapper (no-op on web)
src/audio/                  expo-audio music + SFX (pools, voice cap, music
                            director, engine event -> sound maps)
```

The engine works in logical board units and knows nothing about React or the
platform. A renderer implements `BoardRenderer` (`src/render/BoardRenderer.ts`)
and is selected in `src/render/index.ts`.

## Credits / assets

- **Astronaut character** (`src/assets/models/astronaut.glb`): "Astronaut"
  from the *Ultimate Modular Men* pack by **Quaternius**
  (https://quaternius.com), released as CC0 / free to use (the pack page now
  shows the Quaternius Asset License: free, commercial use OK, no credit
  required, only redistributing the raw files as an asset pack is not
  allowed). Optimised for the game (clips trimmed, meshes joined, no
  textures); materials are replaced at load with the game's neon palette.
- **Music and sound effects** (`src/assets/audio/`): all CC0 / public domain
  or generated by us; the full per-file list (source URL, author, licence,
  edits) is in [`src/assets/audio/CREDITS.md`](src/assets/audio/CREDITS.md).
  Music: "Cyber Runner" by ansimuz, "Synthwave House Loop" by Fupi and
  "Cyberpunk Menu Music" by ZaninDevelopers (OpenGameArt, CC0). Sound
  effects: Kenney (https://kenney.nl: Sci-Fi Sounds, Impact Sounds,
  Interface Sounds, Digital Audio, Music Jingles, Voiceover Pack; CC0) and
  original synthesis.
