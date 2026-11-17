#!/usr/bin/env python3
"""Bake official DCL avatar jump / double-jump / glide clips onto the original
ghost.glb armature (same Avatar_* joint names). Writes ghost-recover.glb.

Hips stay in the ghost's centimetre-scale armature space (rest z ≈ -100).
Official clips already live in that space, so bone rotations transfer directly.
Animator can only play clips embedded in the same GltfContainer GLB.
"""
from __future__ import annotations

import json
import struct
import sys
from collections import defaultdict
from pathlib import Path
from urllib.request import urlretrieve

JSON_CHUNK = b'JSON'
BIN_CHUNK = b'BIN\x00'
FLOAT = 5126


def load_glb(path: Path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:
        raise SystemExit(f'not a GLB: {path}')
    offset = 12
    gltf = None
    blob = b''
    while offset + 8 <= len(data):
        clen, ctype = struct.unpack_from('<I4s', data, offset)
        offset += 8
        chunk = data[offset:offset + clen]
        offset += clen
        if ctype == JSON_CHUNK:
            gltf = json.loads(chunk)
        elif ctype == BIN_CHUNK:
            blob = chunk
    if gltf is None:
        raise SystemExit(f'no JSON chunk: {path}')
    return gltf, bytearray(blob)


def save_glb(path: Path, gltf: dict, blob: bytes) -> None:
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4:
        json_bytes += b' '
    bin_bytes = bytes(blob)
    while len(bin_bytes) % 4:
        bin_bytes += b'\x00'
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<I4s', len(json_bytes), JSON_CHUNK)
    out += json_bytes
    out += struct.pack('<I4s', len(bin_bytes), BIN_CHUNK)
    out += bin_bytes
    path.write_bytes(out)
    print(f'wrote {path} ({path.stat().st_size} bytes)')


def accessor_bytes(gltf, blob, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    typ = acc['type']
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[typ]
    count = acc['count']
    ctype = acc['componentType']
    width = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[ctype]
    stride = view.get('byteStride') or (width * comps)
    if stride == width * comps:
        return bytes(blob[off:off + count * stride]), acc
    # tight-pack strided data
    raw = bytearray()
    for i in range(count):
        s = off + i * stride
        raw += blob[s:s + width * comps]
    return bytes(raw), acc


def append_accessor(gltf, blob: bytearray, data: bytes, acc_template: dict, typ: str, count: int, extras=None):
    while len(blob) % 4:
        blob.append(0)
    view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
    blob += data
    acc = {
        'bufferView': len(gltf['bufferViews']),
        'componentType': acc_template.get('componentType', FLOAT),
        'count': count,
        'type': typ,
    }
    if extras:
        acc.update(extras)
    # min/max for time SCALAR
    if typ == 'SCALAR' and acc['componentType'] == FLOAT and count:
        vals = struct.unpack('<' + 'f' * count, data[:count * 4])
        acc['min'] = [float(min(vals))]
        acc['max'] = [float(max(vals))]
    if typ == 'VEC3' and acc['componentType'] == FLOAT and count:
        vals = struct.unpack('<' + 'f' * (count * 3), data[:count * 12])
        xs, ys, zs = vals[0::3], vals[1::3], vals[2::3]
        acc['min'] = [float(min(xs)), float(min(ys)), float(min(zs))]
        acc['max'] = [float(max(xs)), float(max(ys)), float(max(zs))]
    gltf['bufferViews'].append(view)
    gltf['accessors'].append(acc)
    return len(gltf['accessors']) - 1


def node_name(gltf, i):
    nodes = gltf['nodes']
    if i is None or i >= len(nodes):
        return None
    return nodes[i].get('name')


def anim_by_name(gltf, name):
    for a in gltf.get('animations', []):
        if a.get('name') == name:
            return a
    raise SystemExit(f'missing animation {name!r}')


def extract_channels(gltf, blob, anim):
    """Map (nodeName, path) -> {times, values, interpolation, out_type, in_acc, out_acc}."""
    out = {}
    samps = anim['samplers']
    for ch in anim['channels']:
        name = node_name(gltf, ch['target']['node'])
        path = ch['target']['path']
        if not name:
            continue
        samp = samps[ch['sampler']]
        tbytes, tacc = accessor_bytes(gltf, blob, samp['input'])
        vbytes, vacc = accessor_bytes(gltf, blob, samp['output'])
        times = list(struct.unpack('<' + 'f' * tacc['count'], tbytes[:tacc['count'] * 4]))
        out[(name, path)] = {
            'times': times,
            'values': vbytes,
            'interpolation': samp.get('interpolation', 'LINEAR'),
            'out_type': vacc['type'],
            'out_acc': vacc,
            'in_acc': tacc,
        }
    return out


def comps_of(typ):
    return {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[typ]


def last_element(values: bytes, typ: str, count: int, interp: str) -> bytes:
    c = comps_of(typ)
    width = 4 * c
    # CUBICSPLINE stores 3 elements per key (in, mid, out)
    if interp == 'CUBICSPLINE':
        width *= 3
    if count <= 0:
        return b'\x00' * width
    return values[(count - 1) * width:count * width]


def stitch_channels(clips, dest_name):
    """clips: list of (offset, channel_map). Offset is added to that clip's times."""
    keys = set()
    for _, chans in clips:
        keys.update(chans)
    merged = {}
    for key in keys:
        times = []
        parts = []
        typ = None
        interp = None
        out_acc = None
        in_acc = None
        for offset, chans in clips:
            if key not in chans and parts:
                # hold last value of previous at this clip's start and end
                prev_end = times[-1] if times else offset
                ch_last = last_element(parts[-1]['values'] if False else b'', typ or 'VEC3', 0, interp or 'LINEAR')
            if key not in chans:
                if not times:
                    continue
                # skip missing (bone locked in earlier clip); hold last
                continue
            ch = chans[key]
            typ = ch['out_type']
            interp = ch['interpolation'] if interp is None else interp
            out_acc = ch['out_acc']
            in_acc = ch['in_acc']
            shifted = [t + offset for t in ch['times']]
            # drop a duplicate key at the join
            if times and shifted and abs(shifted[0] - times[-1]) < 1e-5:
                shifted = shifted[1:]
                c = comps_of(ch['out_type'])
                width = 4 * c * (3 if ch['interpolation'] == 'CUBICSPLINE' else 1)
                vals = ch['values'][width:]
            else:
                vals = ch['values']
            times.extend(shifted)
            parts.append(vals)
        if not times:
            continue
        values = b''.join(parts)
        merged[key] = {
            'times': times,
            'values': values,
            'interpolation': interp or 'LINEAR',
            'out_type': typ,
            'out_acc': out_acc,
            'in_acc': in_acc,
        }
    return dest_name, merged


def pack_anim(gltf, blob, dest_nodes, name, channels):
    samplers = []
    out_channels = []
    missing = []
    for (nname, path), ch in sorted(channels.items()):
        if nname not in dest_nodes:
            missing.append(nname)
            continue
        times = ch['times']
        tbytes = struct.pack('<' + 'f' * len(times), *times)
        in_i = append_accessor(gltf, blob, tbytes, ch['in_acc'] or {'componentType': FLOAT}, 'SCALAR', len(times))
        extras = {}
        if ch['out_acc'] and 'normalized' in ch['out_acc']:
            extras['normalized'] = ch['out_acc']['normalized']
        out_i = append_accessor(gltf, blob, ch['values'], ch['out_acc'] or {'componentType': FLOAT}, ch['out_type'], len(times), extras)
        samplers.append({'input': in_i, 'output': out_i, 'interpolation': ch['interpolation']})
        out_channels.append({
            'sampler': len(samplers) - 1,
            'target': {'node': dest_nodes[nname], 'path': path},
        })
    if missing:
        uniq = sorted(set(missing))
        print(f'  warn {name}: skipped {len(uniq)} unknown nodes: {uniq[:6]}')
    return {'name': name, 'samplers': samplers, 'channels': out_channels}


def duration_of(channels):
    m = 0.0
    for ch in channels.values():
        if ch['times']:
            m = max(m, ch['times'][-1])
    return m


LOCO_URL = 'https://raw.githubusercontent.com/decentraland/godot-explorer/main/godot/assets/no-export/locomotion/Avatar_Locomotion_Fix.glb'
DOUBLE_URL = 'https://raw.githubusercontent.com/decentraland/bevy-explorer/main/crates/assets/src/assets/animations/double_jump.glb'
GLIDE_URL = 'https://raw.githubusercontent.com/decentraland/bevy-explorer/main/crates/assets/src/assets/animations/glide.glb'


def fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size < 1000:
        print(f'fetch {url}')
        urlretrieve(url, dest)
    return dest


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
    assets = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('/tmp/assets')
    ghost_path = root / 'assets/models/bots/ghost.glb'
    out_path = root / 'assets/models/bots/ghost-recover.glb'
    fetch(LOCO_URL, assets / 'loco.glb')
    fetch(DOUBLE_URL, assets / 'double_jump.glb')
    fetch(GLIDE_URL, assets / 'glide.glb')

    ghost, ghost_bin = load_glb(ghost_path)
    loco, loco_bin = load_glb(assets / 'loco.glb')
    djump, djump_bin = load_glb(assets / 'double_jump.glb')
    glide, glide_bin = load_glb(assets / 'glide.glb')

    dest_nodes = {n['name']: i for i, n in enumerate(ghost['nodes']) if n.get('name')}
    print('ghost bones', sum(1 for n in dest_nodes if n.startswith('Avatar_')))

    def chans(g, b, name):
        return extract_channels(g, b, anim_by_name(g, name))

    jump_start = chans(loco, loco_bin, 'Jump_Start')
    jump_mid = chans(loco, loco_bin, 'Jump_Mid')
    start_dur = duration_of(jump_start)
    mid_dur = duration_of(jump_mid)
    print(f'Jump_Start {start_dur:.3f}s  Jump_Mid {mid_dur:.3f}s')

    jump_name, jump_ch = stitch_channels([(0.0, jump_start), (start_dur, jump_mid)], 'jump')
    idle_ch = chans(loco, loco_bin, 'Idle')
    fall_ch = chans(loco, loco_bin, 'Jump_Fall_Loop')
    slide_ch = chans(loco, loco_bin, 'Slide')
    double_ch = chans(djump, djump_bin, 'Double_Jump_Base')
    glide_ch = chans(glide, glide_bin, 'Glide_Avatar')

    specs = [
        ('idle', idle_ch),
        ('jump', jump_ch),
        ('double', double_ch),
        ('glide', glide_ch),
        ('fall', fall_ch),
        ('slide', slide_ch),
    ]
    ghost['animations'] = []
    for name, ch in specs:
        anim = pack_anim(ghost, ghost_bin, dest_nodes, name, ch)
        ghost['animations'].append(anim)
        print(f'  clip {name}: {duration_of(ch):.3f}s channels={len(anim["channels"])}')

    if 'buffers' not in ghost or not ghost['buffers']:
        ghost['buffers'] = [{}]
    ghost['buffers'][0]['byteLength'] = len(ghost_bin)
    # drop extra buffer uris if any
    ghost['buffers'] = [{'byteLength': len(ghost_bin)}]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    save_glb(out_path, ghost, ghost_bin)


if __name__ == '__main__':
    main()
