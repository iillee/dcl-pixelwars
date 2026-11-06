/**
 * Ocean under the sky arena, and the fog that hides its edges.
 * Numbers only. The client in `src/client/water.ts` reads them.
 *
 * The surface is clamped below the Lakitu line (MIN_Y − FALL_RESPAWN_DROP)
 * by `clearanceM`, and the plane has no collider, so paint, knock-offs and
 * the fall rescue are unchanged.
 *
 * Creator Hub 0.52's "water" is the Water Plane smart item: stacked
 * translucent planes, this normal map drifting, and a 5 cm bob. There is
 * no water shader in the SDK. Splashes are a player trigger on that item;
 * this sea does not use one.
 *
 * EnvironmentFog (SDK 7.32+) is exponential, `1 - e^(-density * metres)`.
 * It has no linear start or end. `startM` / `endM` are the distances the
 * density is chosen for: readable inside `startM`, about 90% fog by `endM`.
 * Fog is a desktop quality setting and is not applied on the mobile app
 * or the Bevy explorer. The water mesh still draws there.
 */
export const WATER = {
  /** Wanted surface height (m). Clamped under the rescue line. */
  heightY: 4,
  /** Metres of open air kept between the surface and the rescue line. */
  clearanceM: 6,
  /** Width and depth of the plane (m). The scene is 320 m. */
  sizeM: 1600,
  color: { r: 0.07, g: 0.32, b: 0.48, a: 0.78 },
  metallic: 0.65,
  roughness: 0.08,
  /**
   * Ripple normal from the Creator Hub Water Plane
   * (`packages/asset-packs/.../water_plane/PoolBake_normal.png`).
   */
  normalSrc: 'assets/textures/water-normal.png',
  /** Metres per ripple repeat. The Water Plane uses 512 / 38. */
  rippleSizeM: 512 / 38,
  /** Texture repeats per second. The Water Plane uses 0.008 (~0.1 m/s). */
  driftSpeed: 0.008,
  drifts: [
    { x: 1, y: 0.35 },
    { x: -0.55, y: 1 },
    { x: 0.8, y: -0.6 },
  ],
  /** Vertical bob of each sheet (m), over `bobSeconds`. */
  bobM: 0.05,
  bobSeconds: 5,
  /**
   * Translucent sheets. Each one is a full-screen overdraw when you look
   * across the sea, so mobile keeps a single sheet.
   */
  layersDesktop: 3,
  layersMobile: 1,
  /** Gap between sheets so they don't flicker against each other (m). */
  layerGapM: 0.12,
}

export const WATER_FOG = {
  /** Sea haze. The sky itself is left on the default cycle. */
  color: { r: 0.62, g: 0.74, b: 0.84 },
  /** Inside this distance the platforms should stay easy to read. */
  startM: 140,
  /** By this distance the water's far edge should be mostly gone. */
  endM: 700,
}

/** Density that puts about 90% fog at `endM`. */
export function fogDensity(endM: number = WATER_FOG.endM): number {
  return -Math.log(0.1) / endM
}

/** Fog fraction at `metres` for the configured density. */
export function fogAt(metres: number, density: number = fogDensity()): number {
  return 1 - Math.exp(-density * metres)
}

/**
 * Surface Y actually used. Never reaches the rescue line: a configured
 * height that would sit in the fall is pulled down by `clearanceM`.
 */
export function resolvedWaterY(minY: number, fallDrop: number): number {
  const rescue = minY - fallDrop
  return Math.min(WATER.heightY, rescue - WATER.clearanceM)
}
