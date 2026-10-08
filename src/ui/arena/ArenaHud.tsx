// Arena 360 HUD (spec section 7). Phone landscape / portrait fallback: a top
// bar of pills (SCORE + combo, LV, remaining with a progress ring, danger
// bar) next to the GL radar, pause on the right. Desktop: compact corner
// cards (score card top-left, radar + NEXT/DANGER chip top-right, one-line
// key legend bottom-left) so the ring stays visible. Values are polled at
// 10 Hz and only re-render on change.

import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ArenaEngine } from "../../game/arena";
import { IconButton } from "../Button";
import { padScore, formatScore } from "../Hud";
import { BOMB_HEX, fonts, palette } from "../theme";

export interface HudState {
  score: number; combo: number; level: number; remaining: number; total: number;
  danger: number; current: number; next: number;
}

export function useArenaHud(engine: ArenaEngine): HudState {
  const read = (total: number): HudState => ({
    score: engine.getScore(), combo: engine.getCombo(), level: engine.getLevel(),
    remaining: engine.getRemaining(), total: Math.max(total, engine.getRemaining()),
    danger: Math.round(engine.getDangerLevel() * 20) / 20, current: engine.getCurrentBomb(), next: engine.getNextBomb(),
  });
  const [s, setS] = useState(() => read(0));
  const ref = useRef(s);
  useEffect(() => {
    const offNew = engine.on("phaseChanged", ({ phase, previous }) => {
      if (phase === "playing" && previous !== "playing") ref.current = { ...ref.current, total: 0 };
    });
    const id = setInterval(() => {
      const n = read(ref.current.total);
      const p = ref.current;
      if ((Object.keys(n) as (keyof HudState)[]).some((k) => n[k] !== p[k])) {
        ref.current = n;
        setS(n);
      }
    }, 100);
    return () => {
      clearInterval(id);
      offNew();
    };
  }, [engine]);
  return s;
}

const dangerColor = (d: number) => (d >= 0.7 ? palette.danger : d >= 0.4 ? "#FF8A3D" : palette.gold);

function DangerBar({ d, width = 140 }: { d: number; width?: number }) {
  return (
    <View style={[styles.dangerTrack, { width }]} accessibilityLabel={`Danger ${Math.round(d * 100)} percent`}>
      <View style={[styles.dangerFill, { width: width * d, backgroundColor: dangerColor(d) }]} />
    </View>
  );
}

function Remaining({ n, total }: { n: number; total: number }) {
  const k = total > 0 ? 1 - n / total : 0;
  return (
    <View style={styles.row}>
      <View style={[styles.ring, { borderColor: k > 0.5 ? palette.gold : palette.panelBorder }]}>
        <View style={[styles.ringFill, { opacity: 0.25 + 0.75 * k }]} />
      </View>
      <Text style={styles.value}>{n}</Text>
      <Text style={styles.label}> LEFT</Text>
    </View>
  );
}

interface Props {
  hud: HudState;
  best: number;
  desktop: boolean;
  radarSize: number;
  left: number;
  top: number;
  width: number;
  onPause: () => void;
}

