// Arena 360 GL canvas: the shared GameCanvas (context-loss handling, tone
// mapping) inside the GL error boundary, with one priority-1 frame callback
// that runs the whole game step, renders the world and then the radar into
// a scissored viewport. On native R3F's patched gl.render() presents the
// frame (endFrameEXP), so the main pass uses the unpatched prototype render
// and only the last pass presents.

import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect } from "react";
import { PerspectiveCamera, WebGLRenderer } from "three";
import { useSettings } from "../../ui/settings";
import { rendererStatus, useRendererStatus } from "../status";
import { GameCanvas } from "../three/GameCanvas";
import { GLErrorBoundary } from "../three/GLErrorBoundary";
import { ArenaWorld } from "./ArenaWorld";

function ArenaScene({ world }: { world: ArenaWorld }) {
  const size = useThree((s) => s.size);
  const setDpr = useThree((s) => s.setDpr);
  const quality = useSettings().quality;
  useEffect(() => world.setSize(size.width, size.height), [world, size.width, size.height]);
  useEffect(() => {
    if (quality === "low") setDpr(1); // spec: low tier renders at dpr 1
  }, [quality, setDpr]);

  useFrame((state, delta) => {
    const { gl, scene } = state;
    const camera = state.camera as PerspectiveCamera;
    world.frame(camera, delta, state.viewport.dpr);
    const r = world.radarRect;
    gl.autoClear = true;
    if (!r) {
      gl.render(scene, camera);
      return;
    }
    WebGLRenderer.prototype.render.call(gl, scene, camera);
    const y = state.size.height - r.y - r.size;
    gl.autoClear = false;
    gl.clearDepth();
    gl.setViewport(r.x, y, r.size, r.size);
    gl.setScissor(r.x, y, r.size, r.size);
    gl.setScissorTest(true);
    gl.render(world.radar.scene, world.radar.camera);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, state.size.width, state.size.height);
    gl.autoClear = true;
  }, 1);

  return <primitive object={world.root} />;
}

export const ArenaCanvas = memo(function ArenaCanvas({ world }: { world: ArenaWorld }) {
  const { epoch, restoring } = useRendererStatus();
  return (
    <GLErrorBoundary onError={rendererStatus.failed}>
      <GameCanvas
        key={epoch}
        onContextLost={rendererStatus.contextLost}
        onContextRestored={rendererStatus.contextRestored}
        hidden={restoring}
      >
        <ArenaScene world={world} />
      </GameCanvas>
    </GLErrorBoundary>
  );
});
