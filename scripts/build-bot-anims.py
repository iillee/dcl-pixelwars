#!/usr/bin/env python3
"""Build the bot air-pose emotes and the glider mesh.

Sources (Decentraland explorer, same clips a human plays):
  godot-explorer  godot/assets/no-export/locomotion/Avatar_Locomotion_Fix.glb
                  Jump_Rise_Loop, Jump_Fall_Loop, Slide
  bevy-explorer   crates/assets/src/assets/animations/double_jump.glb
                  Double_Jump_Base
  bevy-explorer   crates/assets/src/assets/animations/glide.glb
                  Glide_Avatar, and the Glider_Final mesh (player glider prop)

AvatarShape cannot drive the player's jump/glide animator (Unity forces scene
avatars grounded; Godot hides the built-in glider on them). These files are the
same skeleton and the same glider mesh, played as scene emotes plus a prop.
"""
import json
import struct
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_EMOTES = ROOT / 'assets' / 'emotes'
OUT_MODELS = ROOT / 'assets' / 'models'
CACHE = Path('/tmp/assets')

LOCO_URL = 'https://raw.githubusercontent.com/decentraland/godot-explorer/main/godot/assets/no-export/locomotion/Avatar_Locomotion_Fix.glb'
DOUBLE_URL = 'https://raw.githubusercontent.com/decentraland/bevy-explorer/main/crates/assets/src/assets/animations/double_jump.glb'
GLIDE_URL = 'https://raw.githubusercontent.com/decentraland/bevy-explorer/main/crates/assets/src/assets/animations/glide.glb'

COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
CT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def fetch(url: str, name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / name
    if not dest.exists() or dest.stat().st_size < 1000:
        urllib.request.urlretrieve(url, dest)
    return dest


def load_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b'glTF':
        raise SystemExit(f'{path} is not a glb')
    off = 12
    clen, ctype = struct.unpack_from('<II', data, off)
    js = json.loads(data[off + 8:off + 8 + clen])
    off = 12 + 8 + clen
    while off % 4:
        off += 1
    blen, btype = struct.unpack_from('<II', data, off)
    blob = data[off + 8:off + 8 + blen]
    return js, blob


def save_glb(path: Path, js: dict, blob: bytes) -> None:
    js = dict(js)
    js['buffers'] = [{'byteLength': len(blob)}]
    raw = json.dumps(js, separators=(',', ':')).encode()
    raw += b' ' * ((4 - len(raw) % 4) % 4)
    bin_pad = b'\x00' * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(raw) + 8 + len(blob) + len(bin_pad)
    out = bytearray()
    out += struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<I4s', len(raw), b'JSON')
    out += raw
    out += struct.pack('<I4s', len(blob) + len(bin_pad), b'BIN\x00')
    out += blob + bin_pad
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def accessor_bytes(js, blob, index: int) -> tuple[bytes, int | None]:
    acc = js['accessors'][index]
    bv = js['bufferViews'][acc['bufferView']]
    comps = COMPONENTS[acc['type']]
    elem = comps * CT_SIZE[acc['componentType']]
    stride = acc.get('byteStride') or bv.get('byteStride') or elem
    count = acc['count']
    nbytes = (count - 1) * stride + elem if count else 0
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    view_stride = stride if stride != elem else None
    return blob[start:start + nbytes], view_stride


def pack_raw(pack: 'Repack', raw: bytes, typ: str, component: int, count: int, amin, amax) -> int:
    while len(pack.out) % 4:
        pack.out.append(0)
    off = len(pack.out)
    pack.out += raw
    pack.views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)})
    acc = {'bufferView': len(pack.views) - 1, 'componentType': component, 'count': count, 'type': typ}
    if amin is not None:
        acc['min'] = amin
        acc['max'] = amax
    pack.accessors.append(acc)
    return len(pack.accessors) - 1


