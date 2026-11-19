"""Generate Low-Poly Summit Flag Monument, Mystery Supply Crate & Trail Lantern Post (summit_set.glb)."""

import math
import os
import random
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "summit_set.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "summit_set.glb")

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

    color_attr = mesh.color_attributes.new(name="SummitColor", type="BYTE_COLOR", domain="POINT")
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


def build_material(name, roughness=0.75, metallic=0.0, emission_strength=0.0):
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
    bsdf.inputs["Metallic"].default_value = metallic
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "SummitColor"
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


def build_summit_flag_monument(mat_solid, mat_glow, col, location):
    bm = bmesh.new()
    vcols = []

    c_stone_dark = hex_to_rgba("#475569")
    c_snow = hex_to_rgba("#f1f5f9")
    c_gold = hex_to_rgba("#facc15")
    c_pole = hex_to_rgba("#e2e8f0")
    c_flag_red = hex_to_rgba("#ef4444")
    c_flag_trim = hex_to_rgba("#fbbf24")

    # Tugu batu bertingkat berbalut salju
    add_cylinder(bm, vcols, (0, 0, 0.0), (0, 0, 0.28), 0.72, 0.56, 8, c_stone_dark, c_snow)
    add_cylinder(bm, vcols, (0, 0, 0.28), (0, 0, 0.52), 0.50, 0.38, 8, c_stone_dark, c_snow)

    # Tiang bendera puncak
    add_cylinder(bm, vcols, (0, 0, 0.48), (0, 0, 2.35), 0.045, 0.032, 8, c_pole, c_gold)

    # Bendera ekspedisi berkibar (ribbon 3D tipis 4 segmen)
    segs = 4
    prev_f = None
    prev_b = None
    for i in range(segs + 1):
        t = i / float(segs)
        fx = t * 0.95
        fy = math.sin(t * math.pi * 1.4) * 0.09
        zb = 1.72 + t * 0.06
        zt = 2.26 - t * 0.14
        c = lerp_color(c_flag_red, c_flag_trim, 0.35 if i == segs else 0.0)
        vfb = bm.verts.new((fx, fy - 0.012, zb))
        vft = bm.verts.new((fx, fy - 0.012, zt))
        vbb = bm.verts.new((fx, fy + 0.012, zb))
        vbt = bm.verts.new((fx, fy + 0.012, zt))
        vcols.extend([c, c, c, c])
        if prev_f is not None:
            bm.faces.new((prev_f[0], vfb, vft, prev_f[1]))
            bm.faces.new((vbb, prev_b[0], prev_b[1], vbt))
            bm.faces.new((prev_f[1], vft, vbt, prev_b[1]))
            bm.faces.new((prev_b[0], vbb, vfb, prev_f[0]))
        prev_f = (vfb, vft)
        prev_b = (vbb, vbt)
    if prev_f is not None:
        bm.faces.new((prev_f[0], prev_b[0], prev_b[1], prev_f[1]))

    monument = create_mesh_with_vcol("SummitFlagMonument", bm, vcols, mat_solid, col, location=location, flat=True)

    # Mahkota/Bintang Kristal Emas Puncak bercahaya
    bm_star = bmesh.new()
    s_vcols = []
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=0.16)
    vmap = {}
    for v in tmp.verts:
        vmap[v] = bm_star.verts.new((v.co.x, v.co.y, 2.48 + v.co.z * 1.35))
        s_vcols.append(c_gold)
    for f in tmp.faces:
        bm_star.faces.new([vmap[v] for v in f.verts])
    tmp.free()
    create_mesh_with_vcol("SummitCrownOrb", bm_star, s_vcols, mat_glow, col, location=location, flat=True)
    return monument


