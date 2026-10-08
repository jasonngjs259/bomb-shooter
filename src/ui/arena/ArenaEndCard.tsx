// Arena 360 game-over / level-clear card (fun-pass spec section 6).
// Landscape: 2 columns (stats left, buttons right); portrait: stacked.
// Win: "LEVEL n CLEAR!", three 40pt stars (CLEAR / FAST / FLAWLESS) that
// punch in 0 -> 1.25 -> 1 over 260 ms, staggered 350 ms, with star_1/2/3;
// unearned stars are outlines with the reason. NEW BEST tags (score, combo,
// time), BEST COMBO, and a NEW UNLOCK row (1.2 s shine, EQUIP in place).
// Buttons (and Space/Enter, handled by the screen) arm 1.5 s after the card
// appears so a held fire key or a stray tap can't skip it.
// Bests are labelled by scope: NEW tags on SCORE / BEST COMBO / TIME and the
// LEVEL BEST row are this level's records; ALL-TIME BEST is the Arena best.

import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { audio, uiFunSounds } from "../../audio";
import type { SkinItem } from "../../game/arena/skins";
import { Button } from "../Button";
import { formatScore } from "../Hud";
import { fonts, palette } from "../theme";
import { textGlow } from "../webSafe";
import { fmtClock, StarGlyph } from "./funGlyphs";

const native = Platform.OS !== "web";
export const ARM_MS = 1500;
const STAR_STAGGER = 350;

export interface EndStars {
  clear: boolean;
  fast: boolean;
  flawless: boolean;
  time: number;
  par: number;
  bestCombo: number;
  newBest: { score: boolean; combo: boolean; time: boolean }; // vs. this LEVEL's records
  levelBest: number; // this level's best score (after this run)
}

interface Props {
  won: boolean;
  score: number;
  best: number;
  isNewBest: boolean;
  level: number;
  time: number;
  combo: number;
  stars: EndStars | null; // levelStars (wins only)
  unlocks: SkinItem[]; // newly unlocked by this result
  equipped: string[]; // equipped item ids
  still: boolean;
  landscape: boolean;
  armed: boolean;
  onRetry: () => void;
  onNext: () => void;
  onMenu: () => void;
  onEquip: (id: string) => void;
}

function Star({ on, label, reason, index, still }: { on: boolean; label: string; reason: string; index: number; still: boolean }) {
  const v = useRef(new Animated.Value(on && !still ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => uiFunSounds.star(audio, (index + 1) as 1 | 2 | 3), 300 + index * STAR_STAGGER);
    if (still) return () => clearTimeout(t);
    Animated.sequence([
      Animated.delay(300 + index * STAR_STAGGER),
      Animated.timing(v, { toValue: 1.25, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(v, { toValue: 1, duration: 90, useNativeDriver: native }),
    ]).start();
    return () => clearTimeout(t);
  }, [on, index, still, v]);
  return (
    <View style={styles.star} accessibilityLabel={`${label} ${on ? "earned" : "not earned"}`}>
      <Animated.View style={{ transform: [{ scale: v }] }}>
        <StarGlyph size={40} on={on} />
      </Animated.View>
      <Text style={[styles.starLabel, on && { color: palette.textPrimary }]}>{label}</Text>
      <Text style={styles.starReason} numberOfLines={1}>{reason}</Text>
    </View>
  );
}

function NewTag() {
  return (
    <View style={styles.newTag}>
      <Text style={styles.newTagText}>NEW</Text>
    </View>
  );
}

function UnlockRow({ item, equipped, onEquip, still }: { item: SkinItem; equipped: boolean; onEquip: () => void; still: boolean }) {
  const shine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => uiFunSounds.unlock(audio), 1400);
    if (!still) Animated.timing(shine, { toValue: 1, duration: 1200, delay: 1400, useNativeDriver: native }).start();
    return () => clearTimeout(t);
  }, [shine, still]);
  const x = shine.interpolate({ inputRange: [0, 1], outputRange: [-80, 260] });
  const slot = item.slot === "trim" ? "Trim" : item.slot === "cannon" ? "Cannon" : "Plates";
  return (
    <View style={styles.unlock}>
      {!still && <Animated.View style={[styles.shine, { transform: [{ translateX: x }, { rotate: "20deg" }] }]} />}
      <View style={[styles.swatch, { backgroundColor: item.hex }, item.prism && styles.prism]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.unlockKicker}>NEW UNLOCK</Text>
        <Text style={styles.unlockName} numberOfLines={1}>{slot} {item.name}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={equipped ? `${item.name} equipped` : `Equip ${item.name}`}
        disabled={equipped}
        onPress={onEquip}
        style={({ pressed }) => [styles.equip, equipped && styles.equipped, pressed && { opacity: 0.8 }]}
      >
        <Text style={[styles.equipText, equipped && { color: palette.textMuted }]}>{equipped ? "EQUIPPED" : "EQUIP"}</Text>
      </Pressable>
    </View>
  );
}