class Repack:
    def __init__(self, js, blob):
        self.js = js
        self.blob = blob
        self.map = {}
        self.accessors = []
        self.views = []
        self.out = bytearray()

    def take(self, index: int) -> int:
        if index in self.map:
            return self.map[index]
        acc = self.js['accessors'][index]
        raw, stride = accessor_bytes(self.js, self.blob, index)
        while len(self.out) % 4:
            self.out.append(0)
        off = len(self.out)
        self.out += raw
        view = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if stride:
            view['byteStride'] = stride
        src_view = self.js['bufferViews'][acc['bufferView']]
        if 'target' in src_view:
            view['target'] = src_view['target']
        self.views.append(view)
        copied = {k: v for k, v in acc.items() if k not in ('bufferView', 'byteOffset', 'byteStride')}
        copied['bufferView'] = len(self.views) - 1
        self.accessors.append(copied)
        self.map[index] = len(self.accessors) - 1
        return self.map[index]


def bone_nodes(js):
    """Skeleton only. Mesh nodes would ship the reference body."""
    nodes = []
    for n in js['nodes']:
        keep = {'name': n.get('name', '')}
        for k in ('translation', 'rotation', 'scale', 'children'):
            if k in n:
                keep[k] = n[k]
        nodes.append(keep)
    return nodes


def emote_from(src: Path, anim_name: str, dest: Path, hold: float | None = None, at: float = 1.0) -> float:
    js, blob = load_glb(src)
    anim = next(a for a in js['animations'] if a['name'] == anim_name)
    pack = Repack(js, blob)
    samplers = []
    for s in anim['samplers']:
        if hold is None:
            samplers.append({
                'input': pack.take(s['input']),
                'output': pack.take(s['output']),
                'interpolation': s.get('interpolation', 'LINEAR'),
            })
            continue
        # Two identical keys so a short settle clip holds the final pose.
        out_acc = js['accessors'][s['output']]
        if out_acc['componentType'] != 5126:
            raise SystemExit(f'{anim_name} hold expects float keys')
        raw, stride = accessor_bytes(js, blob, s['output'])
        comps = COMPONENTS[out_acc['type']]
        elem = comps * 4
        step = stride or elem
        # A moving AvatarShape drops a playing emote, so the clip is restarted
        # every frame and only its first key is seen. That key is the pose.
        idx = min(out_acc['count'] - 1, max(0, round(at * (out_acc['count'] - 1))))
        last = raw[idx * step:idx * step + elem]
        last_vals = list(struct.unpack('<' + 'f' * comps, last))
        times = struct.pack('<ff', 0.0, hold)
        samplers.append({
            'input': pack_raw(pack, times, 'SCALAR', 5126, 2, [0.0], [hold]),
            'output': pack_raw(pack, last + last, out_acc['type'], 5126, 2, last_vals, last_vals),
            'interpolation': 'LINEAR',
        })
    channels = []
    for ch in anim['channels']:
        channels.append({
            'sampler': ch['sampler'],
            'target': {'node': ch['target']['node'], 'path': ch['target']['path']},
        })
    skins = []
    for skin in js.get('skins', []):
        copied = {'joints': skin['joints'], 'name': skin.get('name', 'Armature')}
        if 'inverseBindMatrices' in skin:
            copied['inverseBindMatrices'] = pack.take(skin['inverseBindMatrices'])
        skins.append(copied)
    duration = hold or 0.0
    if hold is None:
        for s in anim['samplers']:
            acc = js['accessors'][s['input']]
            if 'max' in acc:
                duration = max(duration, max(acc['max']))
    out = {
        'asset': {'version': '2.0', 'generator': 'pixelwars build-bot-anims'},
        'scene': 0,
        'scenes': js['scenes'],
        'nodes': bone_nodes(js),
        'skins': skins,
        'animations': [{'name': 'Animation', 'samplers': samplers, 'channels': channels}],
        'accessors': pack.accessors,
        'bufferViews': pack.views,
    }
    save_glb(dest, out, bytes(pack.out))
    return duration


