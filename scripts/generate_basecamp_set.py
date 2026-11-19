"""Generate Low-Poly Mountain Basecamp Set: Expedition Tent, Campfire Pit, Log Bench & Backpack (basecamp_set.glb)."""

import math
import os
import random
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "basecamp_set.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "basecamp_set.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)


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

    color_attr = mesh.color_attributes.new(name="CampColor", type="BYTE_COLOR", domain="POINT")
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


def build_material(name, roughness=0.85, emission_strength=0.0):
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
    vcol.layer_name = "CampColor"
    vcol.location = (-120, 100)
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])

    if emission_strength > 0.0 and "Emission Color" in bsdf.inputs:
        nt.links.new(vcol.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_cylinder(bm, vcols, p0, p1, r0, r1, segs, col0, col1=None):
    if col1 is None:
        col1 = col0
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
        vcols.append(col0)
        ring1.append(bm.verts.new(v1 + (x_dir * ca + y_dir * sa) * r1))
        vcols.append(col1)
    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)


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


def build_expedition_tent(mat, col, location):
    bm = bmesh.new()
    vcols = []

    c_orange = hex_to_rgba("#ea580c")
    c_yellow = hex_to_rgba("#f59e0b")
    c_floor = hex_to_rgba("#334155")
    c_door = hex_to_rgba("#1e293b")
    c_pole = hex_to_rgba("#cbd5e1")
    c_rope = hex_to_rgba("#fde68a")

    # Tenda prisma A-frame ekspedisi gunung
    w = 0.85
    l = 1.05
    h = 1.25

    fl = bm.verts.new((-w, -l, 0.02))
    fr = bm.verts.new((w, -l, 0.02))
    bl = bm.verts.new((-w, l, 0.02))
    br = bm.verts.new((w, l, 0.02))
    rf = bm.verts.new((0.0, -l * 0.92, h))
    rb = bm.verts.new((0.0, l * 0.92, h))
    vcols.extend([c_floor, c_floor, c_floor, c_floor, c_yellow, c_yellow])

    # Alas tenda
    bm.faces.new((fl, bl, br, fr))
    # Dinding tenda kiri, kanan, belakang
    bm.faces.new((fl, rf, rb, bl))
    bm.faces.new((fr, br, rb, rf))
    bm.faces.new((bl, rb, br))

    # Pintu depan terbuka (segitiga gelap + flap oranye)
    dl = bm.verts.new((-0.44, -l - 0.01, 0.04))
    dr = bm.verts.new((0.44, -l - 0.01, 0.04))
    dt = bm.verts.new((0.0, -l * 0.94, h - 0.14))
    vcols.extend([c_door, c_door, c_door])
    bm.faces.new((dl, dr, dt))

    # Frame depan kiri & kanan
    bm.faces.new((fl, dl, dt, rf))
    bm.faces.new((dr, fr, rf, dt))

    # Tiang punggung & pasak tali
    add_cylinder(bm, vcols, (0.0, -l * 0.96, 0.0), (0.0, -l * 0.96, h + 0.06), 0.03, 0.03, 6, c_pole)
    add_cylinder(bm, vcols, (0.0, l * 0.96, 0.0), (0.0, l * 0.96, h + 0.06), 0.03, 0.03, 6, c_pole)

    for sx in (-1.0, 1.0):
        for sy in (-0.7, 0.7):
            add_cylinder(bm, vcols, (sx * w, sy * l, 0.04), (sx * (w + 0.35), sy * l, 0.0), 0.014, 0.014, 5, c_rope)
            add_cylinder(bm, vcols, (sx * (w + 0.35), sy * l, -0.02), (sx * (w + 0.35), sy * l, 0.12), 0.025, 0.015, 5, c_orange)

    return create_mesh_with_vcol("ExpeditionTent", bm, vcols, mat, col, location=location, flat=True)


def build_campfire_pit(mat_solid, mat_flame, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(401)

    c_ash = hex_to_rgba("#332f2c")
    c_stone_a = hex_to_rgba("#64748b")
    c_stone_b = hex_to_rgba("#94a3b8")
    c_log = hex_to_rgba("#5c3a21")
    c_char = hex_to_rgba("#292524")

    # Gundukan abu dasar
    add_cylinder(bm, vcols, (0, 0, 0.0), (0, 0, 0.07), 0.56, 0.34, 10, c_ash, c_ash)

    # 10 Batu melingkar
    for i in range(10):
        ang = (i / 10.0) * math.pi * 2.0
        rx, ry = math.cos(ang) * 0.58, math.sin(ang) * 0.58
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=rng.uniform(0.13, 0.17))
        vmap = {}
        stone_col = c_stone_a if i % 2 == 0 else c_stone_b
        for v in tmp.verts:
            p = Vector((rx + v.co.x * 1.15, ry + v.co.y * 0.95, 0.09 + v.co.z * 0.65))
            vmap[v] = bm.verts.new(p)
            vcols.append(stone_col)
        for f in tmp.faces:
            bm.faces.new([vmap[v] for v in f.verts])
        tmp.free()

    # 4 Kayu bakar menyilang di tengah
    for i in range(4):
        ang = i * (math.pi / 2.0) + 0.35
        p0 = (math.cos(ang) * 0.42, math.sin(ang) * 0.42, 0.08)
        p1 = (-math.cos(ang) * 0.14, -math.sin(ang) * 0.14, 0.30)
        add_cylinder(bm, vcols, p0, p1, 0.075, 0.06, 6, c_log, c_char)

    pit_obj = create_mesh_with_vcol("CampfirePit", bm, vcols, mat_solid, col, location=location, flat=True)

    # Lidah api menyala terpisah agar memiliki Emission material
    bm_f = bmesh.new()
    f_vcols = []
    c_orange = hex_to_rgba("#f97316")
    c_yellow = hex_to_rgba("#fde047")
    flames = [
        ((0.0, 0.0, 0.16), (0.04, 0.02, 0.72), 0.18, 0.02),
        ((0.12, 0.08, 0.14), (0.16, 0.12, 0.52), 0.12, 0.02),
        ((-0.11, -0.07, 0.14), (-0.15, -0.09, 0.56), 0.13, 0.02),
    ]
    for p0, p1, r0, r1 in flames:
        add_cylinder(bm_f, f_vcols, p0, p1, r0, r1, 6, c_orange, c_yellow)

    create_mesh_with_vcol("CampfireFlame", bm_f, f_vcols, mat_flame, col, location=location, flat=True)
    return pit_obj


