// Web boot: Skia renders through CanvasKit (WebAssembly), which must be
// loaded before any module that touches Skia is evaluated. So the app is
// imported only after LoadSkiaWeb() resolves. canvaskit.wasm is served from
// /public (copied by `npx setup-skia-web public`, run on postinstall).
import type { ComponentType } from "react";
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

export function boot(register: (component: ComponentType) => void) {
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` })
    .then(() => import("../App"))
    .then((mod) => register(mod.default))
    .catch((error: unknown) => {
      console.error("Failed to start Skia (CanvasKit)", error);
    });
}
