"""Export the A350 exterior (airframe, wings, engines, gear + hinge rig) to GLB.

Run with Windows Blender from WSL:
  blender.exe --background <A350-1000.blend> --python export_a350.py -- <out.glb>
Interior collections, studio lights and cameras are dropped. Drivers are
removed after being evaluated at rest, so the hinge empties export at their
neutral pose and the game drives them directly.
"""
import sys
import bpy

out = sys.argv[sys.argv.index("--") + 1]
KEEP = {"01 Airframe", "02 Wings and controls", "03 Engines", "04 Undercarriage", "07 Rig"}

keep = set()
for c in bpy.data.collections:
    if c.name in KEEP:
        keep.update(c.all_objects)

# Freeze driver results at rest then drop drivers. The file carries a demo
# action on the control properties, so remove it and set the rest values
# explicitly before letting the drivers evaluate.
root = bpy.data.objects["A350 FLIGHT CONTROLS"]
if root.animation_data:
    root.animation_data.action = None
REST = dict(aileron=0, elevator=0, rudder=0, flaps=0, spoilers=0, gear=1, doors=0, throttle=0, steering=0, cutaway=0)
for k, v in REST.items():
    root[k] = v
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
print("EXPORT rest", {k: root[k] for k in REST})
for o in bpy.data.objects:
    if o.animation_data:
        for d in list(o.animation_data.drivers):
            o.animation_data.drivers.remove(d)
        o.animation_data.action = None

for o in list(bpy.data.objects):
    if o not in keep or o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o, do_unlink=True)

for o in bpy.data.objects:
    o.hide_viewport = False
    o.hide_render = False
    o.hide_set(False)

# Text/curve objects -> meshes so the glTF exporter keeps them.
bpy.ops.object.select_all(action="DESELECT")
curves = [o for o in bpy.data.objects if o.type in {"CURVE", "FONT"}]
for o in curves:
    o.select_set(True)
if curves:
    bpy.context.view_layer.objects.active = curves[0]
    bpy.ops.object.convert(target="MESH")

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print("EXPORT objects", len(bpy.data.objects), "tris", tris)
print("ROOT matrix", [list(r) for r in root.matrix_world])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_apply=True,
    export_extras=False,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
print("EXPORT done", out)
