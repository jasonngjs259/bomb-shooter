// Must stay the first import: native-runtime shims (see src/polyfills.ts).
import "./src/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";

// Sets up the app for Expo Go, native builds and web alike.
registerRootComponent(App);
