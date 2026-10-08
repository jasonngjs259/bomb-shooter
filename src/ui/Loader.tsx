// Shown while fonts load (web has no native splash).
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { palette } from "./theme";

export function Loader() {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={palette.cyan} size="large" />
      <Text style={styles.text}>LOADING</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: palette.bgTop },
  text: { color: palette.textSecondary, fontSize: 14, fontWeight: "700", letterSpacing: 4 },
});
