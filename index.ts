import { registerRootComponent } from "expo";
import { boot } from "./src/boot";

// Sets up the app for Expo Go, native builds and web alike. On web, boot()
// first loads Skia's CanvasKit WASM (see src/boot.web.ts).
boot(registerRootComponent);
