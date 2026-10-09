// Arena-only rows for the pause / settings card: TIPS (one-time feature
// tips + the L5 roller lesson), mouse-look sensitivity (desktop, 0.0010-0.0060
// rad/px in 0.0004 steps) and the ROLL KEY (desktop, every level: SPACE, or
// SHIFT which keeps Space = fire; applies immediately), or the touch aim assist.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../../audio";
import { Toggle } from "../PauseMenu";
import { SENSITIVITY_MAX, SENSITIVITY_MIN, updateSettings, useSettings } from "../settings";
import { fonts, palette } from "../theme";

const STEP = 0.0004;

export function ArenaPauseExtras({ desktop }: { desktop: boolean }) {
  const s = useSettings();
  const tips = <Toggle label="TIPS" value={s.tips} onChange={(v) => updateSettings({ tips: v })} />;
  if (!desktop) {
    return (
      <>
        {tips}
        <Toggle label="AIM ASSIST" value={s.aimAssist} onChange={(v) => updateSettings({ aimAssist: v })} />
      </>
    );
  }
  const set = (v: number) => updateSettings({ mouseSensitivity: Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v)) });
  const pct = Math.round(((s.mouseSensitivity - SENSITIVITY_MIN) / (SENSITIVITY_MAX - SENSITIVITY_MIN)) * 100);
  const shift = s.rollKey === "shift";
  return (
    <>
    {tips}
    <View style={styles.row}>
      <Text style={styles.label}>ROLL KEY</Text>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {(["space", "shift"] as const).map((k) => {
          const on = s.rollKey === k;
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Roll with ${k === "space" ? "Space" : "Shift"}`}
              onPress={() => {
                if (on) return;
                uiSound("click");
                updateSettings({ rollKey: k }); // read live by the desktop controls: no restart
              }}
              style={[styles.segBtn, on && styles.segOn]}
            >
              <Text style={[styles.btnText, on && styles.segOnText]}>{k === "space" ? "SPACE" : "SHIFT"}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
    <Text style={styles.caption}>{shift ? "SHIFT ROLLS · SPACE / CLICK / F FIRE · X SWAPS" : "SPACE ROLLS · CLICK / F FIRE · SHIFT / X SWAP"}</Text>
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
    </>
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
  segment: { flexDirection: "row", borderRadius: 18, borderWidth: 1.5, borderColor: palette.cyan, overflow: "hidden" },
  segBtn: { minWidth: 64, height: 36, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  segOn: { backgroundColor: palette.cyan },
  segOnText: { color: palette.ink },
  caption: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1, color: palette.textMuted, marginTop: -4 },
  value: { width: 44, textAlign: "center", fontFamily: fonts.score, fontSize: 13, color: palette.textPrimary },
});
