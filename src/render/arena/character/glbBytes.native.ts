// Native (Expo Go): download the bundled asset to a local file with
// expo-asset, then read it with the SDK 57 expo-file-system File API.

import { Asset } from "expo-asset";
import { File } from "expo-file-system";

export async function glbBytes(mod: number): Promise<ArrayBuffer> {
  const [asset] = await Asset.loadAsync(mod);
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error("character model: no local uri");
  return new File(uri).arrayBuffer();
}
