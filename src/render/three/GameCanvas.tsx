// Web GL canvas (react-three-fiber DOM Canvas). The native build resolves
// GameCanvas.native.tsx instead. The canvas never takes pointer input: the
// gesture handler view underneath the whole board area owns input.
//
// Context loss: the lost event is preventDefault()ed (so the browser may
// restore it) and reported; the owner remounts the canvas with a new key on
// restore. The listeners are removed in a layout-effect cleanup, which runs
// before R3F's own unmount calls forceContextLoss(), so our own teardown is
// never mistaken for a GPU reset.

import { Canvas } from "@react-three/fiber";
import { ReactNode, useLayoutEffect, useRef } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from "three";
import { WEBGL_ATTRIBUTES } from "../status/probe";

export interface GameCanvasProps {
  children: ReactNode;
  onContextLost: () => void;
  onContextRestored: () => void;
  // Keep the canvas mounted (so it can be restored) but invisible: a lost
  // context otherwise shows as a blank/broken canvas.
  hidden?: boolean;
}

// dpr capped at 1.5: a full-window 2x canvas with MSAA is ~4x the GPU memory
// of 1x, which integrated GPUs (shared memory) handle poorly.
const DPR: [number, number] = [1, 1.5];

export function GameCanvas({ children, onContextLost, onContextRestored, hidden = false }: GameCanvasProps) {
  const handlers = useRef({ onContextLost, onContextRestored });
  handlers.current = { onContextLost, onContextRestored };
  const detach = useRef<(() => void) | null>(null);
  useLayoutEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    []
  );

  const onCreated = ({ gl }: { gl: WebGLRenderer }) => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.1;
    gl.outputColorSpace = SRGBColorSpace;
    gl.setClearColor("#0B0420", 1);
    const canvas = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      handlers.current.onContextLost();
    };
    const restored = () => handlers.current.onContextRestored();
    detach.current?.();
    canvas.addEventListener("webglcontextlost", lost, false);
    canvas.addEventListener("webglcontextrestored", restored, false);
    detach.current = () => {
      canvas.removeEventListener("webglcontextlost", lost, false);
      canvas.removeEventListener("webglcontextrestored", restored, false);
    };
  };

  return (
    <Canvas
      style={{ position: "absolute", inset: 0, pointerEvents: "none", visibility: hidden ? "hidden" : "visible" }}
      dpr={DPR}
      gl={WEBGL_ATTRIBUTES}
      camera={{ fov: 30, near: 1, far: 5000, position: [0, 0, 1000] }}
      onCreated={onCreated}
    >
      {children}
    </Canvas>
  );
}
