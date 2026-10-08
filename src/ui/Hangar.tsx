// HANGAR (fun-pass spec section 3 / 6), opened from the title: tabs
// STYLE | LEVELS and a 44pt Back.
//  STYLE: TRIM / CANNON / PLATES rows of 56pt swatches (12pt gaps); locked
//    ones at 50% with a lock and the requirement ("★ 10" / "BOSS Mk I").
//    Tapping an owned swatch equips it (persisted); any swatch previews on
//    the 2D astronaut silhouette (the live 3D preview is a renderer task).
//  LEVELS: a 5-column grid of 72pt cards (LV n, 3 small stars, B on boss
//    levels) up to the furthest level reached; tapping one starts Arena at
//    that level from score 0. Levels beyond maxLevel are locked.

import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../audio";
import {
  bossMkOfLevel, itemsForSlot, requirementLabel, SKIN_SLOTS, SkinItem, skinItem, SkinSlot, skinColors,
} from "../game/arena/skins";
import { equip, isOwned, STAR_CLEAR, STAR_FAST, STAR_FLAWLESS } from "../storage/arenaProgress";
import { updateProgress, useProgress } from "../storage/progressStore";
import { LockGlyph, StarGlyph } from "./arena/funGlyphs";
import { BOMB_HEX, fonts, palette } from "./theme";

type Tab = "style" | "levels";
const SWATCH = 56;
const CARD = 72;
const MAX_STARS_L1_9 = 27;
const SLOT_LABEL: Record<SkinSlot, string> = { trim: "TRIM", cannon: "CANNON", plates: "PLATES" };
const PRISM_HUES = BOMB_HEX.map((b) => b.base);

interface Props {
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  onBack: () => void;
  onStartLevel: (level: number) => void;
}

// 2D astronaut silhouette tinted with the skin (helmet, visor, trim, plates, cannon).
function Silhouette({ trim, cannon, plates, size }: { trim: string; cannon: string; plates: string; size: number }) {
  const u = size / 100;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Skin preview">
      {/* legs */}
      <View style={[styles.abs, { left: 34 * u, top: 70 * u, width: 12 * u, height: 26 * u, borderRadius: 4 * u, backgroundColor: plates }]} />
      <View style={[styles.abs, { left: 52 * u, top: 70 * u, width: 12 * u, height: 26 * u, borderRadius: 4 * u, backgroundColor: plates }]} />
      {/* torso: suit + plates + trim stripe */}
      <View style={[styles.abs, { left: 28 * u, top: 38 * u, width: 42 * u, height: 36 * u, borderRadius: 10 * u, backgroundColor: "#1E1640" }]} />
      <View style={[styles.abs, { left: 32 * u, top: 41 * u, width: 34 * u, height: 22 * u, borderRadius: 8 * u, backgroundColor: plates }]} />
      <View style={[styles.abs, { left: 28 * u, top: 64 * u, width: 42 * u, height: 4 * u, backgroundColor: trim }]} />
      {/* helmet + visor + trim ring */}
      <View style={[styles.abs, { left: 31 * u, top: 6 * u, width: 36 * u, height: 36 * u, borderRadius: 18 * u, backgroundColor: plates, borderWidth: 3 * u, borderColor: trim }]} />
      <View style={[styles.abs, { left: 39 * u, top: 15 * u, width: 22 * u, height: 14 * u, borderRadius: 7 * u, backgroundColor: palette.magenta }]} />
      {/* arm + cannon */}
      <View style={[styles.abs, { left: 64 * u, top: 44 * u, width: 12 * u, height: 12 * u, borderRadius: 6 * u, backgroundColor: plates }]} />
      <View style={[styles.abs, { left: 66 * u, top: 40 * u, width: 30 * u, height: 14 * u, borderRadius: 4 * u, backgroundColor: cannon, borderWidth: 1.5 * u, borderColor: "rgba(255,255,255,0.35)" }]} />
      <View style={[styles.abs, { left: 72 * u, top: 44 * u, width: 18 * u, height: 3 * u, backgroundColor: trim, opacity: 0.85 }]} />
      <View style={[styles.abs, { left: 93 * u, top: 41 * u, width: 6 * u, height: 12 * u, borderRadius: 3 * u, backgroundColor: palette.cyan }]} />
    </View>
  );
}