export function ArenaEndCard({
  won, score, best, isNewBest, level, time, combo, stars, unlocks, equipped, still, landscape, armed, onRetry, onNext, onMenu, onEquip,
}: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [fade]);
  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const title = won ? `LEVEL ${level} CLEAR!` : "GAME OVER";
  const titleColor = won ? palette.gold : palette.danger;
  const nb = stars?.newBest;
  const row = (label: string, value: string, tag = false, gold = false) => (
    <View style={styles.row} key={label}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {tag && <NewTag />}
        <Text style={[styles.rowValue, gold && { color: palette.gold }]}>{value}</Text>
      </View>
    </View>
  );
  const shownUnlocks = showAll ? unlocks : unlocks.slice(0, 1);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]}>
      <Animated.View style={[styles.card, landscape ? styles.cardWide : styles.cardTall, { transform: [{ translateY: rise }] }]}>
        <View style={landscape ? styles.colStats : styles.colFull}>
          <Text style={[styles.title, { color: titleColor }, textGlow(titleColor, 14)]}>{title}</Text>
          {won && stars && (
            <View style={styles.stars}>
              <Star index={0} on={stars.clear} label="CLEAR" reason="" still={still} />
              <Star index={1} on={stars.fast} label="FAST" reason={`${fmtClock(stars.time)} / ${fmtClock(stars.par)}`} still={still} />
              <Star index={2} on={stars.flawless} label="FLAWLESS" reason={stars.flawless ? "" : "NO HITS · NO RED"} still={still} />
            </View>
          )}
          {row("SCORE", formatScore(score), !!nb?.score)}
          {won && stars && row("LEVEL BEST", formatScore(Math.max(stars.levelBest, score)))}
          {row("ALL-TIME BEST", formatScore(Math.max(best, score)), isNewBest, true)}
          {row("BEST COMBO", `x${Math.max(1, stars?.bestCombo ?? combo)}`, !!nb?.combo)}
          {row("TIME", fmtClock(time), !!nb?.time && won)}
          {!won && row("LEVEL", String(level))}
        </View>
        <View style={[landscape ? styles.colButtons : styles.colFull, !armed && styles.disarmed]}>
          {won ? <Button label="Next level" size="md" onPress={onNext} /> : <Button label={`Retry level ${level}`} size="md" onPress={onRetry} />}
          {won && <Button label="Retry" size="md" variant="secondary" onPress={onRetry} />}
          <Button label="Menu" size="md" variant="secondary" onPress={onMenu} />
          {shownUnlocks.map((it) => (
            <UnlockRow key={it.id} item={it} equipped={equipped.includes(it.id)} onEquip={() => onEquip(it.id)} still={still} />
          ))}
          {unlocks.length > 1 && !showAll && (
            <Pressable accessibilityRole="button" onPress={() => setShowAll(true)} style={styles.more}>
              <Text style={styles.moreText}>+{unlocks.length - 1} MORE UNLOCKS</Text>
            </Pressable>
          )}
          {Platform.OS === "web" && <Text style={styles.hint}>{won ? "SPACE · NEXT LEVEL" : "SPACE · RETRY"}</Text>}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: 12 },
  card: { padding: 20, borderRadius: 24, backgroundColor: palette.panelSolid, borderWidth: 1.5, borderColor: palette.panelBorder, gap: 14 },
  cardWide: { width: 600, maxWidth: "96%", minHeight: 260, flexDirection: "row", alignItems: "center" },
  cardTall: { width: 340, maxWidth: "94%", alignItems: "stretch" },
  colStats: { flex: 1, gap: 5 },
  colButtons: { width: 260, alignItems: "center", gap: 9 },
  colFull: { alignItems: "center", gap: 7, alignSelf: "stretch" },
  disarmed: { opacity: 0.45, pointerEvents: "none" },
  title: { fontFamily: fonts.display, fontSize: 26, textAlign: "center", marginBottom: 2 },
  stars: { flexDirection: "row", justifyContent: "space-around", alignSelf: "stretch", marginBottom: 4 },
  star: { alignItems: "center", width: 96 },
  starLabel: { fontFamily: fonts.button, fontSize: 13, letterSpacing: 1.4, color: palette.textMuted },
  starReason: { fontFamily: fonts.label, fontSize: 12, color: palette.textMuted, minHeight: 15 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", alignSelf: "stretch" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowLabel: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.5, color: palette.textSecondary },
  rowValue: { fontFamily: fonts.score, fontSize: 17, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  newTag: { paddingHorizontal: 6, height: 18, borderRadius: 4, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  newTagText: { fontFamily: fonts.button, fontSize: 11, letterSpacing: 1, color: palette.ink },
  hint: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.5, color: palette.textMuted },
  unlock: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 14, overflow: "hidden",
    borderWidth: 1.5, borderColor: palette.gold, backgroundColor: "rgba(255, 210, 63, 0.08)",
  },
  shine: { position: "absolute", top: -20, bottom: -20, width: 36, backgroundColor: "rgba(255,255,255,0.18)" },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "#FFFFFF" },
  prism: { borderColor: palette.cyan, borderWidth: 3 },
  unlockKicker: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1.5, color: palette.gold },
  unlockName: { fontFamily: fonts.button, fontSize: 15, letterSpacing: 1, color: palette.textPrimary },
  equip: { minWidth: 84, height: 44, borderRadius: 22, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.gold, cursor: "pointer" },
  equipped: { backgroundColor: "transparent", borderWidth: 1, borderColor: palette.textMuted },
  equipText: { fontFamily: fonts.button, fontSize: 14, letterSpacing: 1.4, color: palette.ink },
  more: { minHeight: 32, justifyContent: "center" },
  moreText: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.4, color: palette.gold },
});