def build_glider(src: Path, dest: Path) -> None:
    js, blob = load_glb(src)
    # Open pose: the middle Glide_Prop key (near rest, wings out).
    prop = next(a for a in js['animations'] if a['name'] == 'Glide_Prop')
    baked = {}
    for ch in prop['channels']:
        sampler = prop['samplers'][ch['sampler']]
        out_i = sampler['output']
        raw, _ = accessor_bytes(js, blob, out_i)
        acc = js['accessors'][out_i]
        comps = COMPONENTS[acc['type']]
        # FLOAT
        count = acc['count']
        vals = struct.unpack('<' + 'f' * (count * comps), raw[:count * comps * 4])
        mid = count // 2
        baked[ch['target']['path']] = list(vals[mid * comps:(mid + 1) * comps])

    mesh_index = next(i for i, n in enumerate(js['nodes']) if n.get('name') == 'Glider_Final')
    mesh = js['meshes'][js['nodes'][mesh_index]['mesh']]
    prim = mesh['primitives'][0]
    pack = Repack(js, blob)
    attrs = {k: pack.take(v) for k, v in prim['attributes'].items()}
    indices = pack.take(prim['indices'])

    # baseColor (image 6) + emissive (image 4). Skip the 1.2 MB normal and the ORM.
    def take_image(image_index: int) -> int:
        im = js['images'][image_index]
        bv = js['bufferViews'][im['bufferView']]
        start = bv.get('byteOffset', 0)
        raw = blob[start:start + bv['byteLength']]
        while len(pack.out) % 4:
            pack.out.append(0)
        off = len(pack.out)
        pack.out += raw
        pack.views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)})
        return len(pack.views) - 1

    emissive_view = take_image(4)
    color_view = take_image(6)
    mat = {
        'name': 'Glider',
        'doubleSided': True,
        'emissiveFactor': [1, 1, 1],
        'emissiveTexture': {'index': 0},
        'extensions': {'KHR_materials_emissive_strength': {'emissiveStrength': 4}},
        'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 1},
            'metallicFactor': 0,
            'roughnessFactor': 0.55,
        },
    }
    root = {'name': 'Root', 'children': [0]}
    if 'translation' in baked:
        root['translation'] = baked['translation']
    if 'rotation' in baked:
        root['rotation'] = baked['rotation']
    out = {
        'asset': {'version': '2.0', 'generator': 'pixelwars build-bot-anims'},
        'extensionsUsed': ['KHR_materials_emissive_strength'],
        'scene': 0,
        'scenes': [{'name': 'Scene', 'nodes': [2]}],
        'nodes': [
            {'name': 'Glider_Final', 'mesh': 0},
            root,
            {'name': 'Armature_Prop', 'children': [1]},
        ],
        'meshes': [{'name': 'Glider', 'primitives': [{'attributes': attrs, 'indices': indices, 'material': 0}]}],
        'materials': [mat],
        'textures': [
            {'sampler': 0, 'source': 0},
            {'sampler': 0, 'source': 1},
        ],
        'images': [
            {'mimeType': 'image/png', 'bufferView': emissive_view, 'name': 'Glider_emissive'},
            {'mimeType': 'image/png', 'bufferView': color_view, 'name': 'Glider_baseColor'},
        ],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': pack.accessors,
        'bufferViews': pack.views,
    }
    save_glb(dest, out, bytes(pack.out))


