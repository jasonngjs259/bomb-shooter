// Full-screen colour fade above everything (canvas, HUD, side panels), used
// for the title -> game transition: a white flash fading out after the
// detonation, or a gentle dark cross-fade under reduced motion.

import { ReactNode, useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

export interface ScreenFade {
  cover: (color: string, ms: number) => void; // fade the colour in
  reveal: (color: string, ms: number) => void; // start opaque, fade out
  node: ReactNode;
}

export function useScreenFade(): ScreenFade {
  const opacity = useSharedValue(0);
  const [color, setColor] = useState("#FFFFFF");
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const cover = useCallback(
    (c: string, ms: number) => {
      setColor(c);
      opacity.value = withTiming(1, { duration: ms });
    },
    [opacity]
  );
  const reveal = useCallback(
    (c: string, ms: number) => {
      setColor(c);
      opacity.value = 1;
      opacity.value = withTiming(0, { duration: ms });
    },
    [opacity]
  );

  const node = <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />;
  return { cover, reveal, node };
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" },
});
