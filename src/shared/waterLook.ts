/**
 * Ocean under the sky arena. Numbers only. `src/client/water.ts` reads them.
 *
 * The surface stays below the Lakitu line. Nothing here has a collider.
 *
 * Explorers clip meshes outside the parcel box. The sea is sized a few
 * metres inside the scene. `landscapeTerrain: false` drops the default
 * trees on a World.
 *
 * Swells are a displaced mesh, not a normal map. The files under
 * assets/models/water-swell*.glb and water-flat*.glb are built from the
 * wavelength and the ring sizes. After changing those, run
 * `npx tsx scripts/build-water-swell.ts`. Amplitude and period apply at
 * runtime (Y scale and clip speed).
 *
 * EnvironmentFog (component 1225) is exponential only: color gradient and
 * density, `1 - e^(-density * metres)`. The protocol has no linear mode and
 * no start/end distance, so density stays 0. The horizon is the flat rim
 * fading to sky colour, plus a short soft veil.
 */
export const WATER = {
  /** Mean surface height (m). Clamped under the rescue line. Troughs sit this far below the mean. */
  heightY: 4.5,
  /** Metres of open air kept between the configured mean and the rescue line. */
  clearanceM: 6,
  /**
   * Width of the flat rim (m). 0 means "fill the scene, a few metres inside
   * the parcel box" so the bounds checker does not slice it.
   */
  sizeM: 0,
  /** Pulled in from each scene edge when sizeM is 0. */
  edgeInsetM: 6,
  /** Deep ocean blue. The flat rim's inner edge uses this same colour. */
  color: { r: 0.02, g: 0.22, b: 0.72, a: 1 },
  metallic: 0.45,
  roughness: 0.12,
  /** Solid albedo so the swell and the rim share one texture path. */
  colorSrc: 'assets/textures/water-blue.png',
  /**
   * Half the peak-to-trough height (m). 4 → crests 8 m above troughs.
   * The mesh morph is ±1; the entity's Y scale is this number.
   */
  swellAmplitudeM: 4,
  /** Crest-to-crest distance (m). Baked into the swell meshes. */
  swellWavelengthM: 48,
  /** Seconds for one crest to travel one wavelength. */
  swellPeriodS: 10,
  /** Length of the `wave` clip in the glb. Speed = clip / period. */
  swellClipS: 10,
  /** No extra heave. The mesh itself is the swell, so peaks stay put. */
  swellM: 0,
  swellSeconds: 10,
  /** Dense centre square, half-extent (m). Desktop step is swellNearStepM. */
  swellNearM: 640,
  swellNearStepM: 8,
  /** Middle ring, half-extent (m). Continues the same wave at a coarser step. */
  swellMidM: 1280,
  swellMidStepM: 16,
  /** Outer ring, half-extent (m). Displacement eases to 0 at this edge. */
  swellFarM: 1984,
  swellFarStepM: 32,
  /** Mobile centre step (m). One mesh, same footprint as the near square, faded at its edge. */
  swellMobileStepM: 16,
  /** Mobile amplitude starts easing this far inside the lite mesh edge. */
  swellMobileFadeM: 220,
  swellNearSrc: 'assets/models/water-swell-near.glb',
  swellMidSrc: 'assets/models/water-swell-mid.glb',
  swellFarSrc: 'assets/models/water-swell-far.glb',
  swellLiteSrc: 'assets/models/water-swell-lite.glb',
  flatSrc: 'assets/models/water-flat.glb',
  flatLiteSrc: 'assets/models/water-flat-lite.glb',
}

export const WATER_FOG = {
  /**
   * Global exponential fog. Off. Density would grey the arena; the component
   * cannot start part-way out (no linear start/end in PBEnvironmentFog).
   */
  environment: false,
  density: 0,
  /** Sky colour the rim fades toward. Not used while environment is off. */
  color: { r: 0.55, g: 0.7, b: 0.84 },
  /** Vertical cards at the parcel edge. Off: they read as walls. */
  skirt: false,
  skirtHeightM: 90,
  skirtSrc: 'assets/textures/water-skirt.png',
  /** Full-sea sheet. Off: it was the grey layer over the arena. */
  mist: false,
  mistAboveM: 14,
  mistColor: { r: 0.05, g: 0.28, b: 0.7, a: 0.06 },
  /** Flat outer sea. UV 0 is the swell colour, UV 1 is the sky colour. */
  horizonSrc: 'assets/textures/water-horizon.png',
  /**
   * Short inward curtain near the parcel edge. Transparent at the top and
   * at the waterline, so it reads as horizon haze rather than a wall.
   */
  horizon: true,
  horizonRadiusM: 2300,
  horizonHeightM: 42,
  horizonSegments: 48,
  horizonSrcVeil: 'assets/textures/water-veil.png',
  horizonColor: { r: 0.55, g: 0.7, b: 0.84, a: 0.4 },
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

/** World Y of a crest. The morph is normalised to ±1, then scaled by the amplitude. */
export function swellPeakY(surfaceY: number): number {
  return surfaceY + WATER.swellAmplitudeM + Math.max(0, WATER.swellM)
}

/** World Y of a trough. */
export function swellTroughY(surfaceY: number): number {
  return surfaceY - WATER.swellAmplitudeM
}