def merge_prop(emote_path: Path, glider_path: Path) -> None:
    """Hang the glider off Armature_Prop so it only exists while the emote plays."""
    ejs, eblob = load_glb(emote_path)
    gjs, gblob = load_glb(glider_path)
    # The locomotion file already has an empty prop armature. Godot binds the
    # first Armature_Prop it finds, so the empty one must not keep that name.
    for n in ejs['nodes']:
        name = n.get('name', '')
        if name.startswith('Armature_Prop') or name in ('Glider_Final', 'Root'):
            n['name'] = 'Unused_' + name
    base = bytearray(eblob)
    while len(base) % 4:
        base.append(0)
    shift = len(base)
    base += gblob

    def shift_view(view: dict) -> dict:
        copied = dict(view)
        copied['byteOffset'] = view.get('byteOffset', 0) + shift
        return copied

    view_base = len(ejs['bufferViews'])
    acc_base = len(ejs['accessors'])
    mesh_base = len(ejs.get('meshes', []))
    mat_base = len(ejs.get('materials', []))
    tex_base = len(ejs.get('textures', []))
    img_base = len(ejs.get('images', []))
    node_base = len(ejs['nodes'])

    def shift_acc(acc: dict) -> dict:
        copied = dict(acc)
        copied['bufferView'] = acc['bufferView'] + view_base
        return copied

    meshes = []
    for mesh in gjs.get('meshes', []):
        prims = []
        for prim in mesh['primitives']:
            p = {
                'attributes': {k: v + acc_base for k, v in prim['attributes'].items()},
                'indices': prim['indices'] + acc_base,
            }
            if 'material' in prim:
                p['material'] = prim['material'] + mat_base
            prims.append(p)
        meshes.append({'name': mesh.get('name', 'Glider'), 'primitives': prims})

    images = []
    for im in gjs.get('images', []):
        images.append({
            'mimeType': im.get('mimeType', 'image/png'),
            'name': im.get('name', 'glider'),
            'bufferView': im['bufferView'] + view_base,
        })
    textures = []
    for tex in gjs.get('textures', []):
        textures.append({'sampler': 0, 'source': tex['source'] + img_base})

    nodes = []
    for n in gjs['nodes']:
        node = {'name': n.get('name', '')}
        for k in ('translation', 'rotation', 'scale'):
            if k in n:
                node[k] = n[k]
        if 'mesh' in n:
            node['mesh'] = n['mesh'] + mesh_base
        if 'children' in n:
            node['children'] = [c + node_base for c in n['children']]
        nodes.append(node)

    ejs['bufferViews'] = ejs['bufferViews'] + [shift_view(v) for v in gjs['bufferViews']]
    ejs['accessors'] = ejs['accessors'] + [shift_acc(a) for a in gjs['accessors']]
    ejs['meshes'] = ejs.get('meshes', []) + meshes
    ejs['materials'] = ejs.get('materials', []) + gjs.get('materials', [])
    ejs['textures'] = ejs.get('textures', []) + textures
    ejs['images'] = ejs.get('images', []) + images
    if gjs.get('samplers'):
        ejs['samplers'] = gjs['samplers']
    ejs['nodes'] = ejs['nodes'] + nodes
    # Keep the avatar armature. Drop empty prop roots. Add the meshed prop.
    scene_nodes = [i for i in ejs['scenes'][0]['nodes'] if not ejs['nodes'][i].get('name', '').startswith('Unused_')]
    ejs['scenes'][0]['nodes'] = scene_nodes + [len(ejs['nodes']) - 1]
    used = list(ejs.get('extensionsUsed', []))
    for ext in gjs.get('extensionsUsed', []):
        if ext not in used:
            used.append(ext)
    if used:
        ejs['extensionsUsed'] = used
    save_glb(emote_path, ejs, bytes(base))


def main() -> None:
    loco = fetch(LOCO_URL, 'loco.glb')
    double = fetch(DOUBLE_URL, 'double_jump.glb')
    glide = fetch(GLIDE_URL, 'glide.glb')
    # (src, clip, dest, hold seconds, sample fraction). Held so a per-frame
    # restart still shows the pose, not frame 0 of a run-in.
    jobs = [
        (loco, 'Jump_Rise_Loop', OUT_EMOTES / 'bot_jump_emote.glb', 1.0, 0.55),
        (loco, 'Jump_Fall_Loop', OUT_EMOTES / 'bot_fall_emote.glb', 1.0, 0.45),
        (loco, 'Slide', OUT_EMOTES / 'bot_slide_emote.glb', 1.0, 0.4),
        (double, 'Double_Jump_Base', OUT_EMOTES / 'bot_double_emote.glb', 1.0, 0.42),
        (glide, 'Glide_Avatar', OUT_EMOTES / 'bot_glide_emote.glb', 1.0, 1.0),
    ]
    for src, name, dest, hold, at in jobs:
        dur = emote_from(src, name, dest, hold, at)
        print(f'{dest.name}  {name}  {dur:.3f}s  {dest.stat().st_size} bytes')
    gdest = OUT_MODELS / 'glider.glb'
    build_glider(glide, gdest)
    merge_prop(OUT_EMOTES / 'bot_glide_emote.glb', gdest)
    print(f'{gdest.name}  {gdest.stat().st_size} bytes')
    print(f'bot_glide_emote.glb with prop  {(OUT_EMOTES / "bot_glide_emote.glb").stat().st_size} bytes')


if __name__ == '__main__':
    main()
