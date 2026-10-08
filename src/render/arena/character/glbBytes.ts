// Web: read a bundled asset module (metro asset id) as bytes over fetch.
// Native goes through expo-file-system instead (glbBytes.native.ts).

import { Asset } from "expo-asset";

export async function glbBytes(mod: number): Promise<ArrayBuffer> {
  const res = await fetch(Asset.fromModule(mod).uri);
  if (!res.ok) throw new Error(`character model: HTTP ${res.status}`);
  return res.arrayBuffer();
}
