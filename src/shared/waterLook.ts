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
 * wavelength, amplitude and ring sizes. After changing those, run
 * `npx tsx scripts/build-water-swell.ts`. The crest height is baked so the
 * normals match the real slope. Period is the clip speed.
 *
 * EnvironmentFog (component 1225) is exponential only: color gradient and
 * density, `1 - e^(-density * metres)`. The protocol has no linear mode and
 * no start/end distance, so density stays 0. The horizon is the flat rim
 * plus one seamless haze ring.
 *
 * Colours: `WATER_COLOR`, `RIM_COLOR` and `HAZE_COLOR`. The swell and the
 * haze read them at runtime. The rim mesh only stores a fade mask; those
 * two colours are applied when the scene runs. The mask shape is baked, so
 * changing where the fade starts means re-running
 * `npx tsx scripts/build-water-swell.ts`. The scene does not lock the sky
 * (`src/client/skybox.ts`), and SDK7's SkyboxTime can only set the clock,
 * not read the Explorer's. `SEA_TONE` picks a row; it does not follow sunset.
 */
import { LEVEL_Y_OFFSET } from '../maze/level'

export type Rgb = { r: number; g: number; b: number; a: number }

/** Midday is the applied row: a pale blue horizon, water a step deeper. */
export const HORIZON_TONES: Record<'midday' | 'sunset', { water: Rgb; rim: Rgb; haze: Rgb }> = {
  midday: {
    water: { r: 0.46, g: 0.66, b: 0.82, a: 1 },
    rim: { r: 0.73, g: 0.83, b: 0.91, a: 1 },
    haze: { r: 0.73, g: 0.83, b: 0.91, a: 0.92 },
  },
  sunset: {
    water: { r: 0.76, g: 0.58, b: 0.52, a: 1 },
    rim: { r: 0.91, g: 0.72, b: 0.64, a: 1 },
    haze: { r: 0.91, g: 0.72, b: 0.64, a: 0.92 },
  },
}

export const SEA_TONE: keyof typeof HORIZON_TONES = 'midday'
export const WATER_COLOR: Rgb = HORIZON_TONES[SEA_TONE].water
export const RIM_COLOR: Rgb = HORIZON_TONES[SEA_TONE].rim
export const HAZE_COLOR: Rgb = HORIZON_TONES[SEA_TONE].haze
export const WATER = {
  /**
   * Mean surface height (m). Crests are this plus the amplitude, troughs
   * this minus it. 78 keeps a 48 m swell under the rescue line (~112.5)
   * and above the floor. Do not raise LEVEL_Y_OFFSET: the roof is already
   * at the 200 m sync warning. Fall rescue, bots and anvils use MIN_Y.
   */
  heightY: LEVEL_Y_OFFSET - 22,
  /** Metres of open air kept between the configured mean and the rescue line. */
  clearanceM: 6,
  /**
   * Width of the flat rim (m). 0 means "fill the scene, a few metres inside
   * the parcel box" so the bounds checker does not slice it.
   */
  sizeM: 0,
  /** Pulled in from each scene edge when sizeM is 0. */
  edgeInsetM: 6,
  /** Near water. A step deeper than `RIM_COLOR`, still in the horizon family. */
  color: WATER_COLOR,
  /** Soft sheen. Metallic stays 0 so the highlights do not go white. */
  metallic: 0,
  roughness: 0.48,
  /** 1 is the engine default. */
  specular: 0.4,
  /** Solid albedo so the swell and the rim share one texture path. */
  colorSrc: 'assets/textures/water-blue.png',
  /**
   * Half the peak-to-trough of the combined sea (m). 24 → 48 m from trough
   * to crest. Baked into the morph, not a Y scale, so the normals match.
   */
  swellAmplitudeM: 24,
  /** Seconds for one shared cycle of every train. Longer waves travel further per cycle. */
  swellPeriodS: 28,
  /** Length of the `wave` clip in the glb. Speed = clip / period. */
  swellClipS: 28,
  /** No extra heave. The mesh itself is the swell, so peaks stay put. */
  swellM: 0,
  swellSeconds: 10,
  /** Dense centre square, half-extent (m). Desktop step is swellNearStepM. */
  swellNearM: 640,
  swellNearStepM: 32,
  /** Middle ring, half-extent (m). Continues the same waves at a coarser step. */
  swellMidM: 1280,
  swellMidStepM: 64,
  /** Outer ring, half-extent (m). Displacement eases to 0 at this edge. */
  swellFarM: 2048,
  swellFarStepM: 128,
  /** Mobile centre step (m). One mesh, same footprint as the near square, faded at its edge. */
  swellMobileStepM: 32,
  /** Mobile amplitude starts easing this far inside the lite mesh edge. */
  swellMobileFadeM: 220,
  swellNearSrc: 'assets/models/water-swell-near.glb',
  swellMidSrc: 'assets/models/water-swell-mid.glb',
  swellFarSrc: 'assets/models/water-swell-far.glb',
  swellLiteSrc: 'assets/models/water-swell-lite.glb',
  flatSrc: 'assets/models/water-flat.glb',
  flatLiteSrc: 'assets/models/water-flat-lite.glb',
}

