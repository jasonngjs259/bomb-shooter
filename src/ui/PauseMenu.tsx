// Pause / settings card: Resume, Restart, Menu (in game) and the Haptics,
// Reduce motion and Colour assist toggles (persisted in settings).

import { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { reduceMotion, updateSettings, useSettings } from "./settings";
import { fonts, palette, spacing } from "./theme";

interface Props {
  title: string;
  onResume: () => void;
  onRestart?: () => void;
  onMenu?: () => void;
  children?: ReactNode; // extra mode-specific settings rows
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

export function PauseMenu({ title, onResume, onRestart, onMenu, children }: Props) {
  const s = useSettings();
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Button label={onRestart ? "Resume" : "Done"} size="lg" onPress={onResume} />
        {onRestart && <Button label="Restart" size="md" variant="secondary" onPress={onRestart} />}
        {onMenu && <Button label="Menu" size="md" variant="secondary" onPress={onMenu} />}
        <View style={styles.toggles}>
          {Platform.OS !== "web" && (
            <Toggle label="HAPTICS" value={s.haptics} onChange={(v) => updateSettings({ haptics: v })} />
          )}
          <Toggle
            label="REDUCE MOTION"
            value={reduceMotion(s)}
            onChange={(v) => updateSettings({ reduceMotionOverride: v })}
          />
          <Toggle label="COLOUR ASSIST" value={s.colourAssist} onChange={(v) => updateSettings({ colourAssist: v })} />
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: 320,
    maxWidth: "92%",
    padding: spacing.xl,
    borderRadius: 24,
    backgroundColor: palette.panelSolid,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    alignItems: "center",
    gap: spacing.md,
  },
  title: { fontFamily: fonts.title, fontSize: 30, color: palette.textPrimary, marginBottom: spacing.sm },
  toggles: { alignSelf: "stretch", marginTop: spacing.sm, gap: 4 },
  toggleRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", cursor: "pointer" },
  toggleLabel: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textSecondary },
  track: { width: 46, height: 26, borderRadius: 13, backgroundColor: "#2A1F52", padding: 3 },
  trackOn: { backgroundColor: palette.cyan },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.textSecondary },
  knobOn: { backgroundColor: palette.ink, transform: [{ translateX: 20 }] },
});
