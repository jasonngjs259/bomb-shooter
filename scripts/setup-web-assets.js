#!/usr/bin/env node
// postinstall: copy web-only static assets into public/ (served at "/"):
//   - Skia's CanvasKit WASM (via `setup-skia-web public`, run separately)
//   - the Orbitron 900 TTF, so the pre-boot HTML splash uses the same
//     typeface as the in-app logo before any JS has loaded.
const fs = require("fs");
const path = require("path");

const src = require.resolve("@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf");
const dest = path.join(__dirname, "..", "public", "fonts", "Orbitron_900Black.ttf");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`› Copied splash font to ${path.relative(process.cwd(), dest)}`);
