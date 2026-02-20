import { DEFAULT_COLOR_PALETTE } from "./config";
import { getArchetypeKey, hashString } from "./utils";
import { world } from "./state/world.svelte";

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

export function numberToHex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

export function resolveArchetypeColor(
  archetype: readonly string[],
  configMap: Map<string, { color?: string | null }>,
  palette?: string[] | null,
): number {
  const key = getArchetypeKey(archetype);

  const cfg = configMap.get(key);
  if (cfg?.color) {
    return hexToNumber(cfg.color);
  }

  if (palette && palette.length > 0) {
    const idx = hashString(key) % palette.length;
    return hexToNumber(palette[idx]);
  }

  const idx = hashString(key) % DEFAULT_COLOR_PALETTE.length;
  return DEFAULT_COLOR_PALETTE[idx];
}

export function getArchetypeColor(archetype: readonly string[]): number {
  return resolveArchetypeColor(
    archetype,
    world.archetypeConfigMap,
    world.config?.color_palette,
  );
}

export function getArchetypeColorCSS(archetype: readonly string[]): string {
  return numberToHex(getArchetypeColor(archetype));
}
