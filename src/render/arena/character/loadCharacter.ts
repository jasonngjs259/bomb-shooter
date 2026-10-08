// GLB bytes -> character asset (three's own GLTFLoader: no DRACO / meshopt
// decoders, which Expo Go can't run; the model ships uncompressed).

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CharacterAsset } from "./Character";

export async function parseCharacter(bytes: ArrayBuffer): Promise<CharacterAsset> {
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  return { scene: gltf.scene, animations: gltf.animations };
}
