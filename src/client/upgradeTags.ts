/**
 * upgradeTags.ts — black upgrade silhouettes above other players' nametags.
 *
 * AvatarNametag is text-only, so this is a separate Y-billboarded row
 * attached just above the plate (AvatarAttach on AAPT_NAME_TAG), the
 * same follow style as the Classic ghost team plates. Quantity is shown
 * by repeating the icon, grouped Speed, Paint, then Haste.
 *
 * Levels are server-authoritative (`upgradeBuffs`). The row is hidden
 * on your own avatar (avoids first-person clutter), and bots never get
 * upgrades so they show nothing. A fall wipe, round end, or the lobby
 * clears the row, same as the top HUD buff tiles.
 */

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  Billboard,
  BillboardMode,
  AvatarAttach,
  AvatarAnchorPointType,
  PlayerIdentityData,
  TextureFilterMode,
  TextureWrapMode,
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { events } from '../shared/events'
import { isLobbyLayout } from '../maze/rebuild'
import type { UpgradeKind } from '../shared/upgrades'

const ICON_SRC: Record<UpgradeKind, string> = {
  speed: 'assets/images/world/upgrade-tag-speed.png',
  paint: 'assets/images/world/upgrade-tag-paint.png',
  haste: 'assets/images/world/upgrade-tag-haste.png',
}
const KIND_ORDER: UpgradeKind[] = ['speed', 'paint', 'haste']

/** World metres per icon plane: about the cap height of an AvatarNametag letter. */
const ICON_M = 0.13
const GAP_M = 0.02
/** Rise above the AAPT_NAME_TAG anchor so the row sits just over the plate. */
const ROW_Y_M = 0.16
const PASS_INTERVAL_S = 0.5

type Buffs = { speed: number; paint: number; haste: number }

const levels = new Map<string, Buffs>()
type Rig = { anchor: Entity; row: Entity; icons: Entity[]; key: string; avatarId: string }
const rigs = new Map<string, Rig>()

function keyOf(id: string): string {
  return id.toLowerCase()
}

function localId(): string {
  const fromPlayer = (getPlayer()?.userId ?? '').toLowerCase()
  if (fromPlayer) return fromPlayer
  const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  return (pid?.address ?? '').toLowerCase()
}

function isLocalUser(id: string): boolean {
  const me = localId()
  return !!me && me === id
}

function remoteAvatarId(id: string): string | null {
  for (const [, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (pid.address.toLowerCase() === id) return pid.address
  }
  return null
}

function totalOf(b: Buffs): number {
  return b.speed + b.paint + b.haste
}

function countKey(b: Buffs): string {
  return `${b.speed},${b.paint},${b.haste}`
}

function iconMaterial(src: string) {
  const tex = Material.Texture.Common({
    src,
    wrapMode: TextureWrapMode.TWM_CLAMP,
    filterMode: TextureFilterMode.TFM_BILINEAR,
  })
  return {
    texture: tex,
    alphaTexture: tex,
    alphaTest: 0.4,
    castShadows: false,
  }
}

function destroyRig(id: string): void {
  const rig = rigs.get(id)
  if (!rig) return
  for (const ent of rig.icons) engine.removeEntity(ent)
  engine.removeEntity(rig.row)
  if (AvatarAttach.has(rig.anchor)) AvatarAttach.deleteFrom(rig.anchor)
  engine.removeEntity(rig.anchor)
  rigs.delete(id)
}

function clearRigs(): void {
  for (const id of [...rigs.keys()]) destroyRig(id)
}

function clearAll(): void {
  clearRigs()
  levels.clear()
}

function buildRow(id: string, avatarId: string, buffs: Buffs): void {
  const parts: UpgradeKind[] = []
  for (const kind of KIND_ORDER) {
    const n = buffs[kind]
    for (let i = 0; i < n; i++) parts.push(kind)
  }
  if (parts.length === 0) return

  const anchor = engine.addEntity()
  AvatarAttach.create(anchor, {
    avatarId,
    anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG,
  })

  const row = engine.addEntity()
  Transform.create(row, {
    parent: anchor,
    position: Vector3.create(0, ROW_Y_M, 0),
  })
  Billboard.create(row, { billboardMode: BillboardMode.BM_Y })

  const span = parts.length * ICON_M + (parts.length - 1) * GAP_M
  const x0 = -span / 2 + ICON_M / 2
  const icons: Entity[] = []
  for (let i = 0; i < parts.length; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, {
      parent: row,
      position: Vector3.create(x0 + i * (ICON_M + GAP_M), 0, 0),
      scale: Vector3.create(ICON_M, ICON_M, 1),
    })
    MeshRenderer.setPlane(ent)
    Material.setBasicMaterial(ent, iconMaterial(ICON_SRC[parts[i]]))
    icons.push(ent)
  }

  rigs.set(id, { anchor, row, icons, key: countKey(buffs), avatarId })
}

function applyOne(id: string): void {
  if (isLocalUser(id) || isLobbyLayout()) {
    destroyRig(id)
    return
  }
  const buffs = levels.get(id)
  if (!buffs || totalOf(buffs) === 0) {
    destroyRig(id)
    return
  }
  const avatarId = remoteAvatarId(id)
  if (!avatarId) {
    destroyRig(id)
    return
  }
  const existing = rigs.get(id)
  if (existing && existing.key === countKey(buffs) && existing.avatarId === avatarId) return
  destroyRig(id)
  buildRow(id, avatarId, buffs)
}

function applyPass(): void {
  const ids = new Set<string>([...levels.keys(), ...rigs.keys()])
  for (const id of ids) applyOne(id)
}

function applyBuffs(reset: boolean, entries: Array<{ id: string; speed: number; paint: number; haste: number }>): void {
  if (reset) {
    clearRigs()
    levels.clear()
  }
  for (const e of entries) {
    const id = keyOf(e.id)
    if (!id || id.startsWith('bot:')) continue
    const buffs = {
      speed: Math.max(0, e.speed | 0),
      paint: Math.max(0, e.paint | 0),
      haste: Math.max(0, e.haste | 0),
    }
    if (totalOf(buffs) === 0) levels.delete(id)
    else levels.set(id, buffs)
  }
  applyPass()
}

export function initUpgradeTags(): void {
  events.on('upgrade:buffs', ({ reset, entries }) => {
    applyBuffs(reset, entries)
  })
  events.on('lobby:floor', () => {
    clearAll()
  })
  events.on('round:reset', () => {
    clearAll()
  })
  events.on('round:ended', () => {
    clearAll()
  })
  let clock = 0
  engine.addSystem((dt: number) => {
    clock += dt
    if (clock < PASS_INTERVAL_S) return
    clock = 0
    applyPass()
  })
}
