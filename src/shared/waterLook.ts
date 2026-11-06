/**
 * Ocean under the sky arena. Numbers only. `src/client/water.ts` reads them.
 *
 * The surface stays below the Lakitu line. Nothing here has a collider.
 *
 * Explorers clip meshes outside the parcel box, and a World draws a default
 * landscape of trees and pink ground beyond that box unless
 * `landscapeTerrain` is false in scene.json. The sea is sized to the scene,
 * not past it. The horizon skirt is what hides the cut.
 *
 * EnvironmentFog is global and exponential. It stays very thin so the arena
 * stays clear. The skirt and the mist are the local fog.
 */
export const WATER = {
  /** Wanted surface height (m). Clamped under the rescue line. */
  heightY: 4,
  /** Metres of open air kept between the surface and the rescue line. */
  clearanceM: 6,
  /**
   * Plane width (m). 0 means "fill the scene, a few metres inside the
   * parcel box" so the bounds checker does not slice it.
   */
  sizeM: 0,
  /** Pulled in from each scene edge when sizeM is 0. */
  edgeInsetM: 6,
  /** Deep ocean blue. Alpha stays high so the mist cannot grey it out. */
  color: { r: 0.02, g: 0.22, b: 0.72, a: 0.96 },
  metallic: 0.45,
  roughness: 0.12,
  /** Ripple normal from the Creator Hub Water Plane. */
  normalSrc: 'assets/textures/water-normal.png',
  /** Morph-target swell. Peak is 1 m in the file; Y scale is the amplitude. */
  waveMesh: 'assets/models/water-wave.glb',
  /** Crest height (m). The 5 cm Water Plane bob is only the `swellM` floor. */
  waveAmplitudeM: 1.8,
  /** Playback rate of the `wave` clip. 1 = the file's 8 s cycle. */
  waveSpeed: 0.85,
  /** Whole-surface rise and fall (m), on top of the mesh. */
  swellM: 0.45,
  swellSeconds: 8,
  /** Metres per ripple repeat of the normal map. The Water Plane uses 512/38. */
  rippleSizeM: 512 / 38,
  /**
   * Two crossed scrolls. Each entry is one transparent sheet.
   * Mobile keeps only the first.
   */
  ripples: [
    { speed: 0.018, scale: 1, x: 1, y: 0.35 },
    { speed: 0.041, scale: 2.5, x: -0.45, y: 1 },
  ],
}

export const WATER_FOG = {
  /** Global exponential fog. Thin enough that the arena stays clear; the far edge of a 4800 m scene still fades. */
  environment: true,
  /**
   * Per metre. Explorer default is 0.0005. ~0.00065 is about 9% at 150 m
   * (the maze) and about 80% at 2400 m (halfway to the parcel edge).
   */
  density: 0.00065,
  /** Blue, not grey, so the distance fade doesn't bleach the sea. */
  color: { r: 0.1, g: 0.28, b: 0.62 },
  /** Vertical cards at the parcel edge. Off: they read as walls. */
  skirt: false,
  skirtHeightM: 90,
  skirtSrc: 'assets/textures/water-skirt.png',
  /** Thin blue sheet above the sea. Low alpha so it doesn't grey the water. */
  mist: true,
  mistAboveM: 14,
  mistColor: { r: 0.05, g: 0.28, b: 0.7, a: 0.06 },
}

/** Fog fraction at `metres` for the configured density. */
export function fogAt(metres: number, density: number = WATER_FOG.density): number {
  return 1 - Math.exp(-Math.max(0, density) * metres)
}

/**
 * Surface Y actually used. Never reaches the rescue line: a configured
 * height that would sit in the fall is pulled down by `clearanceM`.
 */
export function resolvedWaterY(minY: number, fallDrop: number): number {
  const rescue = minY - fallDrop
  return Math.min(WATER.heightY, rescue - WATER.clearanceM)
}

/** Plane width that stays inside the parcel box. */
export function resolvedWaterSize(sceneM: number): number {
  const inset = Math.max(1, WATER.edgeInsetM)
  const fill = Math.max(16, sceneM - inset * 2)
  if (WATER.sizeM <= 0) return fill
  return Math.min(WATER.sizeM, fill)
}
