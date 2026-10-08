// Native GL canvas: react-three-fiber on expo-gl (bundled in Expo Go).
// Wrapped in a pointerEvents="none" view so R3F's PanResponder overlay never
// competes with the gesture handler on the board area.

import { Canvas } from "@react-three/fiber/native";
import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

export function GameCanvas({ children }: { children: ReactNode }) {
  return (
    <View style={styles.fill}>
      <Canvas
        style={StyleSheet.absoluteFill}
        gl={{ antialias: true, alpha: false }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
});
