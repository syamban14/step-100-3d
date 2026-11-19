"""Generate Low-Poly Mountain Forest Trees & Foliage pack (forest_trees.glb + preview PNG)."""

import math
import os
import random
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "forest_trees.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "forest_trees.glb")
PREVIEW_PATH = "/Users/syamban/.gemini/antigravity-cli/brain/af6c04c1-699f-4b22-8483-72ea48865eab/forest_trees_preview.png"

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

    color_attr = mesh.color_attributes.new(name="ForestColor", type="BYTE_COLOR", domain="POINT")
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


def build_material(name, roughness=0.86):
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
    vcol.layer_name = "ForestColor"
    vcol.location = (-120, 100)
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def add_tapered_cylinder(bm, vcols, p0, p1, r0, r1, segs, col_bot, col_top):
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
        vcols.append(col_bot)
        ring1.append(bm.verts.new(v1 + (x_dir * ca + y_dir * sa) * r1))
        vcols.append(col_top)

    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)


def add_pine_tier(bm, vcols, base_z, radius, height, segs, col_outer, col_tip, twist_rad, rng):
    """Add notched faceted pine foliage cone tier."""
    ring = []
    for s in range(segs):
        ang = twist_rad + (s / float(segs)) * math.pi * 2.0
        # Selang-seling sudut sedikit bergerigi seperti ranting cemara low-poly
        r_mod = radius * (1.06 if s % 2 == 0 else 0.84) * rng.uniform(0.94, 1.05)
        z_droop = -0.06 * radius * (1 if s % 2 == 0 else -0.3)
        pt = Vector((math.cos(ang) * r_mod, math.sin(ang) * r_mod, base_z + z_droop))
        ring.append(bm.verts.new(pt))
        vcols.append(col_outer)

    apex = bm.verts.new(Vector((rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), base_z + height)))
    vcols.append(col_tip)
    center_bot = bm.verts.new(Vector((0.0, 0.0, base_z + 0.06)))
    vcols.append(lerp_color(col_outer, hex_to_rgba("#122616"), 0.55))

    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring[s], ring[sn], apex))
        bm.faces.new((ring[sn], ring[s], center_bot))


