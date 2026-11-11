/**
 * Prototype depot posts. The same graph the server uses, so the posts
 * sit on the anchors. Colour follows the anchor cell. A friendly post
 * fills the local tank while you stand on it; the server is the authority.
 */
import { engine, Entity, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { baseSpawn, getPlacedTilesInOrder } from '../maze/generator'
import { isRebuilding } from '../maze/rebuild'
import { buildWalkableGraph, type WalkableGraph } from '../shared/mazeGraph'
import { Team, TEAM_RGB } from '../shared/team'
import { nearestNode, onDepot, placeDepots, type DepotAnchor } from '../shared/territory'
import { getCurrentCellId, paintEconomyOn, paintTeamOf, painterTeam, predictDepotRefill } from '../paint'
import { inLobby } from './phase'

const NEUTRAL = { r: 0.93, g: 0.93, b: 0.9 }
type Post = { ent: Entity; id: string; pulse: number; team: Team }

let posts: Post[] = []
let builtFor = ''
let graph: WalkableGraph | null = null

function tint(team: Team, glow: number) {
  const c = team === Team.Red || team === Team.Blue ? TEAM_RGB[team] : NEUTRAL
  return {
    albedoColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: glow,
    roughness: 0.6,
    metallic: 0,
    castShadows: false,
  }
}

function clearPosts(): void {
  for (const p of posts) engine.removeEntity(p.ent)
  posts = []
  builtFor = ''
  graph = null
}

function anchorsOf(g: WalkableGraph): DepotAnchor[] {
  const redAt = baseSpawn(1).pos
  const blueAt = baseSpawn(2).pos
  const red = nearestNode(g, redAt.x, redAt.y, redAt.z)
  const blue = nearestNode(g, blueAt.x, blueAt.y, blueAt.z)
  if (!red || !blue) return []
  return placeDepots(g, red, blue)
}

function ensurePosts(): void {
  const tiles = getPlacedTilesInOrder()
  if (tiles.length < 8) {
    if (posts.length) clearPosts()
    return
  }
  const key = `${tiles.length}:${tiles[0]?.x},${tiles[0]?.z}:${tiles[tiles.length - 1]?.x},${tiles[tiles.length - 1]?.z}`
  if (key === builtFor && graph) return
  clearPosts()
  graph = buildWalkableGraph(tiles)
  const list = anchorsOf(graph)
  builtFor = key
  for (const d of list) {
    const p = graph.worldPos.get(d.id)
    if (!p) continue
    const ent = engine.addEntity()
    const team = d.owner === 1 ? Team.Red : d.owner === 2 ? Team.Blue : Team.None
    Transform.create(ent, {
      position: Vector3.create(p[0], p[1] + 1.7, p[2]),
      scale: Vector3.create(0.7, 3.2, 0.7),
    })
    MeshRenderer.setCylinder(ent)
    Material.setPbrMaterial(ent, tint(team, team === Team.None ? 0.4 : 1.4))
    posts.push({ ent, id: d.id, pulse: 0, team })
  }
}

function recolor(dt: number): void {
  if (!graph) return
  const here = getCurrentCellId()
  const mine = painterTeam()
  let friendly = false
  for (const post of posts) {
    const owned = paintTeamOf(post.id)
    const shown = owned !== Team.None ? owned : post.team
    if (shown !== post.team) {
      post.pulse = 0.4
      post.team = shown
    }
    if (post.pulse > 0) post.pulse = Math.max(0, post.pulse - dt)
    const tr = Transform.getMutableOrNull(post.ent)
    if (tr) {
      const s = 1 + post.pulse
      tr.scale = Vector3.create(0.7 * s, 3.2, 0.7 * s)
    }
    Material.setPbrMaterial(post.ent, tint(post.team, post.team === Team.None ? 0.35 : 1.2 + post.pulse * 4))
    if (here && mine !== Team.None && post.team === mine && onDepot(graph, here, post.id)) friendly = true
  }
  predictDepotRefill(dt, friendly)
}

export function initDepots(): void {
  engine.addSystem((dt: number) => {
    if (!paintEconomyOn() || inLobby() || isRebuilding()) {
      if (posts.length) clearPosts()
      predictDepotRefill(dt, false)
      return
    }
    ensurePosts()
    recolor(dt)
  })
}
