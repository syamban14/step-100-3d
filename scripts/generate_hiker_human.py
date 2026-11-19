"""Generate Low-Poly Articulated Human Hiker Character with 4 Hat Variants (hiker_human.blend & .glb)."""

import math
import os
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "hiker_human.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "hiker_human.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)


def hex_to_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    c = Color((r, g, b)).from_srgb_to_scene_linear()
    return (c.r, c.g, c.b, alpha)


def make_mat(name, color_hex, roughness=0.72, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    rgba = hex_to_rgba(color_hex)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0 and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def finalize_mesh(name, bm, mat, col, location=(0.0, 0.0, 0.0), parent=None, flat=True):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = not flat

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    col.objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    return obj


def create_multi_mat_mesh(name, parts, col, location=(0.0, 0.0, 0.0), parent=None, flat=True):
    """Build single mesh with multiple material slots: parts = [(bm, mat), ...]."""
    combined = bmesh.new()
    mats = []
    for mat_idx, (part_bm, mat) in enumerate(parts):
        mats.append(mat)
        vmap = {}
        for v in part_bm.verts:
            vmap[v] = combined.verts.new(v.co)
        for f in part_bm.faces:
            nf = combined.faces.new([vmap[v] for v in f.verts])
            nf.material_index = mat_idx
        part_bm.free()

    mesh = bpy.data.meshes.new(name)
    combined.normal_update()
    combined.to_mesh(mesh)
    combined.free()

    for poly in mesh.polygons:
        poly.use_smooth = not flat

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    for m in mats:
        obj.data.materials.append(m)
    col.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def add_tapered_limb(bm, p0, p1, r0x, r0y, r1x, r1y, segs=8):
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
        ring0.append(bm.verts.new(v0 + x_dir * (ca * r0x) + y_dir * (sa * r0y)))
        ring1.append(bm.verts.new(v1 + x_dir * (ca * r1x) + y_dir * (sa * r1y)))
    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)


def add_box(bm, center, size, rot_euler=(0.0, 0.0, 0.0)):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    mat = Matrix.Translation(center) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    vmap = {}
    for v in tmp.verts:
        vmap[v] = bm.verts.new(mat @ v.co)
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def add_icosphere(bm, center, radius, scale=(1.0, 1.0, 1.0), subdiv=1):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
    vmap = {}
    for v in tmp.verts:
        vmap[v] = bm.verts.new((
            center[0] + v.co.x * scale[0],
            center[1] + v.co.y * scale[1],
            center[2] + v.co.z * scale[2],
        ))
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def build_torso(mats, col, parent):
    # Karakter menghadap -Y (forward = -Y di Blender, +Z di Three.js)
    bm_jacket = bmesh.new()
    # Dada, bahu, pinggang jaket berkerah
    add_tapered_limb(bm_jacket, (0, 0, 0.68), (0, 0, 0.94), 0.16, 0.115, 0.21, 0.135, segs=10)
    add_tapered_limb(bm_jacket, (0, 0, 0.94), (0, 0, 1.15), 0.21, 0.135, 0.16, 0.105, segs=10)
    # Kerah jaket
    add_tapered_limb(bm_jacket, (0, 0, 1.13), (0, 0, 1.20), 0.105, 0.095, 0.115, 0.10, segs=8)

    bm_pants = bmesh.new()
    # Pinggul celana gunung
    add_tapered_limb(bm_pants, (0, 0, 0.56), (0, 0, 0.70), 0.165, 0.12, 0.162, 0.118, segs=10)

    bm_belt = bmesh.new()
    add_tapered_limb(bm_belt, (0, 0, 0.67), (0, 0, 0.72), 0.172, 0.125, 0.172, 0.125, segs=10)
    # Gesper depan (-Y)
    add_box(bm_belt, (0, -0.125, 0.695), (0.06, 0.025, 0.055))

    bm_pack = bmesh.new()
    # Ransel gunung di punggung (+Y)
    add_box(bm_pack, (0, 0.18, 0.92), (0.28, 0.16, 0.36), (0.06, 0, 0))
    add_box(bm_pack, (0, 0.19, 1.10), (0.30, 0.18, 0.09), (0.06, 0, 0))

    bm_accent = bmesh.new()
    # Matras gulung di atas ransel + lis kantong depan jaket
    add_tapered_limb(bm_accent, (-0.15, 0.20, 1.18), (0.15, 0.20, 1.18), 0.055, 0.055, 0.055, 0.055, segs=8)
    add_box(bm_accent, (0, -0.132, 0.92), (0.04, 0.02, 0.38))

    return create_multi_mat_mesh(
        "HikerTorso",
        [
            (bm_jacket, mats["jacket"]),
            (bm_pants, mats["pants"]),
            (bm_belt, mats["belt"]),
            (bm_pack, mats["backpack"]),
            (bm_accent, mats["accent"]),
        ],
        col,
        location=(0, 0, 0),
        parent=parent,
    )


