// Second Skia canvas, only mounted on the title screen: logo + bomb pile +
// detonation. Same pattern as the board: one SkPicture per frame in a
// shared value, driven by its own requestAnimationFrame loop.

import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { Canvas, Picture, Skia, SkPicture } from "@shopify/react-native-skia";
import { loadSkiaFonts } from "../../render/skia/fonts";
import { TitleScene } from "./titleScene";

interface Props {
  width: number;
  height: number;
  exiting: boolean;
  skip: number; // increments when the player taps to skip the intro
  reduced: boolean;
}

const blank = (): SkPicture => {
  const rec = Skia.PictureRecorder();
  rec.beginRecording({ x: 0, y: 0, width: 1, height: 1 });
  return rec.finishRecordingAsPicture();
};

export function TitleCanvas({ width, height, exiting, skip, reduced }: Props) {
  const sceneRef = useRef<TitleScene | null>(null);
  if (sceneRef.current === null) sceneRef.current = new TitleScene();
  const scene = sceneRef.current;
  const picture = useSharedValue<SkPicture>(useState(blank)[0]);

  useEffect(() => {
    void loadSkiaFonts();
  }, []);

  useEffect(() => {
    if (width > 0 && height > 0) scene.resize(width, height);
  }, [scene, width, height]);

  useEffect(() => {
    scene.reduced = reduced;
  }, [scene, reduced]);

  useEffect(() => {
    if (exiting) scene.exit();
  }, [scene, exiting]);

  useEffect(() => {
    if (skip > 0) scene.skipIntro();
  }, [scene, skip]);

  useEffect(() => {
    let handle = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      picture.value = scene.frame(dt);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [scene, picture]);

  return (
    <Canvas style={styles.fill}>
      <Picture picture={picture} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" },
});