def build_pine_tree_tall(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(11)

    c_bark_bot = hex_to_rgba("#4a301e")
    c_bark_top = hex_to_rgba("#69462d")
    c_foliage_dark = hex_to_rgba("#1b4d2a")
    c_foliage_mid = hex_to_rgba("#2b6e3c")
    c_foliage_frost = hex_to_rgba("#cfe4db")

    # Batang & akar melebar
    add_tapered_cylinder(bm, vcols, (0, 0, -0.08), (0, 0, 1.05), 0.24, 0.14, 7, c_bark_bot, c_bark_top)
    add_tapered_cylinder(bm, vcols, (0, 0, 1.0), (0, 0, 3.2), 0.14, 0.04, 6, c_bark_top, c_bark_top)

    tiers = [
        (0.88, 1.05, 1.12, c_foliage_dark, c_foliage_mid),
        (1.62, 0.86, 1.02, c_foliage_dark, c_foliage_mid),
        (2.32, 0.66, 0.92, c_foliage_mid, lerp_color(c_foliage_mid, c_foliage_frost, 0.35)),
        (2.94, 0.44, 0.82, lerp_color(c_foliage_mid, c_foliage_frost, 0.25), c_foliage_frost),
    ]
    for idx, (bz, r, h, c_out, c_tip) in enumerate(tiers):
        add_pine_tier(bm, vcols, bz, r, h, 10, c_out, c_tip, idx * 0.31, rng)

    return create_mesh_with_vcol("PineTreeTall", bm, vcols, mat, col, location=location, flat=True)


def build_pine_tree_medium(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(22)

    c_bark_bot = hex_to_rgba("#472d1b")
    c_bark_top = hex_to_rgba("#634128")
    c_leaf_a = hex_to_rgba("#1f5732")
    c_leaf_b = hex_to_rgba("#388248")

    add_tapered_cylinder(bm, vcols, (0, 0, -0.06), (0.03, -0.02, 2.35), 0.20, 0.04, 7, c_bark_bot, c_bark_top)
    tiers = [
        (0.68, 0.92, 0.95, c_leaf_a, c_leaf_b),
        (1.32, 0.72, 0.88, c_leaf_a, c_leaf_b),
        (1.92, 0.48, 0.78, c_leaf_b, lerp_color(c_leaf_b, hex_to_rgba("#7cc96b"), 0.35)),
    ]
    for idx, (bz, r, h, c_out, c_tip) in enumerate(tiers):
        add_pine_tier(bm, vcols, bz, r, h, 9, c_out, c_tip, idx * 0.42, rng)

    return create_mesh_with_vcol("PineTreeMedium", bm, vcols, mat, col, location=location, flat=True)


def add_icosphere_cluster(bm, vcols, center, radius, scale_xyz, col_bot, col_top, rng):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=radius)
    vmap = {}
    for v in tmp.verts:
        p = Vector((
            center[0] + v.co.x * scale_xyz[0] * rng.uniform(0.9, 1.1),
            center[1] + v.co.y * scale_xyz[1] * rng.uniform(0.9, 1.1),
            center[2] + v.co.z * scale_xyz[2] * rng.uniform(0.9, 1.1),
        ))
        nv = bm.verts.new(p)
        vmap[v] = nv
        t = (v.co.z / radius + 1.0) * 0.5
        vcols.append(lerp_color(col_bot, col_top, t))
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def build_broadleaf_tree(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(33)

    c_bark = hex_to_rgba("#5c3d28")
    c_bark_light = hex_to_rgba("#7a5438")
    c_leaf_bot = hex_to_rgba("#2f6f35")
    c_leaf_top = hex_to_rgba("#67b54a")

    # Batang & dua cabang utama
    add_tapered_cylinder(bm, vcols, (0, 0, -0.06), (0.04, 0.02, 1.35), 0.21, 0.11, 7, c_bark, c_bark_light)
    add_tapered_cylinder(bm, vcols, (0.02, 0.0, 1.05), (-0.42, 0.18, 1.72), 0.09, 0.05, 6, c_bark_light, c_bark_light)
    add_tapered_cylinder(bm, vcols, (0.03, 0.02, 1.15), (0.38, -0.15, 1.80), 0.08, 0.04, 6, c_bark_light, c_bark_light)

    clusters = [
        ((0.0, 0.0, 2.05), 0.72, (1.1, 1.05, 0.85)),
        ((-0.48, 0.22, 1.82), 0.52, (1.0, 1.0, 0.88)),
        ((0.46, -0.18, 1.88), 0.50, (1.05, 0.95, 0.86)),
        ((0.12, 0.42, 1.92), 0.44, (1.0, 1.0, 0.85)),
    ]
    for c_pos, rad, scl in clusters:
        add_icosphere_cluster(bm, vcols, c_pos, rad, scl, c_leaf_bot, c_leaf_top, rng)

    return create_mesh_with_vcol("BroadleafTree", bm, vcols, mat, col, location=location, flat=True)


def build_bush_and_fern(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(44)

    c_dark = hex_to_rgba("#265c2b")
    c_mid = hex_to_rgba("#448f3d")
    c_bright = hex_to_rgba("#7bc452")

    # Gugusan semak bulat low-poly
    add_icosphere_cluster(bm, vcols, (0.0, 0.0, 0.28), 0.42, (1.15, 1.1, 0.78), c_dark, c_mid, rng)
    add_icosphere_cluster(bm, vcols, (-0.32, 0.12, 0.22), 0.30, (1.05, 1.0, 0.78), c_dark, c_bright, rng)
    add_icosphere_cluster(bm, vcols, (0.30, -0.14, 0.24), 0.28, (1.0, 1.05, 0.82), c_dark, c_bright, rng)

    # Helai pakis gunung mencuat di sekeliling
    for i in range(7):
        ang = (i / 7.0) * math.pi * 2.0 + 0.2
        dx, dy = math.cos(ang), math.sin(ang)
        sx, sy = -dy, dx
        v0 = bm.verts.new((dx * 0.22 - sx * 0.07, dy * 0.22 - sy * 0.07, 0.14))
        v1 = bm.verts.new((dx * 0.22 + sx * 0.07, dy * 0.22 + sy * 0.07, 0.14))
        v2 = bm.verts.new((dx * 0.62, dy * 0.62, 0.48))
        v3 = bm.verts.new((dx * 0.82, dy * 0.82, 0.36))
        vcols.extend([c_dark, c_dark, c_mid, c_bright])
        bm.faces.new((v0, v1, v2))
        bm.faces.new((v1, v3, v2))

    return create_mesh_with_vcol("ForestBushFern", bm, vcols, mat, col, location=location, flat=True)


def build_fallen_moss_log(mat, col, location):
    bm = bmesh.new()
    vcols = []
    rng = random.Random(55)

    c_bark = hex_to_rgba("#5a3b24")
    c_cut = hex_to_rgba("#b08657")
    c_moss = hex_to_rgba("#529e40")
    c_shroom = hex_to_rgba("#f59e0b")

    # Batang kayu roboh horizontal
    add_tapered_cylinder(bm, vcols, (-0.75, 0.0, 0.18), (0.75, 0.06, 0.20), 0.21, 0.18, 8, c_bark, c_bark)
    # Penampang potongan ujung cerah
    add_tapered_cylinder(bm, vcols, (-0.76, 0.0, 0.18), (-0.74, 0.0, 0.18), 0.17, 0.17, 8, c_cut, c_cut)
    # Bercak lumut & jamur kecil di atas batang
    add_icosphere_cluster(bm, vcols, (-0.15, 0.02, 0.34), 0.16, (1.6, 0.9, 0.45), c_moss, c_moss, rng)
    add_icosphere_cluster(bm, vcols, (0.28, 0.04, 0.33), 0.13, (1.2, 0.85, 0.45), c_moss, c_moss, rng)
    add_icosphere_cluster(bm, vcols, (0.08, -0.05, 0.40), 0.065, (1.1, 1.1, 0.65), c_shroom, c_shroom, rng)

    return create_mesh_with_vcol("FallenMossLog", bm, vcols, mat, col, location=location, flat=True)


def setup_studio(mat, studio_col):
    world = bpy.data.worlds.new("ForestStudioWorld")
    bpy.context.scene.world = world
    if not world.use_nodes:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_rgba("#9bd4f5")
        bg.inputs["Strength"].default_value = 0.85

    # Alas rumput showcase hanya di koleksi Studio (tidak ikut ekspor GLB)
    bm_floor = bmesh.new()
    vcols = []
    c_floor = hex_to_rgba("#4c8f43")
    bmesh.ops.create_grid(bm_floor, x_segments=12, y_segments=6, size=8.0)
    for v in bm_floor.verts:
        v.co.y *= 0.45
        v.co.z = -0.05
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
    cam_data.lens = 36.0
    cam_obj = bpy.data.objects.new("PreviewCamera", cam_data)
    cam_obj.location = (0.15, -14.2, 4.0)
    cam_dir = Vector((0.15, 0.0, 1.35)) - cam_obj.location
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
                    space.region_3d.view_location = Vector((0.15, 0.0, 1.35))
                    space.region_3d.view_rotation = Euler((math.radians(78.0), 0.0, 0.0), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 14.5


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    f_col = bpy.data.collections.new("ForestTrees")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(f_col)
    bpy.context.scene.collection.children.link(studio_col)

    mat = build_material("ForestPackMat", roughness=0.86)

    build_pine_tree_tall(mat, f_col, location=(-4.4, 0.0, 0.0))
    build_pine_tree_medium(mat, f_col, location=(-2.0, 0.0, 0.0))
    build_broadleaf_tree(mat, f_col, location=(0.4, 0.0, 0.0))
    build_bush_and_fern(mat, f_col, location=(2.7, 0.0, 0.0))
    build_fallen_moss_log(mat, f_col, location=(4.8, 0.0, 0.0))

    setup_studio(mat, studio_col)

    total_verts = sum(len(o.data.vertices) for o in f_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in f_col.objects if o.type == "MESH")
    print(f"[ForestTrees geometry] objects={len(f_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    scene = bpy.context.scene
    available_engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available_engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"[Rendered preview] {PREVIEW_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in f_col.objects:
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
