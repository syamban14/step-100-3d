"""Generate Low-Poly Mountain Cliff Boulders, River Stones, Signpost & Trail Bridge (mountain_rocks.glb + preview PNG)."""

import math
import os
import random
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "mountain_rocks.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "mountain_rocks.glb")
PREVIEW_PATH = "/Users/syamban/.gemini/antigravity-cli/brain/af6c04c1-699f-4b22-8483-72ea48865eab/mountain_rocks_preview.png"

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)


def hex_to_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    c = Color((r, g, b)).from_srgb_to_scene_linear()
    return (c.r, c.g, c.b, alpha)


def lerp_color(c_a, c_b, t):
    t_c = max(0.0, min(1.0, t))
    return (
        c_a[0] + (c_b[0] - c_a[0]) * t_c,
        c_a[1] + (c_b[1] - c_a[1]) * t_c,
        c_a[2] + (c_b[2] - c_a[2]) * t_c,
        1.0,
    )


def create_mesh_with_vcol(name, bm, vert_colors, material, collection, location=(0.0, 0.0, 0.0), flat=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = not flat

    color_attr = mesh.color_attributes.new(name="RockColor", type="BYTE_COLOR", domain="POINT")
    mesh.color_attributes.active_color = color_attr
    for idx, rgba in enumerate(vert_colors):
        if idx < len(color_attr.data):
            color_attr.data[idx].color = rgba

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def build_material(name, roughness=0.88):
    mat = bpy.data.materials.new(name)
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (480, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (200, 0)
    bsdf.inputs["Roughness"].default_value = roughness
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "RockColor"
    vcol.location = (-120, 100)
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_rock_chunk(bm, vcols, center, radius, scale_xyz, rot_euler, col_bot, col_top, rng, subdiv=1, sharp_top=False):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
    rot_m = rot_euler.to_matrix()
    vmap = {}
    for v in tmp.verts:
        jitter = rng.uniform(0.82, 1.18)
        px = v.co.x * scale_xyz[0] * jitter
        py = v.co.y * scale_xyz[1] * jitter
        pz = v.co.z * scale_xyz[2] * jitter
        if sharp_top and v.co.z > 0:
            taper = max(0.35, 1.0 - (v.co.z / radius) * 0.45)
            px *= taper
            py *= taper
        wp = Vector(center) + (rot_m @ Vector((px, py, pz)))
        nv = bm.verts.new(wp)
        vmap[v] = nv
        t_h = max(0.0, min(1.0, (v.co.z / radius + 1.0) * 0.5))
        vcols.append(lerp_color(col_bot, col_top, t_h))
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def add_box(bm, vcols, center, size, rot_euler, color):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    mat = Matrix.Translation(center) @ rot_euler.to_matrix().to_4x4() @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    vmap = {}
    for v in tmp.verts:
        vmap[v] = bm.verts.new(mat @ v.co)
        vcols.append(color)
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def add_cylinder(bm, vcols, p0, p1, r0, r1, segs, color):
    v0 = Vector(p0)
    v1 = Vector(p1)
    axis = v1 - v0
    if axis.length < 1e-6:
        return
    z_dir = axis.normalized()
    ref = Vector((1.0, 0.0, 0.0)) if abs(z_dir.dot(Vector((1.0, 0.0, 0.0)))) < 0.9 else Vector((0.0, 1.0, 0.0))
    x_dir = (ref - z_dir * ref.dot(z_dir)).normalized()
    y_dir = z_dir.cross(x_dir).normalized()

    ring0, ring1 = [], []
    for s in range(segs):
        ang = (s / float(segs)) * math.pi * 2.0
        ca, sa = math.cos(ang), math.sin(ang)
        ring0.append(bm.verts.new(v0 + (x_dir * ca + y_dir * sa) * r0))
        vcols.append(color)
        ring1.append(bm.verts.new(v1 + (x_dir * ca + y_dir * sa) * r1))
        vcols.append(color)
    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)


def build_cliff_boulder_large(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(201)

    c_granite_dark = hex_to_rgba("#525860")
    c_moss_top = hex_to_rgba("#4c7d42")
    c_granite_mid = hex_to_rgba("#767d85")

    add_rock_chunk(bm, vcols, (0.0, 0.0, 0.55), 0.78, (1.25, 1.05, 0.95), Euler((0.1, -0.1, 0.4)), c_granite_dark, c_moss_top, rng)
    add_rock_chunk(bm, vcols, (-0.68, -0.22, 0.34), 0.46, (1.1, 1.0, 0.85), Euler((0.2, 0.3, 1.1)), c_granite_dark, c_granite_mid, rng)
    add_rock_chunk(bm, vcols, (0.64, 0.18, 0.28), 0.40, (1.15, 0.95, 0.78), Euler((-0.1, 0.2, 2.0)), c_granite_dark, c_moss_top, rng)

    return create_mesh_with_vcol("CliffBoulderLarge", bm, vcols, mat, col, location=location, flat=True)


def build_river_stone_cluster(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(202)

    c_river_bot = hex_to_rgba("#4b5a68")
    c_river_top = hex_to_rgba("#8fa3b0")

    stones = [
        ((0.0, 0.0, 0.22), 0.42, (1.25, 1.0, 0.62)),
        ((-0.44, -0.18, 0.16), 0.30, (1.15, 0.95, 0.58)),
        ((0.42, 0.14, 0.15), 0.28, (1.1, 1.05, 0.55)),
        ((0.15, -0.35, 0.12), 0.22, (1.1, 0.9, 0.5)),
    ]
    for idx, (pos, rad, scl) in enumerate(stones):
        add_rock_chunk(bm, vcols, pos, rad, scl, Euler((0.0, 0.0, idx * 0.9)), c_river_bot, c_river_top, rng)

    return create_mesh_with_vcol("RiverStoneCluster", bm, vcols, mat, col, location=location, flat=True)


def build_snowy_peak_crag(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(203)

    c_slate = hex_to_rgba("#4b525c")
    c_snow = hex_to_rgba("#f1f6fc")

    add_rock_chunk(bm, vcols, (0.0, 0.0, 0.78), 0.70, (0.95, 0.85, 1.45), Euler((0.05, -0.12, 0.3)), c_slate, c_snow, rng, sharp_top=True)
    add_rock_chunk(bm, vcols, (-0.52, 0.15, 0.48), 0.48, (0.9, 0.85, 1.25), Euler((0.18, 0.22, 1.2)), c_slate, c_snow, rng, sharp_top=True)
    add_rock_chunk(bm, vcols, (0.48, -0.16, 0.38), 0.40, (0.95, 0.9, 1.15), Euler((-0.15, -0.18, 2.2)), c_slate, c_snow, rng, sharp_top=True)

    return create_mesh_with_vcol("SnowyPeakCrag", bm, vcols, mat, col, location=location, flat=True)


def build_trail_signpost(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(204)

    c_post = hex_to_rgba("#6b4423")
    c_plank = hex_to_rgba("#b87d44")
    c_plank_edge = hex_to_rgba("#d9a05b")
    c_stone_a = hex_to_rgba("#7a8086")
    c_stone_b = hex_to_rgba("#9ca3af")

    # Tumpukan batu penanda (cairn) di dasar tiang
    add_rock_chunk(bm, vcols, (-0.22, 0.08, 0.12), 0.22, (1.1, 1.0, 0.65), Euler((0, 0, 0.2)), c_stone_a, c_stone_b, rng)
    add_rock_chunk(bm, vcols, (0.20, -0.10, 0.11), 0.20, (1.1, 0.95, 0.65), Euler((0, 0, 1.1)), c_stone_a, c_stone_b, rng)
    add_rock_chunk(bm, vcols, (0.04, 0.20, 0.10), 0.18, (1.0, 1.0, 0.6), Euler((0, 0, 2.1)), c_stone_a, c_stone_b, rng)

    # Tiang kayu utama
    add_cylinder(bm, vcols, (0.0, 0.0, 0.0), (0.0, 0.0, 1.75), 0.08, 0.065, 6, c_post)

    # Dua papan panah arah pendakian
    add_box(bm, vcols, (0.18, 0.0, 1.48), (0.85, 0.06, 0.22), Euler((0.0, -0.08, 0.15)), c_plank)
    add_box(bm, vcols, (-0.16, 0.0, 1.15), (0.78, 0.06, 0.20), Euler((0.0, 0.06, -0.25)), c_plank_edge)

    return create_mesh_with_vcol("TrailSignpost", bm, vcols, mat, col, location=location, flat=True)


def build_wooden_trail_bridge(mat, col, location):
    bm = bmesh.new()
    vcols = []

    c_beam = hex_to_rgba("#5c3a1e")
    c_plank = hex_to_rgba("#9c6b3b")
    c_rope = hex_to_rgba("#d4b483")

    # Dua balok penyangga memanjang
    for sy in (-0.42, 0.42):
        add_cylinder(bm, vcols, (-1.05, sy, 0.12), (1.05, sy, 0.12), 0.075, 0.075, 6, c_beam)

    # 8 Papan kayu melintang dengan lengkungan tipis
    for i in range(8):
        t = i / 7.0
        px = -0.92 + t * 1.84
        arch_z = 0.20 + math.sin(t * math.pi) * 0.10
        add_box(bm, vcols, (px, 0.0, arch_z), (0.20, 1.08, 0.06), Euler((0.0, 0.0, 0.0)), c_plank)

    # 4 Tiang pegangan + tali pegangan kiri-kanan
    for sy in (-0.50, 0.50):
        add_cylinder(bm, vcols, (-0.85, sy, 0.14), (-0.85, sy, 0.72), 0.055, 0.05, 6, c_beam)
        add_cylinder(bm, vcols, (0.85, sy, 0.14), (0.85, sy, 0.72), 0.055, 0.05, 6, c_beam)
        add_cylinder(bm, vcols, (-0.85, sy, 0.66), (0.0, sy, 0.72), 0.028, 0.028, 5, c_rope)
        add_cylinder(bm, vcols, (0.0, sy, 0.72), (0.85, sy, 0.66), 0.028, 0.028, 5, c_rope)

    return create_mesh_with_vcol("WoodenTrailBridge", bm, vcols, mat, col, location=location, flat=True)


def setup_studio(mat, studio_col):
    world = bpy.data.worlds.new("RocksStudioWorld")
    bpy.context.scene.world = world
    if not world.use_nodes:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_rgba("#9bd4f5")
        bg.inputs["Strength"].default_value = 0.85

    bm_floor = bmesh.new()
    vcols = []
    c_floor = hex_to_rgba("#4c8f43")
    bmesh.ops.create_grid(bm_floor, x_segments=12, y_segments=6, size=8.5)
    for v in bm_floor.verts:
        v.co.y *= 0.42
        v.co.z = -0.02
        vcols.append(c_floor)
    create_mesh_with_vcol("StudioFloor", bm_floor, vcols, mat, studio_col, flat=True)

    sun_data = bpy.data.lights.new("SunKey", type="SUN")
    sun_data.energy = 3.0
    sun_data.color = (1.0, 0.96, 0.88)
    sun_obj = bpy.data.objects.new("SunKey", sun_data)
    sun_obj.rotation_euler = (math.radians(48), math.radians(16), math.radians(-32))
    studio_col.objects.link(sun_obj)

    fill_data = bpy.data.lights.new("SkyFill", type="SUN")
    fill_data.energy = 0.9
    fill_data.color = (0.75, 0.88, 1.0)
    fill_obj = bpy.data.objects.new("SkyFill", fill_data)
    fill_obj.rotation_euler = (math.radians(55), math.radians(-18), math.radians(140))
    studio_col.objects.link(fill_obj)

    cam_data = bpy.data.cameras.new("PreviewCamera")
    cam_data.lens = 38.0
    cam_obj = bpy.data.objects.new("PreviewCamera", cam_data)
    cam_obj.location = (0.2, -13.2, 4.2)
    cam_dir = Vector((0.2, 0.0, 0.65)) - cam_obj.location
    cam_obj.rotation_mode = "QUATERNION"
    cam_obj.rotation_quaternion = cam_dir.to_track_quat("-Z", "Y")
    studio_col.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True
                if space.region_3d is not None:
                    space.region_3d.view_perspective = "PERSP"
                    space.region_3d.view_location = Vector((0.2, 0.0, 0.65))
                    space.region_3d.view_rotation = Euler((math.radians(74.0), 0.0, 0.0), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 13.5


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    r_col = bpy.data.collections.new("MountainRocks")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(r_col)
    bpy.context.scene.collection.children.link(studio_col)

    mat = build_material("RocksPackMat", roughness=0.88)

    build_cliff_boulder_large(mat, r_col, location=(-4.6, 0.0, 0.0))
    build_river_stone_cluster(mat, r_col, location=(-2.3, 0.0, 0.0))
    build_snowy_peak_crag(mat, r_col, location=(-0.1, 0.0, 0.0))
    build_trail_signpost(mat, r_col, location=(2.1, 0.0, 0.0))
    build_wooden_trail_bridge(mat, r_col, location=(4.5, 0.0, 0.0))

    setup_studio(mat, studio_col)

    total_verts = sum(len(o.data.vertices) for o in r_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in r_col.objects if o.type == "MESH")
    print(f"[MountainRocks geometry] objects={len(r_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    scene = bpy.context.scene
    available_engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available_engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 700
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"[Rendered preview] {PREVIEW_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in r_col.objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_vertex_color="ACTIVE",
    )
    print(f"[Exported] {GLB_PATH}")


if __name__ == "__main__":
    main()
