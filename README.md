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

## 2.5D (Skia) build

This branch renders the game as a **neon-arcade 2.5D scene** with
[`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/):
a synthwave sky with a slatted sun and a drifting perspective grid, glossy
pre-baked bomb sprites with live fuse sparks, a recoiling cannon, a marching
aim guide with a ghost landing bomb, and a pooled FX system (muzzle flash,
trails, chain-reaction pops with shockwaves, particles and debris, combo
labels, ceiling slam with screen shake, hit-stop, game-over and win finales).

Run it:

```bash
npm install          # postinstall copies canvaskit.wasm + the splash font into public/
npx expo start       # scan the QR code with Expo Go (iOS / Android, SDK 57)
npm run web          # or press `w`: desktop browser
```

On web, Skia runs on CanvasKit (WebAssembly). `src/boot.web.ts` loads
`/canvaskit.wasm` (served from `public/`, copied by `npx setup-skia-web public`)
before the app is imported; native startup is unaffected. If the wasm is
missing, run `npx setup-skia-web public`.

Controls in this build:

| Action | Desktop (web) | Mobile |
| --- | --- | --- |
| Aim | Move the mouse, or hold ← → / A D | Touch and drag anywhere |
| Fire | Click, or Space | Release your finger |
| Swap current / next bomb | Right-click, X or Shift, or click NEXT | Tap the NEXT bomb |
| Pause / settings | Esc or P, or the pause button | Pause button |
| Start / retry | Space or Enter | Tap PLAY / PLAY AGAIN |

Settings (pause menu, or the sliders button on the title): haptics, reduce
motion (follows the OS setting by default), colour assist (stronger
colour-blind glyphs). The renderer drops to a low-FX tier automatically if the
first 120 gameplay frames average over 20ms. To compare with the plain
renderer, point `activeRenderer` in `src/render/index.ts` at `basicRenderer`.

## Project structure

```
App.tsx, index.ts           Expo entry (gesture + safe-area providers)
src/game/                   Framework-free engine: types, constants, hex grid,
                            physics, animation, GameEngine, useGameEngine hook
src/input/                  Pointer / touch / keyboard -> engine commands
src/render/                 Renderer contract, layout fitting, basic RN renderer
src/render/skia/            2.5D Skia renderer: scene, background, board frame,
                            bomb sprites, cannon, aim guide, fx/ (pools, events)
src/ui/                     HUD, title screen (+ title/ Skia logo scene), end
                            card, pause menu, first-run hint, theme tokens
src/storage/settings.ts     Settings + reduce-motion store, tutorial flag
src/storage/bestScore.ts    Best score (AsyncStorage; localStorage on web)
src/fx/haptics.ts           expo-haptics wrapper (no-op on web)
```

The engine works in logical board units and knows nothing about React or the
platform. A renderer implements `BoardRenderer` (`src/render/BoardRenderer.ts`)
and is selected in `src/render/index.ts`.
