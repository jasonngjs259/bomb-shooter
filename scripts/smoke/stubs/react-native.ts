// Headless stand-in for the few react-native APIs the Arena frame driver
// reaches (settings + haptics). Used only by scripts/arena-smoke.ts via
// scripts/smoke/tsconfig.json paths.
export const Platform = {
  OS: "web" as const,
  select: <T>(o: { web?: T; default?: T }) => o.web ?? o.default,
};
export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove: () => undefined }),
};