def build_mystery_supply_crate(mat_solid, mat_glow, col, location):
    bm = bmesh.new()
    vcols = []

    c_wood = hex_to_rgba("#9a6534")
    c_trim = hex_to_rgba("#475569")

    # Peti perbekalan kayu + lis besi
    add_box(bm, vcols, (0, 0, 0.24), (0.54, 0.54, 0.44), Euler((0, 0, 0.15)), c_wood)
    add_box(bm, vcols, (0, 0, 0.44), (0.58, 0.58, 0.08), Euler((0, 0, 0.15)), c_trim)
    add_box(bm, vcols, (0, 0, 0.24), (0.58, 0.12, 0.46), Euler((0, 0, 0.15)), c_trim)
    crate = create_mesh_with_vcol("MysterySupplyCrate", bm, vcols, mat_solid, col, location=location, flat=True)

    # Kristal ungu bercahaya melayang di atas peti
    bm_c = bmesh.new()
    c_vcols = []
    c_purple = hex_to_rgba("#a855f7")
    c_lavender = hex_to_rgba("#e9d5ff")
    r = 0.18
    top = bm_c.verts.new((0, 0, 0.98))
    bot = bm_c.verts.new((0, 0, 0.62))
    c_vcols.extend([c_lavender, c_purple])
    ring = []
    for i in range(4):
        ang = i * (math.pi / 2.0) + 0.4
        ring.append(bm_c.verts.new((math.cos(ang) * r, math.sin(ang) * r, 0.80)))
        c_vcols.append(c_purple)
    for i in range(4):
        ni = (i + 1) % 4
        bm_c.faces.new((ring[i], ring[ni], top))
        bm_c.faces.new((ring[ni], ring[i], bot))
    create_mesh_with_vcol("MysteryCrystal", bm_c, c_vcols, mat_glow, col, location=location, flat=True)
    return crate


def build_trail_lantern_post(mat_solid, mat_glow, col, location):
    bm = bmesh.new()
    vcols = []

    c_wood = hex_to_rgba("#5c3a21")
    c_iron = hex_to_rgba("#1e293b")

    # Tiang kayu + lengan gantung lentera
    add_cylinder(bm, vcols, (0, 0, 0.0), (0, 0, 1.35), 0.065, 0.05, 6, c_wood)
    add_cylinder(bm, vcols, (0, 0, 1.25), (0.36, 0.0, 1.25), 0.04, 0.035, 6, c_wood)
    add_cylinder(bm, vcols, (0.34, 0.0, 1.25), (0.34, 0.0, 1.08), 0.015, 0.015, 5, c_iron)
    # Tutup lentera
    add_cylinder(bm, vcols, (0.34, 0.0, 1.05), (0.34, 0.0, 1.12), 0.13, 0.03, 6, c_iron)
    add_cylinder(bm, vcols, (0.34, 0.0, 0.84), (0.34, 0.0, 0.88), 0.09, 0.11, 6, c_iron)
    post = create_mesh_with_vcol("TrailLanternPost", bm, vcols, mat_solid, col, location=location, flat=True)

    # Kaca lentera berpendar hangat
    bm_g = bmesh.new()
    g_vcols = []
    c_glow = hex_to_rgba("#fbbf24")
    add_cylinder(bm_g, g_vcols, (0.34, 0.0, 0.88), (0.34, 0.0, 1.05), 0.085, 0.095, 6, c_glow)
    create_mesh_with_vcol("TrailLanternGlass", bm_g, g_vcols, mat_glow, col, location=location, flat=True)
    return post


def setup_studio(mat, studio_col):
    world = bpy.data.worlds.new("SummitStudioWorld")
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
        v.co.y *= 0.55
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
                    space.region_3d.view_location = Vector((0.0, 0.0, 0.9))
                    space.region_3d.view_rotation = Euler((math.radians(72.0), 0.0, math.radians(-15.0)), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 7.6


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    s_col = bpy.data.collections.new("SummitSet")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(s_col)
    bpy.context.scene.collection.children.link(studio_col)

    mat_solid = build_material("SummitSolidMat", roughness=0.78)
    mat_glow = build_material("SummitGlowMat", roughness=0.25, emission_strength=2.8)

    build_summit_flag_monument(mat_solid, mat_glow, s_col, location=(-1.9, 0.0, 0.0))
    build_mystery_supply_crate(mat_solid, mat_glow, s_col, location=(0.2, 0.0, 0.0))
    build_trail_lantern_post(mat_solid, mat_glow, s_col, location=(2.1, 0.0, 0.0))

    setup_studio(mat_solid, studio_col)

    total_verts = sum(len(o.data.vertices) for o in s_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in s_col.objects if o.type == "MESH")
    print(f"[SummitSet geometry] objects={len(s_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in s_col.objects:
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
