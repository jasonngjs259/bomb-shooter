// UI <-> renderer side channel, one per engine (getFxBus(engine)).
// The engine emits gameplay events; this bus carries presentation-only
// messages: renderer -> UI floating texts and flashes, UI -> renderer title
// commands. Plain data so any renderer can implement it.

import { TypedEmitter } from "../game/emitter";

export interface FxBusEvents {
  // Floating in-world text (board units). kind picks the style.
  floatText: { x: number; y: number; text: string; kind: "score" | "drop" | "combo"; combo?: number };
  // Full-screen colour flash (UI overlay), alpha 0..1, duration ms.
  screenFlash: { color: string; alpha: number; duration: number };
  // UI asks the renderer to detonate the title bomb; renderer answers titleDetonated.
  titleDetonate: Record<string, never>;
  titleDetonated: Record<string, never>;
  // Arena 360: big centred banner text ("SURGE!", "ARENA CLEAR!").
  banner: { text: string; color: string; duration: number };
}

const buses = new WeakMap<object, TypedEmitter<FxBusEvents>>();

export function getFxBus(owner: object): TypedEmitter<FxBusEvents> {
  let b = buses.get(owner);
  if (!b) {
    b = new TypedEmitter<FxBusEvents>();
    buses.set(owner, b);
  }
  return b;
}
