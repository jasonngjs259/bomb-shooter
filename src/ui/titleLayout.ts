// Title screen geometry in container points, shared by the RN title overlay
// (logo text, tagline, PLAY button) and the 3D title scene (logo bomb, bomb
// pile) so the bomb that replaces the logo's "O" lines up with the text and
// the pile always sits between the tagline and PLAY without touching either.

// Three arrangements:
//  - phone portrait: big logo, stacked ARENA / HANGAR / CLASSIC + BEST line;
//  - desktop (wide and tall): 88pt logo, two 300x132 cards (HANGAR under ARENA) + key hint;
//  - COMPACT (landscape, height < 620: phones at 800x360 / 844x390 / 932x430,
//    short desktop windows): a smaller logo and a short stack pinned to the
//    bottom: ARENA | CLASSIC side by side (56pt), HANGAR (48pt), BEST line;
//    the pile shrinks into the gap between the tagline and the buttons.

export interface TitleLayout {
  desktop: boolean;
  compact: boolean;
  fontSize: number; // "B_MB" line
  logoY: number; // centre of the first logo line
  slotX: number; // centre of the "O" bomb
  slotSize: number; // its diameter
  subY: number; // centre of "SHOOTER"
  tagY: number; // top of the tagline (with its backing)
  tagBottom: number; // bottom of the tagline backing
  tagLines: 1 | 2;
  pileGroundY: number;
  pileBomb: number; // pile bomb diameter
  pileTop: number; // top of the pile (incl. fuse + spark)
  playY: number; // centre of the PLAY button (legacy anchor)
  playTop: number; // top of the mode buttons stack
  stackH: number; // mode buttons stack height (incl. BEST line / key hint)
}

const TAG_LINE_H = 18;
const TAG_PAD = 8; // vertical padding of the tagline backing (total)
// Pile height in bomb diameters: half a bomb + 2 stacked rows (0.86 each)
// + the fuse and its spark above the top row.
const PILE_HEIGHT = 0.5 + 2 * 0.86 + 0.8;

// Mode stack heights (ModeButtons): buttons + gaps + the BEST line / key hint.
export const MODE_STACK = {
  phone: 64 + 12 + 48 + 12 + 56 + 12 + 20,
  desktop: 132 + 12 + 48 + 12 + 18,
  compact: 56 + 10 + 48 + 10 + 20,
} as const;
const COMPACT_MARGIN = 10;

export const isCompactTitle = (w: number, h: number) => w > h && h < 620;

export function titleLayout(w: number, h: number): TitleLayout {
  const compact = isCompactTitle(w, h);
  const desktop = w >= 900 && !compact;
  const fontSize = compact ? Math.max(34, Math.min(52, h * 0.12)) : desktop ? 88 : Math.max(40, Math.min(56, w * 0.135));
  const logoY = compact ? Math.max(8, h * 0.035) + fontSize * 0.6 : h * (desktop ? 0.17 : 0.16) + fontSize * 0.5;
  const slotSize = fontSize * 0.98;
  const subY = logoY + fontSize * 0.98;
  const tagLines = w < 480 ? 2 : 1;
  const tagY = subY + fontSize * 0.44;
  const tagBottom = tagY + tagLines * TAG_LINE_H + TAG_PAD;
  const stackH = compact ? MODE_STACK.compact : desktop ? MODE_STACK.desktop : MODE_STACK.phone;
  let playY: number;
  let playTop: number;
  let pileLimit: number; // the pile stays above this
  if (compact) {
    playTop = h - COMPACT_MARGIN - stackH;
    playY = playTop + 28;
    pileLimit = playTop - 6;
  } else if (desktop) {
    playY = Math.min(h * 0.76, h - 170);
    playTop = playY - 66;
    pileLimit = playY - 72 - 12;
  } else {
    // the mode stack needs ~172pt below playY on phones
    playY = Math.max(h * 0.62, Math.min(h * 0.75, h - 172));
    playTop = playY - 68;
    pileLimit = playY - 76 - 12;
  }
  // Pile: preferred size, shrunk if the gap between tagline and buttons is short.
  const wanted = desktop ? 64 : Math.max(34, Math.min(56, w * 0.105));
  const gap = pileLimit - (tagBottom + (compact ? 6 : 10));
  const pileBomb = Math.max(compact ? 14 : 20, Math.min(wanted, gap / PILE_HEIGHT));
  const preferredGround = h * (desktop ? 0.62 : 0.6);
  const minGround = tagBottom + (compact ? 6 : 10) + PILE_HEIGHT * pileBomb;
  const pileGroundY = Math.min(Math.max(preferredGround, minGround), pileLimit);
  return {
    desktop,
    compact,
    fontSize,
    logoY,
    slotX: w / 2 - fontSize * 0.42,
    slotSize,
    subY,
    tagY,
    tagBottom,
    tagLines,
    pileGroundY,
    pileBomb,
    pileTop: pileGroundY - PILE_HEIGHT * pileBomb,
    playY,
    playTop,
    stackH,
  };
}