function Swatch({ item, owned, equipped, selected, onPress }: { item: SkinItem; owned: boolean; equipped: boolean; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${owned ? (equipped ? ", equipped" : "") : `, locked, needs ${requirementLabel(item.req)}`}`}
      accessibilityState={{ selected: equipped, disabled: !owned }}
      onPress={onPress}
      style={({ pressed }) => [styles.swatchHit, pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <View style={[styles.swatch, { backgroundColor: item.hex }, !owned && styles.locked, equipped && styles.equipped, selected && !equipped && styles.selected]}>
        {item.prism && (
          <View style={styles.prismRow}>
            {PRISM_HUES.map((c) => (
              <View key={c} style={{ flex: 1, backgroundColor: c }} />
            ))}
          </View>
        )}
        {!owned && (
          <View style={styles.lockOverlay}>
            <LockGlyph size={16} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Text style={[styles.swatchLabel, !owned && { color: palette.textMuted }]} numberOfLines={1}>
        {owned ? item.name.toUpperCase() : requirementLabel(item.req)}
      </Text>
    </Pressable>
  );
}

export function Hangar({ width, height, topInset, bottomInset, onBack, onStartLevel }: Props) {
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>("style");
  const [preview, setPreview] = useState<Record<SkinSlot, string>>(() => ({ ...progress.equipped }));
  const [note, setNote] = useState<string | null>(null);
  const [hue, setHue] = useState(0);
  const wide = width >= 640;
  const prism = skinItem(preview.trim)?.prism === true;

  // Prism preview: trim + cannon step through the bomb hues (4 s cycle)
  useEffect(() => {
    if (!prism) return;
    const id = setInterval(() => setHue((h) => (h + 1) % PRISM_HUES.length), 4000 / PRISM_HUES.length);
    return () => clearInterval(id);
  }, [prism]);

  // Esc / Backspace = Back (web)
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "Backspace") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const colors = skinColors(preview as { trim: string; cannon: string; plates: string });
  const trim = prism ? PRISM_HUES[hue] : colors.trim;
  const cannon = prism ? PRISM_HUES[(hue + 3) % PRISM_HUES.length] : colors.cannon;

  const pick = (item: SkinItem) => {
    setPreview((p) => ({ ...p, [item.slot]: item.id }));
    if (isOwned(progress, item.id)) {
      uiSound("click");
      updateProgress((p) => equip(p, item.id));
      setNote(`${SLOT_LABEL[item.slot]} ${item.name.toUpperCase()} EQUIPPED`);
    } else {
      uiSound("back");
      const req = item.req && "stars" in item.req ? `${item.req.stars} STARS (YOU HAVE ${progress.totalStars})` : `BEAT ${requirementLabel(item.req)}`;
      setNote(`LOCKED: ${req}`);
    }
  };

  const levelCount = Math.max(10, Math.ceil((progress.maxLevel + 1) / 5) * 5);
  const levels = useMemo(() => Array.from({ length: levelCount }, (_, i) => i + 1), [levelCount]);

  const tabBtn = (t: Tab, label: string) => (
    <Pressable
      key={t}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === t }}
      onPress={() => {
        uiSound("click");
        setTab(t);
      }}
      style={[styles.tab, tab === t && styles.tabOn]}
    >
      <Text style={[styles.tabText, tab === t && { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { paddingTop: topInset + 12, paddingBottom: bottomInset + 12 }]}>
      <View style={[styles.card, { width: Math.min(760, width - 24), maxHeight: height - topInset - bottomInset - 24 }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => { uiSound("back"); onBack(); }} style={styles.back}>
            <Text style={styles.backText}>‹ BACK</Text>
          </Pressable>
          <Text style={styles.title}>HANGAR</Text>
          <View style={styles.starTotal} accessibilityLabel={`${progress.totalStars} stars`}>
            <StarGlyph size={16} on />
            <Text style={styles.starTotalText}>{progress.totalStars}/{MAX_STARS_L1_9}</Text>
          </View>
        </View>
        <View style={styles.tabs}>
          {tabBtn("style", "STYLE")}
          {tabBtn("levels", "LEVELS")}
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {tab === "style" ? (
            <View style={[styles.styleBody, wide && { flexDirection: "row" }]}>
              <View style={[styles.preview, wide ? { width: 200 } : { alignSelf: "center" }]}>
                <Silhouette trim={trim} cannon={cannon} plates={colors.plates} size={wide ? 180 : 140} />
                <Text style={styles.note} numberOfLines={2}>{note ?? "TAP A SWATCH TO EQUIP"}</Text>
              </View>
              <View style={{ flex: 1, gap: 12 }}>
                {SKIN_SLOTS.map((slot) => (
                  <View key={slot}>
                    <Text style={styles.rowLabel}>{SLOT_LABEL[slot]}</Text>
                    <View style={styles.swatches}>
                      {itemsForSlot(slot).map((it) => (
                        <Swatch
                          key={it.id} item={it} owned={isOwned(progress, it.id)} equipped={progress.equipped[slot] === it.id}
                          selected={preview[slot] === it.id} onPress={() => pick(it)}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.grid}>
              {levels.map((n) => {
                const rec = progress.levels[n];
                const open = n <= progress.maxLevel;
                const boss = bossMkOfLevel(n) > 0;
                const bits = rec?.stars ?? 0;
                return (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={open ? `Play level ${n}${boss ? ", boss" : ""}` : `Level ${n} locked`}
                    disabled={!open}
                    onPress={() => {
                      uiSound("click");
                      onStartLevel(n);
                    }}
                    style={({ pressed }) => [styles.levelCard, !open && styles.levelLocked, boss && open && styles.levelBoss, pressed && { transform: [{ scale: 0.95 }] }]}
                  >
                    <Text style={styles.levelText}>LV {n}</Text>
                    {open ? (
                      <View style={styles.levelStars}>
                        <StarGlyph size={13} on={(bits & STAR_CLEAR) !== 0} />
                        <StarGlyph size={13} on={(bits & STAR_FAST) !== 0} />
                        <StarGlyph size={13} on={(bits & STAR_FLAWLESS) !== 0} />
                      </View>
                    ) : (
                      <LockGlyph size={14} color={palette.textMuted} />
                    )}
                    {boss && (
                      <View style={styles.bBadge}>
                        <Text style={styles.bText}>B</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  card: { padding: 16, borderRadius: 24, backgroundColor: palette.panelSolid, borderWidth: 1.5, borderColor: palette.panelBorder, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { minWidth: 88, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: palette.cyan, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  backText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 1.4, color: palette.textPrimary },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 2, color: palette.textPrimary },
  starTotal: { minWidth: 88, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  starTotalText: { fontFamily: fonts.score, fontSize: 14, color: palette.gold },
  tabs: { flexDirection: "row", gap: 8, alignSelf: "center" },
  tab: { minWidth: 120, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: palette.cyan, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  tabOn: { backgroundColor: palette.cyan },
  tabText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 1.6, color: palette.textPrimary },
  styleBody: { gap: 16 },
  preview: { alignItems: "center", gap: 8 },
  note: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.2, color: palette.textSecondary, textAlign: "center", maxWidth: 220 },
  rowLabel: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.8, color: palette.textSecondary, marginBottom: 6 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatchHit: { width: SWATCH, alignItems: "center", gap: 4, cursor: "pointer" },
  swatch: {
    width: SWATCH, height: SWATCH, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.25)", overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },
  prismRow: { ...StyleSheet.absoluteFill, flexDirection: "row" },
  locked: { opacity: 0.5 },
  equipped: { borderColor: palette.gold, borderWidth: 3 },
  selected: { borderColor: palette.textPrimary },
  lockOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,2,15,0.35)" },
  swatchLabel: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 0.6, color: palette.textSecondary, maxWidth: SWATCH + 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 5 * CARD + 4 * 10, alignSelf: "center" },
  levelCard: {
    width: CARD, height: CARD, borderRadius: 14, borderWidth: 1.5, borderColor: palette.panelBorder, backgroundColor: "rgba(11,4,32,0.6)",
    alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer",
  },
  levelBoss: { borderColor: palette.danger },
  levelLocked: { opacity: 0.45 },
  levelText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 1, color: palette.textPrimary },
  levelStars: { flexDirection: "row", gap: 1 },
  bBadge: {
    position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: palette.danger,
    alignItems: "center", justifyContent: "center",
  },
  bText: { fontFamily: fonts.button, fontSize: 10, color: "#FFFFFF" },
});