/**
 * Crossing swells. Relative `weight`s are normalised so the combined crest
 * is `swellAmplitudeM`. Directions sit 20–40° apart so the crests do not
 * line up into stripes. All trains share `swellPeriodS`, which lets one
 * looping clip play the sum.
 */
export const SWELL_TRAINS: Array<{
  wavelengthM: number
  weight: number
  dirDeg: number
  phase: number
}> = [
  { wavelengthM: 720, weight: 0.5, dirDeg: 15, phase: 0.4 },
  { wavelengthM: 480, weight: 0.32, dirDeg: 48, phase: 1.8 },
  { wavelengthM: 600, weight: 0.18, dirDeg: 80, phase: 3.1 },
]

export function meanSwellWavelength(): number {
  let sum = 0
  for (const t of SWELL_TRAINS) sum += t.wavelengthM
  return sum / SWELL_TRAINS.length
}

export const WATER_FOG = {
  /**
   * Global exponential fog. Off. Density would grey the arena; the component
   * cannot start part-way out (no linear start/end in PBEnvironmentFog).
   */
  environment: false,
  density: 0,
  /** Sky colour the rim fades toward. Applied at runtime on the rim mask. */
  color: RIM_COLOR,
  /** Vertical cards at the parcel edge. Off: they read as walls. */
  skirt: false,
  skirtHeightM: 90,
  skirtSrc: 'assets/textures/water-skirt.png',
  /** Full-sea sheet. Off: it was the grey layer over the arena. */
  mist: false,
  mistAboveM: 14,
  mistColor: { r: 0.05, g: 0.28, b: 0.7, a: 0.06 },
  /**
   * Rim masks. `horizonSrc` is white at the swell and black at the sky edge
   * (multiplied by `WATER_COLOR`). `horizonGlowSrc` is the opposite
   * (multiplied by `RIM_COLOR`). Recolouring does not require a rebuild.
   */
  horizonSrc: 'assets/textures/water-horizon.png',
  horizonGlowSrc: 'assets/textures/water-horizon-glow.png',
  /**
   * One closed ring, shared vertices, no overlapping cards. Sits just inside
   * the parcel edge, from below the waterline to above eye height (~190).
   * Colour and opacity are `HAZE_COLOR` at runtime. The alpha curve in
   * `hazeMask` is baked.
   */
  haze: true,
  hazeColor: HAZE_COLOR,
  hazeRadiusM: 2360,
  hazeBottomY: 36,
  hazeTopY: 270,
  hazeSrc: 'assets/models/water-haze.glb',
  hazeMask: 'assets/textures/water-haze.png',
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
