// Title screen geometry in container points, shared by the RN title overlay
// (logo text, tagline, PLAY button) and the 3D title scene (logo bomb, bomb
// pile) so the bomb that replaces the logo's "O" lines up with the text and
// the pile always sits between the tagline and PLAY without touching either.

export interface TitleLayout {
  desktop: boolean;
  fontSize: number; // "B_MB" line
  logoY: number; // centre of the first logo line
  slotX: number; // centre of the "O" bomb
  slotSize: number; // its diameter
  subY: number; // centre of "SHOOTER"
  tagY: number; // top of the tagline (with its backing)
  tagLines: 1 | 2;
  pileGroundY: number;
  pileBomb: number; // pile bomb diameter
  playY: number; // centre of the PLAY button
}

const TAG_LINE_H = 18;
const TAG_PAD = 8; // vertical padding of the tagline backing (total)
// Pile height in bomb diameters: half a bomb + 2 stacked rows (0.86 each)
// + the fuse and its spark above the top row.
const PILE_HEIGHT = 0.5 + 2 * 0.86 + 0.8;

export function titleLayout(w: number, h: number): TitleLayout {
  const desktop = w >= 900;
  const fontSize = desktop ? 88 : Math.max(40, Math.min(56, w * 0.135));
  const logoY = h * (desktop ? 0.17 : 0.16) + fontSize * 0.5;
  const slotSize = fontSize * 0.98;
  const subY = logoY + fontSize * 0.98;
  const tagLines = w < 480 ? 2 : 1;
  const tagY = subY + fontSize * 0.44;
  const tagBottom = tagY + tagLines * TAG_LINE_H + TAG_PAD;
  const playY = h * (desktop ? 0.76 : 0.75);
  const playTop = playY - 38; // PLAY glow ring top
  // Pile: preferred size, shrunk if the gap between tagline and PLAY is short.
  const wanted = desktop ? 64 : Math.max(34, Math.min(56, w * 0.105));
  const gap = playTop - 12 - (tagBottom + 10);
  const pileBomb = Math.max(20, Math.min(wanted, gap / PILE_HEIGHT));
  const preferredGround = h * (desktop ? 0.62 : 0.6);
  const minGround = tagBottom + 10 + PILE_HEIGHT * pileBomb;
  const pileGroundY = Math.min(Math.max(preferredGround, minGround), playTop - 12);
  return {
    desktop,
    fontSize,
    logoY,
    slotX: w / 2 - fontSize * 0.42,
    slotSize,
    subY,
    tagY,
    tagLines,
    pileGroundY,
    pileBomb,
    playY,
  };
}
