// Arena HUD sizes shared by ArenaHud.tsx, ArenaScreen.tsx and the headless
// layout checks (scripts/arena-ui-logic.ts). Pure numbers, no React.

// Desktop score card: 236 wide, 14 padding + 1.5 border each side. The fever
// row (flame 16 + 6 + bar + 6 + "FEVER!" label <= 62) must fit inside it.
export const DESKTOP_CARD_W = 236;
export const DESKTOP_CARD_INNER = DESKTOP_CARD_W - 2 * 14 - 2 * 1.5;
export const FEVER_LABEL_W = 62;
export const DESKTOP_FEVER_W = 110;
export const feverRowWidth = (barW: number, active: boolean) => 16 + 6 + barW + (active ? 6 + FEVER_LABEL_W : 0);

// Short desktop window (mouse, phone-style HUD): bottom-right NEXT / ROLL / keys chip.
export const MOUSE_CHIP_W = 180;
// Phone-style bottom row: freeze slot 88 + gap 8 + fever row (bar 220).
export const PHONE_FEVER_W = 220;
export const phoneFeverRow = (screenW: number) => {
  const left = (screenW - PHONE_FEVER_W) / 2 - 96;
  return { left, right: left + 96 + feverRowWidth(PHONE_FEVER_W, true) };
};
