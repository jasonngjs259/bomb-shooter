// Inside the R3F canvas: mounts the imperative world and drives it from a
// single useFrame. Drops to dpr 1 on the low quality tier (web; expo-gl
// always renders at native resolution).

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { PerspectiveCamera } from "three";
import { useSettings } from "../../ui/settings";
import { GameWorld } from "./world/GameWorld";

export function SceneRoot({ world }: { world: GameWorld }) {
  const setDpr = useThree((s) => s.setDpr);
  const quality = useSettings().quality;
  useEffect(() => {
    if (quality === "low") setDpr(1);
  }, [quality, setDpr]);

  useFrame((state, delta) => {
    world.frame(state.camera as PerspectiveCamera, state.viewport.dpr, delta);
  });
  return <primitive object={world.root} />;
}
