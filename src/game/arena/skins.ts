// Arena 360 cosmetics (fun-pass spec section 3): the HANGAR swatches, their
// unlock requirements and the skin the renderer applies. Pure data + pure
// helpers (no React, no storage): the UI persists `unlocked` / `equipped`
// (src/storage/arenaProgress.ts) and passes skinColors() to world.setSkin().
//
// Unlock table (stars = total stars over all levels, boss = first defeat of Mk n):
//   Cannon Violet 3 stars    Trim Magenta 6         Cannon Gold   boss Mk I
//   Cannon Ice    10         Trim Sunset  14        Plates Chrome boss Mk II
//   Cannon Neon Pink 18      Trim White-Hot 22      Plates Obsidian boss Mk III
//   Prism (trim + cannon hue cycle 4 s) 27 stars (all of L1-9)
// The danger lerp to red still overrides any trim (renderer rule).

export type SkinSlot = "trim" | "cannon" | "plates";

export type SkinRequirement = { stars: number } | { boss: number } | null; // null = always owned

export interface SkinItem {
  id: string;
  slot: SkinSlot;
  name: string;
  hex: string; // swatch / skin colour (Prism: its first hue)
  metal?: number; // plates metalness hint for the renderer
  prism?: boolean; // hue-cycles trim + cannon
  req: SkinRequirement;
}

export interface Equipped {
  trim: string;
  cannon: string;
  plates: string;
}

// Renderer contract: world.setSkin({ trim, cannon, plates, prism }).
export interface SkinColors {
  trim: string;
  cannon: string;
  plates: string;
  prism: boolean;
}

export const PRISM_CYCLE_S = 4;

export const SKIN_ITEMS: readonly SkinItem[] = [
  // TRIM
  { id: "trim.cyan", slot: "trim", name: "Cyan", hex: "#22F2FF", req: null },
  { id: "trim.magenta", slot: "trim", name: "Magenta", hex: "#FF3DCB", req: { stars: 6 } },
  { id: "trim.sunset", slot: "trim", name: "Sunset", hex: "#FF8A3D", req: { stars: 14 } },
  { id: "trim.whitehot", slot: "trim", name: "White-Hot", hex: "#F5F3FF", req: { stars: 22 } },
  { id: "trim.prism", slot: "trim", name: "Prism", hex: "#FF3DCB", prism: true, req: { stars: 27 } },
  // CANNON
  { id: "cannon.dusk", slot: "cannon", name: "Dusk", hex: "#3D3270", req: null },
  { id: "cannon.violet", slot: "cannon", name: "Violet", hex: "#7C5CFF", req: { stars: 3 } },
  { id: "cannon.gold", slot: "cannon", name: "Gold", hex: "#FFD23F", req: { boss: 1 } },
  { id: "cannon.ice", slot: "cannon", name: "Ice", hex: "#CFF4FF", req: { stars: 10 } },
  { id: "cannon.neonpink", slot: "cannon", name: "Neon Pink", hex: "#FF5FA2", req: { stars: 18 } },
  // PLATES
  { id: "plates.lilac", slot: "plates", name: "Lilac", hex: "#DCD6F7", req: null },
  { id: "plates.chrome", slot: "plates", name: "Chrome", hex: "#B8C2D9", metal: 0.8, req: { boss: 2 } },
  { id: "plates.obsidian", slot: "plates", name: "Obsidian", hex: "#2B2540", req: { boss: 3 } },
];

export const SKIN_SLOTS: readonly SkinSlot[] = ["trim", "cannon", "plates"];

export const DEFAULT_EQUIPPED: Readonly<Equipped> = { trim: "trim.cyan", cannon: "cannon.dusk", plates: "plates.lilac" };

const BY_ID = new Map(SKIN_ITEMS.map((s) => [s.id, s]));

export const skinItem = (id: string): SkinItem | undefined => BY_ID.get(id);

export const itemsForSlot = (slot: SkinSlot): SkinItem[] => SKIN_ITEMS.filter((s) => s.slot === slot);

// Boss Mk fought on `level` (every 3rd level), 0 = none. Mirrors the LEVELS
// table / generator in arenaLevels.ts (asserted by scripts/arena-progress.ts).
export const bossMkOfLevel = (level: number): number => (level >= 3 && level % 3 === 0 ? level / 3 : 0);

// Is `item` earned with these totals? (null requirement = default item)
export function meetsRequirement(req: SkinRequirement, totalStars: number, bossesBeaten: readonly number[]): boolean {
  if (!req) return true;
  if ("stars" in req) return totalStars >= req.stars;
  return bossesBeaten.includes(req.boss);
}

// Every non-default item earned with these totals, in table order.
export function unlockedIds(totalStars: number, bossesBeaten: readonly number[]): string[] {
  return SKIN_ITEMS.filter((s) => s.req && meetsRequirement(s.req, totalStars, bossesBeaten)).map((s) => s.id);
}

// Short lock label for a HANGAR swatch: "★ 10" or "BOSS Mk II".
export function requirementLabel(req: SkinRequirement): string {
  if (!req) return "";
  return "stars" in req ? `★ ${req.stars}` : `BOSS ${romanMk(req.boss)}`;
}

export function romanMk(n: number): string {
  const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  let v = Math.max(1, Math.floor(n));
  for (const [k, s] of table) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return `Mk ${out}`;
}

// Plain hex colours for world.setSkin(). Unknown / unowned ids fall back to the default.
export function skinColors(equipped: Equipped, owned?: (id: string) => boolean): SkinColors {
  const pick = (slot: SkinSlot): SkinItem => {
    const it = BY_ID.get(equipped[slot]);
    const ok = it && it.slot === slot && (!it.req || !owned || owned(it.id));
    return ok ? it : BY_ID.get(DEFAULT_EQUIPPED[slot])!;
  };
  const trim = pick("trim");
  const cannon = pick("cannon");
  const plates = pick("plates");
  const prism = trim.prism === true;
  return { trim: prism ? BY_ID.get(DEFAULT_EQUIPPED.trim)!.hex : trim.hex, cannon: cannon.hex, plates: plates.hex, prism };
}
