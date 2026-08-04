/**
 * botVisual.ts — client-side bot renderer.
 *
 * Subscribes to the server's 2 Hz botPositions broadcast and maintains
 * one box entity per bot, team-colored. Bots are pooled so we never
 * churn entities as the population scales up/down between rounds.
 *
 * No animation smoothing yet — box teleports to the new position each
 * update (500ms between messages, ~1m per step visually). If it feels
 * jarring we'll add a Tween interpolation in a follow-up.
 */

import { engine, Entity, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { events } from '../shared/events'

const RED  = Color4.create(255/255, 117/255, 119/255, 1)
const BLUE = Color4.create(106/255, 153/255, 252/255, 1)

const BOX_SIZE = 1.2 // metres — visible from a distance but not obtrusive
const BOX_Y_OFFSET = 0.6 // half box height so it sits ON the surface

interface BotEntity {
  entity: Entity
  team: number
}

// Keyed by bot id (stable per bot, server-assigned).
const botEntities = new Map<number, BotEntity>()

function createBotEntity(team: number): Entity {
  const e = engine.addEntity()
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, {
    albedoColor: team === 1 ? RED : BLUE,
    emissiveColor: team === 1 ? RED : BLUE,
    emissiveIntensity: 0.4,
    roughness: 0.6,
    metallic: 0.0,
  })
  return e
}

export function initBotVisual(): void {
  events.on('bots:positions', ({ bots }) => {
    const seenIds = new Set<number>()
    for (const b of bots) {
      seenIds.add(b.id)
      let rec = botEntities.get(b.id)
      if (!rec || rec.team !== b.team) {
        // New bot, or team changed (retired + respawned with same id — unlikely
        // but safe). Rebuild the entity so the material is right.
        if (rec) engine.removeEntity(rec.entity)
        const entity = createBotEntity(b.team)
        rec = { entity, team: b.team }
        botEntities.set(b.id, rec)
      }
      Transform.createOrReplace(rec.entity, {
        position: Vector3.create(b.x, b.y + BOX_Y_OFFSET, b.z),
        scale: Vector3.create(BOX_SIZE, BOX_SIZE, BOX_SIZE),
        rotation: Quaternion.Identity(),
      })
    }
    // Reap bots the server dropped (id no longer in the broadcast).
    for (const [id, rec] of botEntities) {
      if (!seenIds.has(id)) {
        engine.removeEntity(rec.entity)
        botEntities.delete(id)
      }
    }
  })
}
