/**
 * Ocean under the sky arena. Numbers only. `src/client/water.ts` reads them.
 *
 * The surface stays below the Lakitu line. Nothing here has a collider.
 *
 * Explorers clip meshes outside the parcel box. The sea is sized a few
 * metres inside the scene. `landscapeTerrain: false` drops the default
 * trees on a World.
 *
 * Swells are a displaced mesh with a plain color. Ripple and foam maps
 * exist behind `SURFACE.ripple` and `SURFACE.foam` (both off). The files under
 * assets/models/water-swell*.glb and water-flat*.glb are built from the
 * wavelength, amplitude and ring sizes. Mesh UVs are metres / rippleTileM,
 * so changing that tile means a rebuild. After changing those, run
 * `npx tsx scripts/build-water-swell.ts`. The crest height is baked so the
 * geometric normals match the real slope. Period is the clip length.
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

/**
 * Midday water is a step deeper than the halfway tone {0.24, 0.44, 0.77},
 * so the glossy swell does not wash out. Rim and haze stay the pale horizon.
 */
export const HORIZON_TONES: Record<'midday' | 'sunset', { water: Rgb; rim: Rgb; haze: Rgb }> = {
  midday: {
    water: { r: 0.2, g: 0.4, b: 0.74, a: 1 },
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
  /**
   * Mean height. With ±55 m the crest is ~169 (about 9 m under L-1 at 178)
   * and the trough is ~59, still above the floor. The old mean of 78 would
   * put a wave this tall through y 0 or leave the crest too low.
   */
  heightY: LEVEL_Y_OFFSET + 14,
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
  metallic: 0,
  /** Matte enough that ridges do not turn into white streaks. Slope comes from the swell mesh. */
  roughness: 0.48,
  /** Moderate. 1 is the engine default. */
  specular: 0.4,
  /** Solid albedo so the swell and the rim share one texture path. */
  colorSrc: 'assets/textures/water-blue.png',
  /**
   * Half the peak-to-trough of the combined sea (m). 55 → 110 m from trough
   * to crest. Baked into the morph, not a Y scale, so the normals match.
   * Crests stay under the lowest floor. See resolvedWaterY.
   */
  swellAmplitudeM: 55,
  /** Seconds for one shared cycle of every train. Longer waves travel further per cycle. */
  swellPeriodS: 36,
  /** Length of the `wave` clip in the glb. Speed = clip / period. */
  swellClipS: 36,
  /** No extra heave. The mesh itself is the swell, so peaks stay put. */
  swellM: 0,
  swellSeconds: 10,
  /** Dense centre square, half-extent (m). Desktop step is swellNearStepM. */
  swellNearM: 640,
  /** 32 m is the grid the preview already drew (about 1,700 verts). 8 m made a 5 MB morph file it did not draw. */
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
  /** The meshes from ba05fa0, which the preview did draw. 48 m waves. */
  swell48NearSrc: 'assets/models/water-swell-48-near.glb',
  swell48MidSrc: 'assets/models/water-swell-48-mid.glb',
  swell48FarSrc: 'assets/models/water-swell-48-far.glb',
  swell48LiteSrc: 'assets/models/water-swell-48-lite.glb',
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
  { wavelengthM: 360, weight: 0.52, dirDeg: 16, phase: 0.4 },
  { wavelengthM: 280, weight: 0.3, dirDeg: 48, phase: 1.7 },
  { wavelengthM: 320, weight: 0.18, dirDeg: 80, phase: 2.9 },
]

/**
 * Which swell files to spawn. `48m` is the ba05fa0 set, placed at the
 * current mean (y 114). `110m` is the tall set. The 110 m files stay in
 * the repo either way.
 */
export const SWELL_VARIANT: '48m' | '110m' = '48m'

/** The ba05fa0 trains. The live 48 m meshes were built from these, not from SWELL_TRAINS. */
export const SWELL_TRAINS_48: Array<{ wavelengthM: number; weight: number; dirDeg: number; phase: number }> = [
  { wavelengthM: 720, weight: 0.84, dirDeg: 15, phase: 0.4 },
  { wavelengthM: 480, weight: 0.1, dirDeg: 48, phase: 1.8 },
  { wavelengthM: 600, weight: 0.06, dirDeg: 80, phase: 3.1 },
]
export const SWELL_48_AMPLITUDE_M = 24
export const SWELL_48_PERIOD_S = 45

/** Looping ocean bed. Global, started once. Kept under the trumpets and hits. */
export const OCEAN_AMBIENCE_VOLUME = 0.2
export const OCEAN_AMBIENCE_SRC = 'assets/sounds/ocean.mp3'

/**
 * Surface detail on the swell meshes. Ripple scale is baked into the mesh
 * UVs (`rippleTileM`). The foam sheet is a second copy of the same morph
 * clip, lifted a little, and its tile is a runtime texture scale.
 * Sticker rings and whitecap blobs stay off (`FOAM.rings`, `FOAM.whitecaps`).
 */
export const SURFACE = {
  /** Off. The 8 m normal read as a repeating bubbly grid. The swell is a plain color. */
  ripple: false,
  /** Flat white. The tint is `WATER_COLOR`. Scrolling this is what drags the normal map. */
  albedoSrc: 'assets/textures/water-white.png',
  rippleSrc: 'assets/textures/water-ripple-normal.png',
  /** Metres per ripple repeat. Baked into TEXCOORD. Rebuild after changing. */
  rippleTileM: 8,
  /** Scroll direction, not necessarily unit length. */
  rippleDirX: 0.82,
  rippleDirZ: 0.42,
  /** UV repeats per second. At 8 m per repeat this is about half a metre per second. */
  rippleSpeed: 0.07,
  /** Off. The veil sat on the bubbly normal and did not read as foam. */
  foam: false,
  foamSrc: 'assets/textures/water-foam.png',
  /** Multiplier on the baked ripple UVs. 0.3 makes foam streaks about 27 m across. */
  foamTile: 0.3,
  foamAlpha: 0.28,
  /** Metres above the swell mesh. The morph still matches, so the sheet stays on the surface. */
  foamLiftM: 0.4,
  foamDirX: -0.25,
  foamDirZ: 0.92,
  foamSpeed: 0.018,
  /** The extra morph draw is the heavy part. Mobile keeps ripples and skips this sheet. */
  mobileFoam: false,
}

/**
 * Wet-look switches. Each one is independent.
 * `gloss` is the swell only; the rim keeps `WATER.roughness`.
 * `softNormal` is near, mid, and the mobile lite mesh. The far ring and the
 * flat rim stay un-bumped so the horizon does not grow a lighting seam.
 * `depth` is off. Near/mid at alpha 0.85 ended on the opaque far ring and the
 * pale rim, and that handoff read as flat light patches. The sheet and the
 * alpha path stay here for a later try.
 */
export const LOOK = {
  gloss: true,
  glossRoughness: 0.3,
  glossSpecular: 0.9,
  /** Cooler and lighter than the body, so the sun streaks without turning the sea white. */
  glossReflectivity: { r: 0.55, g: 0.72, b: 0.86 },
  softNormal: true,
  softNormalSrc: 'assets/textures/water-soft-normal.png',
  /** Metres per repeat. Baked into swell TEXCOORD. bumpTexture ignores its own tiling. */
  softNormalTileM: 120,
  softNormalDirX: 1,
  softNormalDirZ: 0.2,
  /** UV repeats per second. At 120 m a repeat this is about 0.4 m/s. */
  softNormalSpeed: 0.003,
  /** Off. The clear near/mid layer showed the opaque far ring and pale rim through the handoff. */
  depth: false,
  depthAlpha: 0.85,
  /** Metres under the lowest trough of the live swell. */
  depthBelowTroughM: 4,
  depthColor: { r: 0.015, g: 0.06, b: 0.16, a: 1 },
}

export const FOAM = {
  /** Parked. The rings read as pinwheel stickers, so they do not spawn. */
  rings: false,
  ringSrc: 'assets/textures/water-foam-ring.png',
  /** Parked. The crest blobs read as floating stickers, so they do not spawn. */
  whitecapSrc: 'assets/textures/water-whitecap.png',
  whitecaps: false,
  whitecapCount: 24,
  whitecapSizeM: 40,
  whitecapThickM: 22,
  whitecapLiftM: 2.2,
  /** Plane width (m). The pillar shaft is 20 m across. */
  ringSizeM: 48,
  /** Metres above the analytic surface, so the decal doesn't sink into the swell. */
  ringLiftM: 2,
  baseAlpha: 0.9,
  /** Added when the surface is at a crest (crest factor 0..1). */
  crestBoost: 0.1,
  spinDegPerSec: 6,
  pulse: 0.06,
  pulseSeconds: 5,
  scrollPerSec: 0.03,
  /** Mobile keeps the rings closest to centre. */
  mobileMax: 12,
  maxRings: 40,
}

export function swellMesh(part: 'near' | 'mid' | 'far' | 'lite'): string {
  if (SWELL_VARIANT === '48m') {
    if (part === 'near') return WATER.swell48NearSrc
    if (part === 'mid') return WATER.swell48MidSrc
    if (part === 'far') return WATER.swell48FarSrc
    return WATER.swell48LiteSrc
  }
  if (part === 'near') return WATER.swellNearSrc
  if (part === 'mid') return WATER.swellMidSrc
  if (part === 'far') return WATER.swellFarSrc
  return WATER.swellLiteSrc
}

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
  /** One ring at the horizon. The pale sea was not the missing-swell bug. */
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
export function resolvedWaterY(minY: number, _fallDrop: number): number {
  // Crests are allowed above the fixed rescue line. They stay under L-1.
  const crestCap = minY - 8
  const maxMean = crestCap - WATER.swellAmplitudeM - Math.max(0, WATER.swellM)
  return Math.min(WATER.heightY, maxMean)
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
