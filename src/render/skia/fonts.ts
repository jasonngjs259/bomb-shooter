// Skia typefaces for in-canvas text (combo label, score floats, title logo),
// loaded once from the same TTF assets expo-font uses. Until they arrive,
// fontFor() returns null and callers simply skip text.

import { Orbitron_900Black } from "@expo-google-fonts/orbitron/900Black";
import { Rajdhani_700Bold } from "@expo-google-fonts/rajdhani/700Bold";
import { loadData, Skia, SkData, SkFont, SkTypeface } from "@shopify/react-native-skia";

export type FontFace = "display" | "label";

const faces: Record<FontFace, SkTypeface | null> = { display: null, label: null };
const cache = new Map<string, SkFont>();
let loading: Promise<void> | null = null;

const typefaceFactory = (data: SkData) => Skia.Typeface.MakeFreeTypeFaceFromData(data);

export const loadSkiaFonts = (): Promise<void> => {
  if (!loading) {
    loading = Promise.all([
      loadData<SkTypeface | null>(Orbitron_900Black, typefaceFactory),
      loadData<SkTypeface | null>(Rajdhani_700Bold, typefaceFactory),
    ])
      .then(([display, label]) => {
        faces.display = display;
        faces.label = label;
      })
      .catch(() => undefined);
  }
  return loading;
};

// Advance width of a string. (SkFont.measureText is not implemented on
// web, so sum the glyph widths, which works on every platform.)
export const textWidth = (font: SkFont, text: string): number => {
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  let w = 0;
  for (let i = 0; i < widths.length; i++) w += widths[i];
  return w;
};

// Font for a face at a size (rounded to 0.5 so the cache stays small)
export const fontFor = (face: FontFace, size: number): SkFont | null => {
  const tf = faces[face];
  if (!tf) return null;
  const rounded = Math.max(4, Math.round(size * 2) / 2);
  const key = `${face}:${rounded}`;
  let font = cache.get(key);
  if (!font) {
    font = Skia.Font(tf, rounded);
    cache.set(key, font);
  }
  return font;
};
