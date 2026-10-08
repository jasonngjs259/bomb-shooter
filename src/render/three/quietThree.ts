// three r183+ warns "THREE.Clock: This module has been deprecated. Please use
// THREE.Timer instead." every time a Clock is constructed. Our code never
// uses THREE.Clock (game time comes from SimClock and R3F's frame delta),
// but @react-three/fiber 9.8.1 (the latest stable release) still creates one
// per canvas store. Drop exactly that one third-party message; every other
// three.js log / warning / error is forwarded unchanged.

import { setConsoleFunction } from "three";

const CLOCK_DEPRECATION = "Clock: This module has been deprecated";

setConsoleFunction((type, message, ...params) => {
  if (type === "warn" && typeof message === "string" && message.includes(CLOCK_DEPRECATION)) return;
  if (type === "error") console.error(message, ...params);
  else if (type === "warn") console.warn(message, ...params);
  else console.log(message, ...params);
});
