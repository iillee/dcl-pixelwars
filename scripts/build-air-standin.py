"""
Original low-poly rigged mannequin for the airborne bot stand-in.
Authored for this repository. No third-party mesh and no Armature_Prop node.

Run from the repo root:

    blender --background --python scripts/build-air-standin.py

The figure stands on Blender Z (exports to glTF Y) and faces Blender -Y
(exports to glTF +Z, the same forward the bot yaw uses). Feet at 0, crown
near 1.8 m. Clips: tumble, jump, double, fall, glide.
"""
import json
import math
import os
import struct

import bpy
from mathutils import Euler, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "bots", "air-standin.glb")
FPS = 24
CLIPS = ("tumble", "jump", "double", "fall", "glide")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")

def add_bone(name, head, tail, parent):
    bone = arm_data.edit_bones.new(name)
    bone.head = Vector(head)
    bone.tail = Vector(tail)
    # Local Z aims forward (-Y) so +X swings a limb toward the nose.
    bone.align_roll(Vector((0, -1, 0)))
    if parent:
        bone.parent = arm_data.edit_bones[parent]
    return bone

SPEC = [
    ("Hips", (0, 0, 0.98), (0, 0, 1.12), None),
    ("Spine", (0, 0, 1.12), (0, 0, 1.30), "Hips"),
    ("Chest", (0, 0, 1.30), (0, 0, 1.48), "Spine"),
    ("Head", (0, 0, 1.48), (0, 0, 1.76), "Chest"),
    ("ArmL", (-0.24, 0, 1.46), (-0.24, 0, 1.18), "Chest"),
    ("ForeArmL", (-0.24, 0, 1.18), (-0.24, 0, 0.92), "ArmL"),
    ("ArmR", (0.24, 0, 1.46), (0.24, 0, 1.18), "Chest"),
    ("ForeArmR", (0.24, 0, 1.18), (0.24, 0, 0.92), "ArmR"),
    ("UpLegL", (-0.10, 0, 0.94), (-0.10, 0, 0.48), "Hips"),
    ("LegL", (-0.10, 0, 0.48), (-0.10, 0, 0.02), "UpLegL"),
    ("UpLegR", (0.10, 0, 0.94), (0.10, 0, 0.48), "Hips"),
    ("LegR", (0.10, 0, 0.48), (0.10, 0, 0.02), "UpLegR"),
]
for name, head, tail, parent in SPEC:
    add_bone(name, head, tail, parent)

# +X on a down-pointing bone must swing the tail forward (-Y) and up.
arm = arm_data.edit_bones["ArmL"]
if arm.z_axis.y > -0.9:
    raise SystemExit(f"arm roll is not forward: {tuple(arm.z_axis)}")
bpy.ops.object.mode_set(mode="OBJECT")

parts = []

def add_box(bone, center, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = bone + "Box"
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    group = obj.vertex_groups.new(name=bone)
    group.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
    parts.append(obj)

def mid(a, b, lift=0.0):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + lift)

by = {n: (h, t) for n, h, t, _ in SPEC}
add_box("Hips", mid(by["Hips"][0], by["Hips"][1]), (0.34, 0.18, 0.16))
add_box("Spine", mid(by["Spine"][0], by["Spine"][1]), (0.28, 0.16, 0.18))
add_box("Chest", mid(by["Chest"][0], by["Chest"][1]), (0.42, 0.18, 0.20))
add_box("Head", (0, 0, 1.64), (0.22, 0.20, 0.28))
add_box("ArmL", mid(by["ArmL"][0], by["ArmL"][1]), (0.10, 0.10, 0.28))
add_box("ForeArmL", mid(by["ForeArmL"][0], by["ForeArmL"][1]), (0.08, 0.08, 0.26))
add_box("ArmR", mid(by["ArmR"][0], by["ArmR"][1]), (0.10, 0.10, 0.28))
add_box("ForeArmR", mid(by["ForeArmR"][0], by["ForeArmR"][1]), (0.08, 0.08, 0.26))
add_box("UpLegL", mid(by["UpLegL"][0], by["UpLegL"][1]), (0.13, 0.13, 0.46))
add_box("LegL", mid(by["LegL"][0], by["LegL"][1]), (0.11, 0.11, 0.46))
add_box("UpLegR", mid(by["UpLegR"][0], by["UpLegR"][1]), (0.13, 0.13, 0.46))
add_box("LegR", mid(by["LegR"][0], by["LegR"][1]), (0.11, 0.11, 0.46))
# Feet, still skinned to the shin so they plant at y=0 after export.
add_box("LegL", (-0.10, -0.06, 0.03), (0.12, 0.20, 0.06))
add_box("LegR", (0.10, -0.06, 0.03), (0.12, 0.20, 0.06))

bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "Mannequin"
mod = body.modifiers.new("Rig", "ARMATURE")
mod.object = rig
mod.use_vertex_groups = True
body.parent = rig

mat = bpy.data.materials.new("Cloth")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.86, 0.84, 0.80, 1)
bsdf.inputs["Roughness"].default_value = 0.72
bsdf.inputs["Metallic"].default_value = 0.02
body.data.materials.append(mat)

