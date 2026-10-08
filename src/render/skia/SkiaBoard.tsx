// The Skia renderer component: ONE full-screen Canvas showing a single
// SkPicture held in a Reanimated shared value. NeonScene records a new
// picture right after every engine step (SimClock frame listener), so the
// canvas animates at display rate without any React re-render.

import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { Canvas, Picture, Skia, SkPicture } from "@shopify/react-native-skia";
import { BoardRendererProps } from "../BoardRenderer";
import { loadSkiaFonts } from "./fonts";
import { NeonScene } from "./scene";

const emptyPicture = (): SkPicture => {
  const rec = Skia.PictureRecorder();
  rec.beginRecording({ x: 0, y: 0, width: 1, height: 1 });
  return rec.finishRecordingAsPicture();
};

export default function SkiaBoard({ engine, layout, showAimGuide, clock }: BoardRendererProps) {
  const sceneRef = useRef<NeonScene | null>(null);
  if (sceneRef.current === null) sceneRef.current = new NeonScene(engine);
  const scene = sceneRef.current;
  const picture = useSharedValue<SkPicture>(useState(emptyPicture)[0]);

  useEffect(() => {
    void loadSkiaFonts();
    return () => scene.dispose();
  }, [scene]);

  useEffect(() => scene.setLayout(layout), [scene, layout]);

  useEffect(() => {
    scene.showAim = showAimGuide;
  }, [scene, showAimGuide]);

  useEffect(() => {
    scene.clock = clock;
    const draw = (realDt: number, simDt: number) => {
      const pic = scene.frame(realDt, simDt);
      if (pic) picture.value = pic;
    };
    if (clock) return clock.onFrame(draw);

    // No shared clock: run our own loop (FX then use real time)
    let handle = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.25);
      last = now;
      draw(dt, dt);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [scene, clock, picture]);

  return (
    <Canvas style={styles.fill}>
      <Picture picture={picture} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" },
});
