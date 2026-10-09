// Pause / settings card: Resume, Restart, Menu (in game), the audio rows
// (Music, SFX, Volume) and the Haptics, Reduce motion and Colour assist
// toggles (persisted in settings). Scrolls when the screen is too short.

import { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../audio";
import { AudioSettings } from "./AudioSettings";
import { useFullscreen } from "./FullscreenButton";
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
      onPress={() => {
        uiSound("click");
        onChange(!value);
      }}
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
  const fs = useFullscreen(); // mobile web only (Classic, Arena and title Settings)
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Button label={onRestart ? "Resume" : "Done"} size="lg" sound="back" onPress={onResume} />
          {onRestart && <Button label="Restart" size="md" variant="secondary" onPress={onRestart} />}
          {onMenu && <Button label="Menu" size="md" variant="secondary" onPress={onMenu} />}
          <View style={styles.toggles}>
            {fs.offer && <Toggle label="FULL SCREEN" value={fs.active} onChange={() => fs.toggle()} />}
            <AudioSettings />
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  scroll: { flexGrow: 0, maxHeight: "100%", alignSelf: "stretch" },
  scrollContent: { alignItems: "center", paddingVertical: spacing.sm },
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
