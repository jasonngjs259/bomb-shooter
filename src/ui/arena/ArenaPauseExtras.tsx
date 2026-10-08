// Arena-only rows for the pause / settings card: mouse-look sensitivity
// (desktop, 0.0010-0.0060 rad/px in 0.0004 steps) and the touch aim assist.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { Toggle } from "../PauseMenu";
import { SENSITIVITY_MAX, SENSITIVITY_MIN, updateSettings, useSettings } from "../settings";
import { fonts, palette } from "../theme";

const STEP = 0.0004;

export function ArenaPauseExtras({ desktop }: { desktop: boolean }) {
  const s = useSettings();
  if (!desktop) {
    return <Toggle label="AIM ASSIST" value={s.aimAssist} onChange={(v) => updateSettings({ aimAssist: v })} />;
  }
  const set = (v: number) => updateSettings({ mouseSensitivity: Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v)) });
  const pct = Math.round(((s.mouseSensitivity - SENSITIVITY_MIN) / (SENSITIVITY_MAX - SENSITIVITY_MIN)) * 100);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>MOUSE SPEED</Text>
      <View style={styles.stepper}>
        <Pressable accessibilityRole="button" accessibilityLabel="Lower mouse speed" onPress={() => set(s.mouseSensitivity - STEP)} style={styles.btn}>
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.value}>{pct}%</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Raise mouse speed" onPress={() => set(s.mouseSensitivity + STEP)} style={styles.btn}>
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textSecondary },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: palette.cyan, alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  btnText: { fontFamily: fonts.button, fontSize: 18, color: palette.cyan, lineHeight: 20 },
  value: { width: 44, textAlign: "center", fontFamily: fonts.score, fontSize: 13, color: palette.textPrimary },
});
