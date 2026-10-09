// Mobile-web full screen UI (logic in fullscreen.ts):
//   useFullscreen()   offer / active / mode, kept in sync with fullscreenchange
//   FullscreenButton  44pt neon icon button (enter / exit glyph) for the title
//   FullscreenHint    the iPhone "Add to Home Screen" sheet (rendered once in App)
// Pause menus use useFullscreen() for their FULL SCREEN row. On native and on
// desktop mouse nothing renders.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../audio";
import {
  enterFullscreen, exitFullscreen, fullscreenEnv, fullscreenMode, FsWindow, GENERIC_HINT, IOS_HINT, onFullscreenChange,
  prefersFullscreen, shouldOfferFullscreen,
} from "./fullscreen";
import { fonts, palette } from "./theme";

const WEB = Platform.OS === "web";
const win = (): FsWindow | undefined => (WEB && typeof window !== "undefined" ? (window as unknown as FsWindow) : undefined);

// ---- hint sheet store (one sheet for the whole app) -------------------------
let hintOpen = false;
const hintListeners = new Set<() => void>();
const setHint = (open: boolean) => {
  hintOpen = open;
  hintListeners.forEach((l) => l());
};
const subscribeHint = (l: () => void) => {
  hintListeners.add(l);
  return () => {
    hintListeners.delete(l);
  };
};

export function useFullscreen() {
  const [env, setEnv] = useState(() => fullscreenEnv(win(), WEB));
  useEffect(() => {
    if (!WEB) return;
    const refresh = () => setEnv(fullscreenEnv(win(), WEB));
    const off = onFullscreenChange(win(), refresh);
    window.addEventListener("resize", refresh);
    return () => {
      off();
      window.removeEventListener("resize", refresh);
    };
  }, []);
  const offer = shouldOfferFullscreen(env);
  const mode = fullscreenMode(env);
  // Must run inside the tap handler: the request is made synchronously.
  const toggle = useCallback(() => {
    const w = win();
    if (env.active) {
      void exitFullscreen(w);
      return;
    }
    if (mode === "ios-hint") {
      setHint(true);
      return;
    }
    void enterFullscreen(w).then((r) => {
      if (r === "hint") setHint(true);
      setEnv(fullscreenEnv(win(), WEB));
    });
  }, [env.active, mode]);
  return { offer, active: env.active, mode, ios: env.ios, preferred: offer && !env.active && prefersFullscreen(win()), toggle };
}

// Corner brackets: outward = enter, inward = exit.
function FsGlyph({ exit }: { exit: boolean }) {
  const c = (pos: object, rot: number) => (
    <View style={[styles.corner, pos, { transform: [{ rotate: `${rot + (exit ? 180 : 0)}deg` }] }]} />
  );
  return (
    <View style={styles.glyph}>
      {c({ left: 0, top: 0 }, 0)}
      {c({ right: 0, top: 0 }, 90)}
      {c({ right: 0, bottom: 0 }, 180)}
      {c({ left: 0, bottom: 0 }, 270)}
    </View>
  );
}

export function FullscreenButton() {
  const fs = useFullscreen();
  if (!fs.offer) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fs.active ? "Exit full screen" : "Full screen"}
      hitSlop={10}
      onPress={() => {
        uiSound("click");
        fs.toggle();
      }}
      style={({ pressed }) => [styles.icon, fs.preferred && styles.preferred, pressed && styles.pressed]}
    >
      <FsGlyph exit={fs.active} />
    </Pressable>
  );
}

export function FullscreenHint() {
  const open = useSyncExternalStore(subscribeHint, () => hintOpen, () => false);
  const fs = useFullscreen();
  if (!open) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => setHint(false)} />
      <View style={styles.sheet} accessibilityRole="alert">
        <Text style={styles.sheetTitle}>FULL SCREEN</Text>
        <Text style={styles.sheetBody}>{fs.ios ? IOS_HINT : GENERIC_HINT}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => {
            uiSound("back");
            setHint(false);
          }}
          style={styles.close}
        >
          <Text style={styles.closeText}>GOT IT</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.panel,
    borderWidth: 1.5, borderColor: palette.panelBorder, cursor: "pointer",
  },
  preferred: { borderColor: palette.cyan, borderWidth: 2 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  glyph: { width: 18, height: 18 },
  corner: {
    position: "absolute", width: 7, height: 7, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderColor: palette.textPrimary,
  },
  backdrop: { backgroundColor: "rgba(7, 2, 15, 0.6)", justifyContent: "flex-end", alignItems: "center", padding: 16, zIndex: 50 },
  sheet: {
    width: 360, maxWidth: "100%", padding: 18, borderRadius: 20, backgroundColor: palette.panelSolid, borderWidth: 1.5,
    borderColor: palette.cyan, gap: 10, alignItems: "center",
  },
  sheetTitle: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 2, color: palette.cyan },
  sheetBody: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: palette.textPrimary, textAlign: "center" },
  close: {
    minWidth: 120, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: palette.cyan, alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  closeText: { fontFamily: fonts.button, fontSize: 15, letterSpacing: 1.5, color: palette.textPrimary },
});
