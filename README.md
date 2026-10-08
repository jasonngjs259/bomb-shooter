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

## Project structure

```
App.tsx, index.ts           Expo entry (gesture + safe-area providers)
src/game/                   Framework-free engine: types, constants, hex grid,
                            physics, animation, GameEngine, useGameEngine hook
src/input/                  Pointer / touch / keyboard -> engine commands
src/render/                 Renderer contract, layout fitting, basic RN renderer
src/render/three/           three.js / react-three-fiber 3D renderer (active)
src/ui/                     HUD, title, pause, game-over card, hints, theme
src/fx/bus.ts               Renderer <-> UI presentation events
src/game/clock.ts           Hit-stop / slow motion / pause clock
src/storage/bestScore.ts    Best score (AsyncStorage; localStorage on web)
src/fx/haptics.ts           expo-haptics wrapper (no-op on web)
```

The engine works in logical board units and knows nothing about React or the
platform. A renderer implements `BoardRenderer` (`src/render/BoardRenderer.ts`)
and is selected in `src/render/index.ts`.