def build_head_and_hats(mats, col, parent):
    # Pivot leher di (0, 0, 1.18)
    bm_skin = bmesh.new()
    add_tapered_limb(bm_skin, (0, 0, -0.02), (0, 0, 0.08), 0.065, 0.065, 0.062, 0.062, segs=8)
    add_icosphere(bm_skin, (0, 0, 0.20), 0.155, scale=(0.94, 0.98, 1.05), subdiv=2)
    # Hidung kecil menghadap -Y
    add_box(bm_skin, (0, -0.152, 0.18), (0.036, 0.042, 0.045))
    # Telinga kiri-kanan
    add_icosphere(bm_skin, (0.145, 0.01, 0.19), 0.036, scale=(0.55, 0.85, 1.0), subdiv=1)
    add_icosphere(bm_skin, (-0.145, 0.01, 0.19), 0.036, scale=(0.55, 0.85, 1.0), subdiv=1)

    bm_hair = bmesh.new()
    add_icosphere(bm_hair, (0, 0.025, 0.24), 0.158, scale=(0.98, 1.02, 0.92), subdiv=1)

    bm_eye = bmesh.new()
    for sx in (-0.056, 0.056):
        add_icosphere(bm_eye, (sx, -0.135, 0.215), 0.023, scale=(0.9, 0.7, 1.1), subdiv=1)

    head_obj = create_multi_mat_mesh(
        "HikerHead",
        [(bm_skin, mats["skin"]), (bm_hair, mats["hair"]), (bm_eye, mats["eye"])],
        col,
        location=(0, 0, 1.18),
        parent=parent,
    )

    # 1. Topi Explorer (Fedora Petualang)
    bm_h1_acc = bmesh.new()
    add_tapered_limb(bm_h1_acc, (0, 0, 0.30), (0, 0, 0.33), 0.25, 0.27, 0.24, 0.26, segs=12)
    bm_h1_jak = bmesh.new()
    add_tapered_limb(bm_h1_jak, (0, 0, 0.32), (0, 0, 0.44), 0.15, 0.16, 0.11, 0.12, segs=10)
    create_multi_mat_mesh("Hat_explorer", [(bm_h1_acc, mats["accent"]), (bm_h1_jak, mats["jacket"])], col, parent=head_obj)

    # 2. Helm Pendaki (Knight)
    bm_h2_acc = bmesh.new()
    add_icosphere(bm_h2_acc, (0, 0.01, 0.26), 0.178, scale=(1.02, 1.06, 0.92), subdiv=2)
    bm_h2_jak = bmesh.new()
    add_box(bm_h2_jak, (0, 0.0, 0.41), (0.045, 0.24, 0.09))
    add_box(bm_h2_jak, (0, -0.15, 0.30), (0.20, 0.09, 0.03), (-0.2, 0, 0))
    create_multi_mat_mesh("Hat_knight", [(bm_h2_acc, mats["accent"]), (bm_h2_jak, mats["jacket"])], col, parent=head_obj)

    # 3. Kacamata Visor & Antena (Mecha)
    bm_h3_vis = bmesh.new()
    add_box(bm_h3_vis, (0, -0.145, 0.215), (0.22, 0.055, 0.065))
    bm_h3_acc = bmesh.new()
    add_tapered_limb(bm_h3_acc, (0.155, 0, 0.22), (0.155, 0, 0.46), 0.022, 0.022, 0.014, 0.014, segs=6)
    add_icosphere(bm_h3_acc, (0.155, 0, 0.48), 0.036, subdiv=1)
    create_multi_mat_mesh("Hat_mecha", [(bm_h3_vis, mats["visor"]), (bm_h3_acc, mats["accent"])], col, parent=head_obj)

    # 4. Kupluk Gunung Bertelinga Kucing (Neko)
    bm_h4_jak = bmesh.new()
    add_icosphere(bm_h4_jak, (0, 0.01, 0.27), 0.172, scale=(1.0, 1.04, 0.85), subdiv=1)
    for sx in (-0.11, 0.11):
        add_tapered_limb(bm_h4_jak, (sx, 0.0, 0.34), (sx * 1.15, 0.0, 0.50), 0.065, 0.045, 0.012, 0.012, segs=4)
    bm_h4_acc = bmesh.new()
    add_tapered_limb(bm_h4_acc, (0, 0.01, 0.26), (0, 0.01, 0.31), 0.176, 0.182, 0.176, 0.182, segs=12)
    create_multi_mat_mesh("Hat_neko", [(bm_h4_jak, mats["jacket"]), (bm_h4_acc, mats["accent"])], col, parent=head_obj)

    return head_obj


