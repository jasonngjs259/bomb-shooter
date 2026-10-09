// Metro: bundle .glb models (the Arena character) as assets, and resolve
// `three` to its ESM build on every platform.
//
// Why: three's package exports map `require("three")` to build/three.cjs,
// which runs `process.emitWarning(...)` at module load (a deprecation
// notice). React Native / Hermes has no process.emitWarning, so the app died
// at startup in Expo Go ("[runtime not ready]: TypeError: undefined is not a
// function") as soon as @react-three/fiber/native did `require("three")`.
// Web never saw it (the "import" condition picks three.module.js). Pinning
// the bare specifier to build/three.module.js gives every importer - R3F
// (CJS require), our code and three/addons/* (ESM import) - the same single
// three instance, with no Node-only code. scripts/check-native-bundle.mjs
// guards it.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("glb");

// (three exports no ./package.json; resolve the CJS entry and take its build/ dir)
const THREE_ESM = path.join(path.dirname(require.resolve("three")), "three.module.js");
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") return { type: "sourceFile", filePath: THREE_ESM };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
