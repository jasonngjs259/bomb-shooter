// Character skins (fun spec 3, Hangar): plain hex colours from the UI.
//   trim   - suit trim + rim glow (the danger lerp to red still overrides it)
//   cannon - arm-cannon barrel body; its stripes are a lighter shade (the
//            muzzle ring keeps showing the current bomb's glow)
//   plates - armour plates; Chrome (#B8C2D9) is metal 0.8
//   prism  - trim + cannon hue cycle every 4 s
// ArenaWorld.setSkin(skin) applies it to the character (now or once loaded).

import { Color } from "three";
import { CANNON_BODY, CANNON_STRIPE } from "./character/Blaster";

export interface ArenaSkin {
  trim: string;
  cannon: string;
  plates: string;
  prism?: boolean;
}

export const DEFAULT_SKIN: ArenaSkin = { trim: "#22F2FF", cannon: CANNON_BODY, plates: "#DCD6F7" };

const PLATE_METAL: Record<string, number> = { "#B8C2D9": 0.8, "#2B2540": 0.45 };
const WHITE = new Color(1, 1, 1);

export interface ResolvedSkin {
  trim: Color;
  body: Color;
  stripe: Color;
  plates: Color;
  plateMetal: number;
  prism: boolean;
}

const safe = (hex: string | undefined, fallback: string) => {
  const c = new Color(fallback);
  if (typeof hex === "string" && /^#?[0-9a-f]{6}$/i.test(hex.trim())) c.set(hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`);
  return c;
};

export function resolveSkin(skin: Partial<ArenaSkin>): ResolvedSkin {
  const cannon = (skin.cannon ?? CANNON_BODY).toUpperCase();
  const body = safe(skin.cannon, CANNON_BODY);
  const isDefault = cannon === CANNON_BODY.toUpperCase();
  // custom cannons: the barrel a little darker than the swatch, stripes brighter
  const stripe = isDefault ? new Color(CANNON_STRIPE) : body.clone().lerp(WHITE, 0.45);
  if (!isDefault) body.multiplyScalar(0.62);
  const plates = (skin.plates ?? DEFAULT_SKIN.plates).toUpperCase();
  return {
    trim: safe(skin.trim, DEFAULT_SKIN.trim),
    body,
    stripe,
    plates: safe(skin.plates, DEFAULT_SKIN.plates),
    plateMetal: PLATE_METAL[plates] ?? 0.15,
    prism: skin.prism === true,
  };
}

// Prism hue at time t (s): full cycle every 4 s.
export function prismColor(t: number, offset: number, out: Color) {
  return out.setHSL((((t / 4 + offset) % 1) + 1) % 1, 1, 0.58);
}
