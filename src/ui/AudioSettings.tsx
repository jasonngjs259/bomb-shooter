// Pause / settings rows for audio: MUSIC and SFX toggles side by side and a
// master VOLUME slider (tap or drag the track; − / + step 10%; screen readers
// get an adjustable control). Persisted in bs.settings (music, sfx, volume).

import { useRef, useState } from "react";
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../audio";
import { updateSettings, useSettings } from "./settings";
import { fonts, palette } from "./theme";

const STEP = 0.1;
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

function MiniToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => {
        onChange(!value);
        uiSound("click");
      }}
      style={styles.mini}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

export function AudioSettings() {
  const s = useSettings();
  const width = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? s.volume;
  const set = (v: number, persist: boolean) => updateSettings({ volume: clamp(v) }, persist);
  const fromTouch = (e: GestureResponderEvent) => clamp(e.nativeEvent.locationX / Math.max(1, width.current));
  const onLayout = (e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width);
  return (
    <>
      <View style={styles.row}>
        <MiniToggle label="MUSIC" value={s.music} onChange={(v) => updateSettings({ music: v })} />
        <MiniToggle label="SFX" value={s.sfx} onChange={(v) => updateSettings({ sfx: v })} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>VOLUME</Text>
        <View style={styles.slider}>
          <Pressable accessibilityRole="button" accessibilityLabel="Lower volume" hitSlop={6} onPress={() => set(s.volume - STEP, true)} style={styles.step}>
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Volume"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => set(s.volume + (e.nativeEvent.actionName === "increment" ? STEP : -STEP), true)}
            onLayout={onLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(e) => setDrag(fromTouch(e))}
            onResponderMove={(e) => setDrag(fromTouch(e))}
            onResponderRelease={(e) => {
              set(fromTouch(e), true);
              setDrag(null);
              uiSound("click");
            }}
            onResponderTerminate={() => setDrag(null)}
            style={styles.bar}
          >
            <View pointerEvents="none" style={styles.barBg}>
              <View style={[styles.barFill, { width: `${Math.round(value * 100)}%` }]} />
            </View>
            <View pointerEvents="none" style={[styles.thumb, { left: `${Math.round(value * 100)}%` }]} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Raise volume" hitSlop={6} onPress={() => set(s.volume + STEP, true)} style={styles.step}>
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  mini: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", cursor: "pointer" },
  label: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textSecondary },
  track: { width: 46, height: 26, borderRadius: 13, backgroundColor: "#2A1F52", padding: 3 },
  trackOn: { backgroundColor: palette.cyan },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.textSecondary },
  knobOn: { backgroundColor: palette.ink, transform: [{ translateX: 20 }] },
  slider: { flex: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  step: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: palette.cyan, alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  stepText: { fontFamily: fonts.button, fontSize: 16, color: palette.cyan, lineHeight: 18 },
  bar: { flex: 1, height: 36, justifyContent: "center", cursor: "pointer" },
  barBg: { height: 6, borderRadius: 3, backgroundColor: "#2A1F52", overflow: "hidden" },
  barFill: { height: 6, backgroundColor: palette.cyan },
  thumb: {
    position: "absolute", width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: palette.textPrimary,
    borderWidth: 2, borderColor: palette.cyan,
  },
});
