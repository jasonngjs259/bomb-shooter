// Title screen geometry in container points, shared by the RN title overlay
// (logo text, PLAY button) and the 3D title scene (logo bomb, bomb pile) so
// the bomb that replaces the logo's "O" lines up with the text.

export interface TitleLayout {
  desktop: boolean;
  fontSize: number; // "B_MB" line
  logoY: number; // centre of the first logo line
  slotX: number; // centre of the "O" bomb
  slotSize: number; // its diameter
  subY: number; // centre of "SHOOTER"
  pileGroundY: number;
  pileBomb: number; // pile bomb diameter
  playY: number; // centre of the PLAY button
}

export function titleLayout(w: number, h: number): TitleLayout {
  const desktop = w >= 900;
  const fontSize = desktop ? 88 : Math.max(40, Math.min(56, w * 0.135));
  const logoY = h * (desktop ? 0.17 : 0.16) + fontSize * 0.5;
  const slotSize = fontSize * 0.98;
  return {
    desktop,
    fontSize,
    logoY,
    slotX: w / 2 - fontSize * 0.42,
    slotSize,
    subY: logoY + fontSize * 0.98,
    pileGroundY: h * (desktop ? 0.62 : 0.6),
    pileBomb: desktop ? 64 : Math.max(34, Math.min(56, w * 0.105)),
    playY: h * (desktop ? 0.76 : 0.75),
  };
}
