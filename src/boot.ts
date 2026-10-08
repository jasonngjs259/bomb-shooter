// Native boot: Skia is a native module, nothing to load first.
import type { ComponentType } from "react";
import App from "../App";

export function boot(register: (component: ComponentType) => void) {
  register(App);
}
