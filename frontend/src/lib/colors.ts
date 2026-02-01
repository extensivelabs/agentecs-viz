/**
 * Shared color utilities for visualization.
 *
 * Provides consistent archetype coloring across all views (PetriDish, ArchetypesTab, etc.)
 * with support for config-based customization.
 */

import { ARCHETYPE_COLORS } from "./config";
import { getArchetypeKey } from "./utils";
import { world } from "./world.svelte";

/**
 * Convert hex string to number (for PixiJS).
 */
export function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/**
 * Convert number to CSS hex string.
 */
export function numberToHex(num: number): string {
  return `#${num.toString(16).padStart(6, "0")}`;
}

/**
 * Hash a string to an index using a simple hash function.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Get color for an archetype as a number (for PixiJS).
 *
 * Priority:
 * 1. Config-specified color for this archetype
 * 2. Config-specified custom palette (hash into it)
 * 3. Default palette (hash into it)
 */
export function getArchetypeColor(archetype: readonly string[]): number {
  const key = getArchetypeKey([...archetype]);

  // Check config for explicit color for this archetype
  const archetypeConfig = world.archetypeConfigMap.get(key);
  if (archetypeConfig?.color) {
    return hexToNumber(archetypeConfig.color);
  }

  // Hash the key for palette selection
  const hash = hashString(key);

  // Check for custom palette in config
  const customPalette = world.config?.color_palette;
  if (customPalette && customPalette.length > 0) {
    return hexToNumber(customPalette[hash % customPalette.length]);
  }

  // Fall back to default palette
  return ARCHETYPE_COLORS[hash % ARCHETYPE_COLORS.length];
}

/**
 * Get color for an archetype as a CSS hex string.
 */
export function getArchetypeColorCSS(archetype: readonly string[]): string {
  return numberToHex(getArchetypeColor(archetype));
}

/**
 * Get the friendly label for an archetype (if configured).
 * Returns null if no custom label is configured.
 */
export function getArchetypeLabel(archetype: readonly string[]): string | null {
  const key = getArchetypeKey([...archetype]);
  const config = world.archetypeConfigMap.get(key);
  return config?.label ?? null;
}

/**
 * Get the description for an archetype (if configured).
 * Returns null if no description is configured.
 */
export function getArchetypeDescription(archetype: readonly string[]): string | null {
  const key = getArchetypeKey([...archetype]);
  const config = world.archetypeConfigMap.get(key);
  return config?.description ?? null;
}