zs = [v.co.z for v in body.data.vertices]
if min(zs) < -0.02 or min(zs) > 0.05 or max(zs) < 1.7 or max(zs) > 1.9:
    raise SystemExit(f"height out of range z {min(zs):.3f}..{max(zs):.3f}")

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for pb in rig.pose.bones:
    pb.rotation_mode = "XYZ"

def rest_pose():
    for pb in rig.pose.bones:
        pb.rotation_euler = Euler((0, 0, 0))
    bpy.context.view_layer.update()

def apply_pose(pose):
    rest_pose()
    for name, rot in pose.items():
        rig.pose.bones[name].rotation_euler = Euler(tuple(math.radians(v) for v in rot))
    bpy.context.view_layer.update()

# Confirmed on this bone roll: +X swings a hanging limb forward (-Y) and up.
TUCK = {
    "UpLegL": (78, 0, 0), "UpLegR": (78, 0, 0),
    "LegL": (-72, 0, 0), "LegR": (-72, 0, 0),
    "Spine": (22, 0, 0), "Chest": (8, 0, 0),
    "ArmL": (40, 0, 0), "ArmR": (40, 0, 0),
}
DOUBLE = {
    "UpLegL": (105, 0, 0), "UpLegR": (105, 0, 0),
    "LegL": (-95, 0, 0), "LegR": (-95, 0, 0),
    "Spine": (36, 0, 0), "Chest": (14, 0, 0),
    "ArmL": (24, 0, 18), "ArmR": (24, 0, -18),
    "ForeArmL": (36, 0, 0), "ForeArmR": (36, 0, 0),
}
FALL = {
    "ArmL": (22, 0, -28), "ArmR": (22, 0, 28),
    "Spine": (8, 0, 0),
}
GLIDE = {
    "ArmL": (152, 0, 8), "ArmR": (152, 0, -8),
    "ForeArmL": (-18, 0, 0), "ForeArmR": (-18, 0, 0),
    "Spine": (18, 0, 0), "Chest": (10, 0, 0),
    "UpLegL": (12, 0, 0), "UpLegR": (12, 0, 0),
}

apply_pose(GLIDE)
hand = rig.pose.bones["ForeArmL"].tail
# Forward is -Y, up is +Z. Hands must clear the shoulders and reach toward the nose.
if hand.z < 1.45 or hand.y > -0.05:
    raise SystemExit(f"glide hands are not up and forward: {tuple(round(v, 3) for v in hand)}")
print(f"glide hand blender xyz ({hand.x:.3f}, {hand.y:.3f}, {hand.z:.3f})  glTF yz ({hand.z:.3f}, {-hand.y:.3f})")
rest_pose()

def flail(u):
    s = math.sin(u * math.tau)
    k = math.sin(u * math.tau * 2)
    return {
        "ArmL": (40 + 35 * k, 0, 12 * s),
        "ArmR": (40 - 35 * k, 0, -12 * s),
        "ForeArmL": (20 + 18 * k, 0, 0),
        "ForeArmR": (20 - 18 * k, 0, 0),
        "UpLegL": (18 + 16 * s, 0, 0),
        "UpLegR": (18 - 16 * s, 0, 0),
        "Spine": (0, 0, 14 * s),
    }

if rig.animation_data is None:
    rig.animation_data_create()

def push_clip(name, samples):
    """samples: list of (time_seconds, pose dict). First and last match so it loops."""
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    rest_pose()
    for t, pose in samples:
        apply_pose(pose)
        frame = t * FPS
        for bone, rot in pose.items():
            rig.pose.bones[bone].keyframe_insert("rotation_euler", frame=frame)
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    start = int(round(samples[0][0] * FPS))
    track.strips.new(name, start, action)
    rig.animation_data.action = None
    rest_pose()

hold = lambda pose, dur: [(0.0, pose), (dur, pose)]
push_clip("tumble", [(i / 4 * 0.8, flail(i / 4)) for i in range(5)])
push_clip("jump", hold(TUCK, 0.55))
push_clip("double", hold(DOUBLE, 0.45))
push_clip("fall", hold(FALL, 1.0))
push_clip("glide", hold(GLIDE, 1.2))

bpy.ops.object.mode_set(mode="OBJECT")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_nla_strips=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
    export_anim_slide_to_zero=False,
)

raw = open(OUT, "rb").read()
if b"Armature_Prop" in raw:
    raise SystemExit("exported an Armature_Prop node")
length = struct.unpack_from("<I", raw, 12)[0]
gltf = json.loads(raw[20:20 + length])
names = [n.get("name") for n in gltf["nodes"]]
clips = [a["name"] for a in gltf.get("animations", [])]
if any(n == "Armature_Prop" for n in names):
    raise SystemExit(f"bad node names {names}")
missing = [c for c in CLIPS if c not in clips]
if missing or not gltf.get("skins"):
    raise SystemExit(f"export missing clips {missing} or skin; got {clips}")
print(f"wrote {OUT} ({len(raw)} bytes) clips {clips} nodes {names}")
print(f"bind height z {min(zs):.3f}..{max(zs):.3f}")
