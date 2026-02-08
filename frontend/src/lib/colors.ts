import { DEFAULT_COLOR_PALETTE } from "./config";
import { getArchetypeKey, hashString } from "./utils";
import { world } from "./state/world.svelte";

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

export function numberToHex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

export function getArchetypeColor(archetype: readonly string[]): number {
  const key = getArchetypeKey(archetype);

  const cfg = world.archetypeConfigMap.get(key);
  if (cfg?.color) {
    return hexToNumber(cfg.color);
  }

  const palette = world.config?.color_palette;
  if (palette && palette.length > 0) {
    const idx = hashString(key) % palette.length;
    return hexToNumber(palette[idx]);
  }

  const idx = hashString(key) % DEFAULT_COLOR_PALETTE.length;
  return DEFAULT_COLOR_PALETTE[idx];
}

export function getArchetypeColorCSS(archetype: readonly string[]): string {
  return numberToHex(getArchetypeColor(archetype));
}
