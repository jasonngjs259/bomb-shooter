import { Orbitron_700Bold } from "@expo-google-fonts/orbitron/700Bold";
import { Orbitron_800ExtraBold } from "@expo-google-fonts/orbitron/800ExtraBold";
import { Orbitron_900Black } from "@expo-google-fonts/orbitron/900Black";
import { Rajdhani_500Medium } from "@expo-google-fonts/rajdhani/500Medium";
import { Rajdhani_600SemiBold } from "@expo-google-fonts/rajdhani/600SemiBold";
import { Rajdhani_700Bold } from "@expo-google-fonts/rajdhani/700Bold";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initAudio } from "./src/audio";
import { astronautBytes } from "./src/render/arena/character/astronautAsset";
import { ArenaScreen } from "./src/ui/arena/ArenaScreen";
import { GameScreen } from "./src/ui/GameScreen";
import { initProgress } from "./src/storage/progressStore";
import { initSettings } from "./src/ui/settings";
import { palette } from "./src/ui/theme";
import { installWebScrollbarStyle } from "./src/ui/webSafe";

initSettings();
installWebScrollbarStyle();
// Arena progress (stars, unlocks, equipped skin, seen tips) loads in the background.
void initProgress();
// Audio players are created once here (web: silent until the first tap / key).
initAudio();
// Fetch the Arena character model in the background from app start, so it is
// usually ready before an Arena intro ends (failures retry in Arena).
astronautBytes().catch(() => undefined);

export default function App() {
  // Orbitron + Rajdhani load before the title so the logo never flashes a
  // fallback font; a simple neon spinner covers the wait.
  const [fontsLoaded, fontError] = useFonts({
    Orbitron_700Bold,
    Orbitron_800ExtraBold,
    Orbitron_900Black,
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
  });
  const ready = fontsLoaded || fontError !== null;
  // Classic (with the title) or Arena 360; each owns its own GL canvas, so
  // only one WebGL context is alive at a time.
  const [mode, setMode] = useState<"classic" | "arena">("classic");
  // "Play Classic" from Arena's 3D-unavailable card starts a Classic game
  // right away (2D fallback) instead of landing on the title
  const [classicNow, setClassicNow] = useState(false);
  // HANGAR LEVELS pick: Arena starts at this level (score 0); PLAY = level 1
  const [arenaLevel, setArenaLevel] = useState(1);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready && mode === "classic" && (
          <GameScreen
            autoStart={classicNow}
            onArena={(level) => {
              setClassicNow(false);
              setArenaLevel(level ?? 1);
              setMode("arena");
            }}
          />
        )}
        {ready && mode === "arena" && (
          <ArenaScreen
            startLevel={arenaLevel}
            onExit={() => setMode("classic")}
            onClassic={() => {
              setClassicNow(true);
              setMode("classic");
            }}
          />
        )}
        {!ready && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={palette.cyan} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bgTop },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bgTop },
});
