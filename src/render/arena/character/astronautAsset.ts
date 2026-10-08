// The bundled character model (Quaternius "Astronaut", CC0; see README
// Credits). Bytes are read once per app run and parsed per Arena session.

import astronautGlb from "../../../assets/models/astronaut.glb";
import { glbBytes } from "./glbBytes";

let bytes: Promise<ArrayBuffer> | null = null;

export function astronautBytes(): Promise<ArrayBuffer> {
  if (!bytes) {
    bytes = glbBytes(astronautGlb).catch((e: unknown) => {
      bytes = null; // let a later session retry
      throw e;
    });
  }
  return bytes;
}