def build_arms(mats, col, parent):
    # Pivot bahu di (±0.23, 0, 1.12), lengan menggantung ke bawah (-Z lokal)
    arms = []
    for side_name, sgn, has_pole in [("ArmL", 1.0, True), ("ArmR", -1.0, False)]:
        bm_sleeve = bmesh.new()
        add_icosphere(bm_sleeve, (0, 0, -0.02), 0.068, scale=(1.0, 1.0, 1.0), subdiv=1)
        add_tapered_limb(bm_sleeve, (0, 0, -0.02), (sgn * 0.03, -0.02, -0.36), 0.062, 0.062, 0.050, 0.050, segs=8)

        bm_hand = bmesh.new()
        add_tapered_limb(bm_hand, (sgn * 0.03, -0.02, -0.36), (sgn * 0.03, -0.04, -0.45), 0.042, 0.042, 0.036, 0.036, segs=8)
        add_icosphere(bm_hand, (sgn * 0.03, -0.045, -0.47), 0.045, scale=(0.9, 1.0, 1.15), subdiv=1)

        parts = [(bm_sleeve, mats["jacket"]), (bm_hand, mats["skin"])]

        if has_pole:
            bm_pole = bmesh.new()
            # Tongkat trekking pendaki miring sedikit ke depan (-Y) menyentuh tanah
            add_tapered_limb(bm_pole, (sgn * 0.04, -0.05, -0.36), (sgn * 0.05, -0.18, -1.12), 0.016, 0.016, 0.012, 0.012, segs=6)
            add_tapered_limb(bm_pole, (sgn * 0.05, -0.16, -1.02), (sgn * 0.05, -0.165, -1.04), 0.045, 0.045, 0.045, 0.045, segs=8)
            parts.append((bm_pole, mats["pole"]))

        arm_obj = create_multi_mat_mesh(side_name, parts, col, location=(sgn * 0.23, 0, 1.12), parent=parent)
        arms.append(arm_obj)
    return arms


def build_legs(mats, col, parent):
    # Pivot paha di (±0.10, 0, 0.62), kaki menggantung ke bawah hingga telapak di z = -0.62 (world z = 0)
    legs = []
    for side_name, sgn in [("LegL", 1.0), ("LegR", -1.0)]:
        bm_pants = bmesh.new()
        add_icosphere(bm_pants, (0, 0, 0.0), 0.078, scale=(1.0, 1.0, 1.0), subdiv=1)
        add_tapered_limb(bm_pants, (0, 0, 0.0), (0, 0, -0.48), 0.075, 0.075, 0.055, 0.055, segs=8)

        bm_boot = bmesh.new()
        # Sepatu boot pendaki kokoh dengan ujung kaki menghadap -Y
        add_tapered_limb(bm_boot, (0, 0, -0.46), (0, 0, -0.58), 0.062, 0.062, 0.065, 0.065, segs=8)
        add_box(bm_boot, (0, -0.045, -0.585), (0.115, 0.20, 0.07))

        leg_obj = create_multi_mat_mesh(
            side_name,
            [(bm_pants, mats["pants"]), (bm_boot, mats["boot"])],
            col,
            location=(sgn * 0.10, 0, 0.62),
            parent=parent,
        )
        legs.append(leg_obj)
    return legs


def setup_studio(col):
    world = bpy.data.worlds.new("HikerStudioWorld")
    bpy.context.scene.world = world
    if hasattr(world, "use_nodes") and not world.use_nodes:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_rgba("#9bd4f5")
        bg.inputs["Strength"].default_value = 0.85

    sun = bpy.data.lights.new("SunKey", type="SUN")
    sun.energy = 2.8
    sun_obj = bpy.data.objects.new("SunKey", sun)
    sun_obj.rotation_euler = (math.radians(50), math.radians(15), math.radians(-30))
    col.objects.link(sun_obj)

    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True
                if space.region_3d is not None:
                    space.region_3d.view_perspective = "PERSP"
                    space.region_3d.view_location = Vector((0, 0, 0.85))
                    space.region_3d.view_rotation = Euler((math.radians(74.0), 0.0, math.radians(-22.0)), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 3.2


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    h_col = bpy.data.collections.new("HikerHuman")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(h_col)
    bpy.context.scene.collection.children.link(studio_col)

    mats = {
        "jacket": make_mat("JacketMat", "#ff5e57", roughness=0.72),
        "accent": make_mat("AccentMat", "#ffd32a", roughness=0.65),
        "pants": make_mat("PantsMat", "#334155", roughness=0.84),
        "skin": make_mat("SkinMat", "#f5cba7", roughness=0.68),
        "hair": make_mat("HairMat", "#2c1e16", roughness=0.80),
        "eye": make_mat("EyeMat", "#111827", roughness=0.25),
        "belt": make_mat("BeltMat", "#5c3a21", roughness=0.75),
        "backpack": make_mat("BackpackMat", "#15803d", roughness=0.80),
        "boot": make_mat("BootMat", "#451a03", roughness=0.82),
        "pole": make_mat("PoleMat", "#cbd5e1", roughness=0.4, metallic=0.6),
        "visor": make_mat("VisorMat", "#38bdf8", roughness=0.2, emission=1.4),
    }

    root = bpy.data.objects.new("HikerRoot", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.25
    h_col.objects.link(root)

    build_torso(mats, h_col, root)
    build_head_and_hats(mats, h_col, root)
    build_arms(mats, h_col, root)
    build_legs(mats, h_col, root)
    setup_studio(studio_col)

    total_verts = sum(len(o.data.vertices) for o in h_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in h_col.objects if o.type == "MESH")
    print(f"[HikerHuman geometry] objects={len(h_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in h_col.objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
    )
    print(f"[Exported] {GLB_PATH}")


if __name__ == "__main__":
    main()
