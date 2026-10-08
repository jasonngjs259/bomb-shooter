// Pure HUD sizing maths (no React Native imports, so it is testable
// headless). The score font is sized from the space it gets so "000,000"
// never wraps: 26pt at 390pt wide, 25 at 360, 21 at 320.

// Orbitron ExtraBold "000,000" measures ~5.23 em (136px at 26px); 5.5 em
// leaves a margin for font rendering differences.
export const SCORE_EM_MEASURED = 5.23;
const SCORE_EM = 5.5;
export const scoreFontFor = (width: number, max: number) =>
  Math.max(14, Math.min(max, Math.floor(width / SCORE_EM)));

// Phone bar geometry (must match the HudBar styles).
export const BAR_PAD = 16;
export const BAR_BORDER = 1.5;
export const PAUSE_SIZE = 44;
export const BAR_GAP = 8;
const SCORE_SHARE = 0.55; // of the width left after the pause button

export const barScoreWidth = (barWidth: number) =>
  (barWidth - 2 * (BAR_PAD + BAR_BORDER) - PAUSE_SIZE - BAR_GAP) * SCORE_SHARE;

// Desktop side panel content width (240 wide, 24 padding, 1.5 border).
export const PANEL_INNER = 240 - 2 * (24 + 1.5);
