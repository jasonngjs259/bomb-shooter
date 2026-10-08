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

## Project structure

```
App.tsx, index.ts           Expo entry (gesture + safe-area providers)
src/game/                   Framework-free engine: types, constants, hex grid,
                            physics, animation, GameEngine, useGameEngine hook
src/input/                  Pointer / touch / keyboard -> engine commands
src/render/                 Renderer contract, layout fitting, basic RN renderer
src/ui/                     HUD, title screen, game-over overlay, theme tokens
src/storage/bestScore.ts    Best score (AsyncStorage; localStorage on web)
src/fx/haptics.ts           expo-haptics wrapper (no-op on web)
```

The engine works in logical board units and knows nothing about React or the
platform. A renderer implements `BoardRenderer` (`src/render/BoardRenderer.ts`)
and is selected in `src/render/index.ts`.