export const ArenaHud = memo(function ArenaHud({ hud, best, desktop, radarSize, left, top, width, onPause }: Props) {
  // "x3" repeats next to the score for 900 ms after a combo
  const [comboShown, setComboShown] = useState(0);
  useEffect(() => {
    if (hud.combo < 2) return;
    setComboShown(hud.combo);
    const id = setTimeout(() => setComboShown(0), 900);
    return () => clearTimeout(id);
  }, [hud.combo]);

  if (desktop) {
    // Compact corner HUD: the world (and the ring's left/right edges) stays
    // visible. Top-left: score card; top-right: radar (GL) + NEXT / DANGER
    // chip under it; bottom-left: one-line key legend.
    return (
      <>
        <View style={[styles.corner, { left: 16, top: 16 }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>SCORE</Text>
            {comboShown > 1 && <Text style={styles.comboSmall}>x{Math.min(comboShown, 5)}</Text>}
          </View>
          <Text style={[styles.score, { fontSize: 26 }]} numberOfLines={1}>{padScore(hud.score)}</Text>
          <View style={styles.statsRow}>
            <Text style={styles.stat}>BEST <Text style={styles.statGold}>{formatScore(Math.max(best, hud.score))}</Text></Text>
            <Text style={styles.stat}>LV <Text style={styles.statValue}>{hud.level}</Text></Text>
          </View>
          <View style={styles.statsRow}>
            <Remaining n={hud.remaining} total={hud.total} />
            <IconButton label="Pause" onPress={onPause}>
              <View style={styles.pauseGlyph}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            </IconButton>
          </View>
        </View>
        <View style={[styles.chip, { left: width - 16 - radarSize, top: 16 + radarSize + 8, width: radarSize }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>NEXT</Text>
            <View style={[styles.nextDotSmall, { backgroundColor: BOMB_HEX[hud.next]?.base ?? palette.textMuted }]} />
          </View>
          <Text style={[styles.label, { marginTop: 4 }]}>DANGER</Text>
          <DangerBar d={hud.danger} width={radarSize - 20} />
        </View>
        <View style={[styles.legendStrip, { left: 16, bottom: 12 }]}>
          <Text style={styles.legendText}>MOUSE TURN · WASD MOVE · CLICK FIRE · X SWAP · R FACE THREAT · ESC PAUSE</Text>
        </View>
      </>
    );
  }
  return (
    <View style={[styles.bar, { left, top, width }]}>
      <View style={styles.pill}>
        <View>
          <View style={styles.row}>
            <Text style={styles.label}>SCORE </Text>
            <Text style={[styles.score, { fontSize: 22 }]} numberOfLines={1}>{padScore(hud.score)}</Text>
            {comboShown > 1 && <Text style={styles.comboSmall}> x{Math.min(comboShown, 5)}</Text>}
          </View>
          <DangerBar d={hud.danger} width={140} />
        </View>
      </View>
      <View style={[styles.pill, styles.lv]}>
        <Text style={styles.lvText}>LV {hud.level}</Text>
      </View>
      <View style={styles.pill}>
        <Remaining n={hud.remaining} total={hud.total} />
      </View>
      <View style={styles.spacer} />
      <IconButton label="Pause" onPress={onPause}>
        <View style={styles.pauseGlyph}>
          <View style={styles.pauseBar} />
          <View style={styles.pauseBar} />
        </View>
      </IconButton>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { position: "absolute", minHeight: 52, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  pill: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    justifyContent: "center",
  },
  lv: { borderColor: palette.cyan },
  lvText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 1.5, color: palette.cyan },
  spacer: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.6, color: palette.textSecondary },
  value: { fontFamily: fonts.score, fontSize: 18, color: palette.textPrimary },
  score: { fontFamily: fonts.score, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  comboSmall: { fontFamily: fonts.display, fontSize: 16, color: palette.gold },
  dangerTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", marginTop: 4, overflow: "hidden" },
  dangerFill: { height: 6, borderRadius: 3 },
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, marginRight: 6, alignItems: "center", justifyContent: "center" },
  ringFill: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  corner: {
    position: "absolute",
    width: 236,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    gap: 4,
  },
  chip: {
    position: "absolute",
    padding: 10,
    borderRadius: 14,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
  statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stat: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.2, color: palette.textSecondary },
  statGold: { fontFamily: fonts.score, fontSize: 14, color: palette.gold },
  statValue: { fontFamily: fonts.score, fontSize: 14, color: palette.textPrimary },
  nextDotSmall: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" },
  legendStrip: {
    position: "absolute",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(11, 4, 32, 0.6)",
    pointerEvents: "none",
  },
  legendText: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.2, color: palette.textSecondary },
  pauseGlyph: { flexDirection: "row", gap: 5 },
  pauseBar: { width: 4, height: 14, borderRadius: 1, backgroundColor: palette.textPrimary },
});
