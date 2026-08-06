// ─── Draw-call stress test ───────────────────────────────────────────
// Throwaway. Answers Squareoff design doc §8.1: "Does DCL SDK7 batch
// same-material planes across entities?"
//
// Spawns N MeshRenderer.setPlane entities in a flat NxN grid at spawn,
// all sharing one PBR material (engine should dedupe). Displays a live
// FPS counter as a floating 3D TextShape.
//
// Usage: from index.ts main(), when STRESS_COUNT > 0, call
// `runStress(STRESS_COUNT)` and RETURN (skip maze setup).
//
// Interpret results (single-parcel-density baseline: expect ~60 fps idle):
//   5k planes  ok        → 1m cells are viable
//   5k tanks             → drop to 2m cells (design doc mitigation)
//   30k playable         → we're golden for a full 100-parcel maze

import { engine, Transform, MeshRenderer, Material, TextShape, Billboard } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

export function runStress(count: number) {
  // Lay planes out in a square grid, 1m spacing, centered near spawn (8,0,8).
  const side = Math.ceil(Math.sqrt(count))
  const spacing = 1
  const originX = 8 - (side * spacing) / 2
  const originZ = 8 - (side * spacing) / 2
  const y = 0.05

  // Face-up planes (rotate -90° on X so the plane lies flat).
  const flatRot = Quaternion.fromEulerDegrees(-90, 0, 0)

  let spawned = 0
  for (let i = 0; i < side && spawned < count; i++) {
    for (let j = 0; j < side && spawned < count; j++) {
      const e = engine.addEntity()
      Transform.create(e, {
        position: Vector3.create(originX + i * spacing, y, originZ + j * spacing),
        rotation: flatRot,
        scale: Vector3.create(0.95, 0.95, 1), // small gap so we can see individual tiles
      })
      MeshRenderer.setPlane(e)
      // Single shared material — engine should batch these into few draw calls.
      Material.setPbrMaterial(e, { albedoColor: Color4.create(1, 0.2, 0.3, 1) })
      spawned++
    }
  }

  // FPS readout: floating text above spawn, billboarded to camera.
  const fpsEnt = engine.addEntity()
  Transform.create(fpsEnt, { position: Vector3.create(8, 3, 8) })
  Billboard.create(fpsEnt)
  TextShape.create(fpsEnt, { text: `STRESS: ${spawned} planes\n-- fps`, fontSize: 4 })

  // Rolling FPS: sample dt over the last ~30 frames.
  const samples: number[] = []
  const WINDOW = 60
  engine.addSystem((dt: number) => {
    samples.push(dt)
    if (samples.length > WINDOW) samples.shift()
    // Update the label once per ~half-second to avoid spam.
    if (samples.length % 30 === 0) {
      const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length
      const fps = 1 / avgDt
      const tx = TextShape.getMutable(fpsEnt)
      tx.text = `STRESS: ${spawned} planes\n${fps.toFixed(1)} fps`
    }
  })

  console.log(`[stress] spawned ${spawned} plane entities`)
}
