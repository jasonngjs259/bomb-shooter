// Headless no-op expo-haptics (scripts/arena-smoke.ts only).
export enum ImpactFeedbackStyle { Light = "light", Medium = "medium", Heavy = "heavy", Soft = "soft", Rigid = "rigid" }
export enum NotificationFeedbackType { Success = "success", Warning = "warning", Error = "error" }
export const impactAsync = (_s: ImpactFeedbackStyle) => Promise.resolve();
export const selectionAsync = () => Promise.resolve();
export const notificationAsync = (_t: NotificationFeedbackType) => Promise.resolve();
