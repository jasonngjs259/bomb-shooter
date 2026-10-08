import { Orbitron_700Bold } from "@expo-google-fonts/orbitron/700Bold";
import { Orbitron_800ExtraBold } from "@expo-google-fonts/orbitron/800ExtraBold";
import { Orbitron_900Black } from "@expo-google-fonts/orbitron/900Black";
import { Rajdhani_500Medium } from "@expo-google-fonts/rajdhani/500Medium";
import { Rajdhani_600SemiBold } from "@expo-google-fonts/rajdhani/600SemiBold";
import { Rajdhani_700Bold } from "@expo-google-fonts/rajdhani/700Bold";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { settingsStore } from "./src/storage/settings";
import { GameScreen } from "./src/ui/GameScreen";
import { Loader } from "./src/ui/Loader";
import { colors } from "./src/ui/theme";

// Hold the native splash until the fonts are ready (no-op on web)
SplashScreen.preventAutoHideAsync().catch(() => undefined);
settingsStore.init();

export default function App() {
  const [loaded, error] = useFonts({
    Orbitron_900Black,
    Orbitron_800ExtraBold,
    Orbitron_700Bold,
    Rajdhani_700Bold,
    Rajdhani_600SemiBold,
    Rajdhani_500Medium,
  });
  const ready = loaded || error !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready ? <GameScreen /> : <Loader />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
