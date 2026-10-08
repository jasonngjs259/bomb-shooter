// Web GL canvas (react-three-fiber DOM Canvas). The native build resolves
// GameCanvas.native.tsx instead. The canvas never takes pointer input: the
// gesture handler view underneath the whole board area owns input.

import { Canvas } from "@react-three/fiber";
import { ReactNode } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

export function GameCanvas({ children }: { children: ReactNode }) {
  return (
    <Canvas
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 30, near: 1, far: 5000, position: [0, 0, 1000] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        gl.outputColorSpace = SRGBColorSpace;
        gl.setClearColor("#0B0420", 1);
      }}
    >
      {children}
    </Canvas>
  );
}