def build_log_bench_and_backpack(mat, col, location_bench, location_pack):
    # Bangku Kayu Belah
    bm_b = bmesh.new()
    b_vcols = []
    c_bark = hex_to_rgba("#5c3a21")
    c_top = hex_to_rgba("#b48352")

    add_cylinder(bm_b, b_vcols, (-0.52, -0.25, 0.0), (-0.52, 0.25, 0.0), 0.12, 0.12, 6, c_bark)
    add_cylinder(bm_b, b_vcols, (0.52, -0.25, 0.0), (0.52, 0.25, 0.0), 0.12, 0.12, 6, c_bark)
    add_box(bm_b, b_vcols, (0.0, 0.0, 0.22), (1.35, 0.40, 0.14), Euler((0.0, 0.0, 0.0)), c_top)
    create_mesh_with_vcol("LogBench", bm_b, b_vcols, mat, col, location=location_bench, flat=True)

    # Ransel Pendaki Gunung (HikerBackpack)
    bm_p = bmesh.new()
    p_vcols = []
    c_pack = hex_to_rgba("#0284c7")
    c_flap = hex_to_rgba("#38bdf8")
    c_strap = hex_to_rgba("#1e293b")
    c_roll = hex_to_rgba("#facc15")

    add_box(bm_p, p_vcols, (0.0, 0.0, 0.26), (0.36, 0.24, 0.48), Euler((0.08, 0.0, 0.0)), c_pack)
    add_box(bm_p, p_vcols, (0.0, -0.02, 0.50), (0.38, 0.26, 0.12), Euler((0.08, 0.0, 0.0)), c_flap)
    add_box(bm_p, p_vcols, (0.0, -0.14, 0.22), (0.28, 0.08, 0.22), Euler((0.08, 0.0, 0.0)), c_strap)
    add_cylinder(bm_p, p_vcols, (-0.20, 0.05, 0.58), (0.20, 0.05, 0.58), 0.085, 0.085, 7, c_roll)
    create_mesh_with_vcol("HikerBackpack", bm_p, p_vcols, mat, col, location=location_pack, flat=True)


def setup_studio(mat, studio_col):
    world = bpy.data.worlds.new("BasecampStudioWorld")
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
    bmesh.ops.create_grid(bm_floor, x_segments=10, y_segments=6, size=5.5)
    for v in bm_floor.verts:
        v.co.y *= 0.65
        v.co.z = -0.01
        vcols.append(c_floor)
    create_mesh_with_vcol("StudioFloor", bm_floor, vcols, mat, studio_col, flat=True)

    sun_data = bpy.data.lights.new("SunKey", type="SUN")
    sun_data.energy = 2.8
    sun_obj = bpy.data.objects.new("SunKey", sun_data)
    sun_obj.rotation_euler = (math.radians(48), math.radians(15), math.radians(-30))
    studio_col.objects.link(sun_obj)

    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True
                if space.region_3d is not None:
                    space.region_3d.view_perspective = "PERSP"
                    space.region_3d.view_location = Vector((0.0, 0.0, 0.5))
                    space.region_3d.view_rotation = Euler((math.radians(70.0), 0.0, math.radians(-20.0)), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 7.2


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    b_col = bpy.data.collections.new("BasecampSet")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(b_col)
    bpy.context.scene.collection.children.link(studio_col)

    mat_solid = build_material("BasecampMat", roughness=0.86)
    mat_flame = build_material("BasecampFlameMat", roughness=0.25, emission_strength=3.5)

    build_expedition_tent(mat_solid, b_col, location=(-1.85, 0.25, 0.0))
    build_campfire_pit(mat_solid, mat_flame, b_col, location=(0.45, -0.35, 0.0))
    build_log_bench_and_backpack(mat_solid, b_col, location_bench=(1.95, 0.45, 0.0), location_pack=(-0.65, -0.65, 0.0))

    setup_studio(mat_solid, studio_col)

    total_verts = sum(len(o.data.vertices) for o in b_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in b_col.objects if o.type == "MESH")
    print(f"[BasecampSet geometry] objects={len(b_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in b_col.objects:
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
