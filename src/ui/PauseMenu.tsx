// Pause / settings card (spec 8.2): Resume, Restart, Menu plus toggles for
// Haptics, Reduce motion and Colour assist. From the title it is a plain
// settings card (no Restart / Menu).

import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ReduceMotionMode, settingsStore, useSettings } from "../storage/settings";
import { Button } from "./Button";
import { fonts, palette } from "./theme";

interface Props {
  mode: "pause" | "settings";
  onResume: () => void;
  onRestart?: () => void;
  onMenu?: () => void;
}

const MOTION_NEXT: Record<ReduceMotionMode, ReduceMotionMode> = { system: "on", on: "off", off: "system" };
const MOTION_LABEL: Record<ReduceMotionMode, string> = { system: "SYSTEM", on: "ON", off: "OFF" };

function Toggle({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const on = value !== "OFF";
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed, Platform.OS === "web" && styles.pointer]}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.pill, on ? styles.pillOn : styles.pillOff]}>
        <Text style={[styles.pillText, on && styles.pillTextOn]}>{value}</Text>
      </View>
    </Pressable>
  );
}

export function PauseMenu({ mode, onResume, onRestart, onMenu }: Props) {
  const { settings } = useSettings();
  const native = Platform.OS !== "web";
  return (
    <View style={styles.root}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onResume} />
      <View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.title} accessibilityRole="header">
          {mode === "pause" ? "PAUSED" : "SETTINGS"}
        </Text>
        <View style={styles.toggles}>
          {native && (
            <Toggle
              label="HAPTICS"
              value={settings.haptics ? "ON" : "OFF"}
              onPress={() => settingsStore.update({ haptics: !settings.haptics })}
            />
          )}
          <Toggle
            label="REDUCE MOTION"
            value={MOTION_LABEL[settings.reduceMotion]}
            onPress={() => settingsStore.update({ reduceMotion: MOTION_NEXT[settings.reduceMotion] })}
          />
          <Toggle
            label="COLOUR ASSIST"
            value={settings.colourAssist ? "ON" : "OFF"}
            onPress={() => settingsStore.update({ colourAssist: !settings.colourAssist })}
          />
        </View>
        <View style={styles.buttons}>
          <Button label={mode === "pause" ? "RESUME" : "DONE"} onPress={onResume} style={styles.full} />
          {onRestart && <Button label="RESTART" variant="secondary" onPress={onRestart} style={styles.full} />}
          {onMenu && <Button label="MENU" variant="secondary" onPress={onMenu} style={styles.full} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(7, 2, 15, 0.75)" },
  card: {
    width: 320,
    maxWidth: "90%",
    padding: 24,
    gap: 16,
    borderRadius: 24,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
  title: { fontFamily: fonts.title, fontSize: 30, color: palette.textPrimary, textAlign: "center", letterSpacing: 1 },
  toggles: { gap: 6 },
  toggleRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textPrimary },
  pill: { minWidth: 76, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  pillOn: { backgroundColor: "rgba(34, 242, 255, 0.15)", borderColor: palette.cyan },
  pillOff: { backgroundColor: "transparent", borderColor: palette.panelBorder },
  pillText: { fontFamily: fonts.button, fontSize: 14, letterSpacing: 1, color: palette.textSecondary },
  pillTextOn: { color: palette.cyan },
  buttons: { gap: 12 },
  full: { minWidth: 0, alignSelf: "stretch" },
  pressed: { opacity: 0.8 },
  pointer: { cursor: "pointer" },
});
