// Native-runtime shims, evaluated before every other module (index.ts imports
// this first, and this file imports nothing, so ES import hoisting can't run
// anything ahead of it). Belt and braces only: metro.config.js keeps Node-only
// builds (three's build/three.cjs) out of the bundle, and
// scripts/check-native-bundle.mjs guards that. Metro's prelude defines
// `process` as `{ env }` on React Native, so Node's emitWarning on process (used
// at load time by some CJS builds) would be "undefined is not a function".

type ProcessLike = { env?: Record<string, string | undefined>; emitWarning?: (...args: unknown[]) => void };
const g = globalThis as unknown as { process?: ProcessLike };
if (g.process && typeof g.process.emitWarning !== "function") {
  g.process.emitWarning = (...args: unknown[]) => {
    if (typeof console !== "undefined") console.warn(...args);
  };
}

export {};
