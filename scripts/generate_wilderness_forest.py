"""Generate High-Canopy Wilderness Dark-World Forest (wilderness_forest.glb) for TPP/FPP POV."""

import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import generate_mountain_trail as mt

BASE_DIR = os.path.dirname(SCRIPTS_DIR)
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "wilderness_forest.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "wilderness_forest.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)

WILDERNESS_ZONES = [(15, 22), (45, 50), (63, 68)]
SHADE_GROVE_ZONES = [(6, 11), (29, 35), (77, 83)]
HAZARD_ENDPOINT_TILES = (
    4, 25, 13, 46, 33, 49, 42, 63, 50, 69, 62, 81, 74, 92, 84, 97,
    27, 5, 40, 3, 66, 45, 89, 53, 43, 18, 54, 31, 76, 58, 99, 41,
)


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


def point_seg_dist_2d(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    len2 = vx * vx + vy * vy
    if len2 < 1e-8:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / len2))
    projx = ax + t * vx
    projy = ay + t * vy
    return math.hypot(px - projx, py - projy)


def create_mesh_with_vcol(name, bm, vert_colors, material, collection, flat=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = not flat

    color_attr = mesh.color_attributes.new(name="WildernessColor", type="BYTE_COLOR", domain="POINT")
    mesh.color_attributes.active_color = color_attr
    for idx, rgba in enumerate(vert_colors):
        if idx < len(color_attr.data):
            color_attr.data[idx].color = rgba

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def build_material(name, roughness=0.88, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (220, 0)
    bsdf.inputs["Roughness"].default_value = roughness
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "WildernessColor"
    vcol.location = (-120, 120)
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])

    if emission_strength > 0.0 and "Emission Color" in bsdf.inputs:
        nt.links.new(vcol.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission_strength
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


def add_canopy_dome(bm, vcols, center, radius, scale_xyz, col_bot, col_top, rng):
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=radius)
    vmap = {}
    for v in tmp.verts:
        p = Vector((
            center[0] + v.co.x * scale_xyz[0] * rng.uniform(0.90, 1.12),
            center[1] + v.co.y * scale_xyz[1] * rng.uniform(0.90, 1.12),
            center[2] + v.co.z * scale_xyz[2] * rng.uniform(0.92, 1.10),
        ))
        nv = bm.verts.new(p)
        vmap[v] = nv
        t = (v.co.z / max(1e-4, radius) + 1.0) * 0.5
        vcols.append(lerp_color(col_bot, col_top, t))
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def build_high_canopy_tree_template(mat, col):
    """Tall dark-bark trunk (bare up to +2.85m) with overarching high canopy above +2.85..+4.35m along +X."""
    bm = bmesh.new()
    vcols = []
    rng = random.Random(901)

    c_bark_bot = hex_to_rgba("#1e1614")
    c_bark_top = hex_to_rgba("#2f2421")
    c_canopy_dark = hex_to_rgba("#0b2e28")
    c_canopy_mid = hex_to_rgba("#0f3f3a")
    c_canopy_top = hex_to_rgba("#134e4a")

    # Batang polos ramping hingga z = 2.85m agar pandang TPP/FPP & karakter 1.45m benar-benar bebas hambatan
    add_tapered_cylinder(bm, vcols, (0.0, 0.0, -0.15), (0.04, 0.0, 1.55), 0.15, 0.12, 7, c_bark_bot, c_bark_bot)
    add_tapered_cylinder(bm, vcols, (0.04, 0.0, 1.50), (0.22, 0.0, 2.95), 0.12, 0.08, 7, c_bark_bot, c_bark_top)
    # Cabang melengkung tinggi ke arah jalur (+X) di atas ketinggian kepala (>2.85m)
    add_tapered_cylinder(bm, vcols, (0.20, 0.0, 2.86), (1.15, 0.12, 3.45), 0.08, 0.04, 6, c_bark_top, c_bark_top)
    add_tapered_cylinder(bm, vcols, (0.18, 0.0, 2.92), (-0.42, -0.18, 3.50), 0.07, 0.04, 6, c_bark_top, c_bark_top)

    # Tajuk kanopi melengkung tinggi di +2.85m .. +4.35m
    clusters = [
        ((0.25, 0.0, 3.55), 0.92, (1.15, 1.05, 0.65)),
        ((1.10, 0.15, 3.58), 0.85, (1.25, 1.00, 0.62)),
        ((1.75, -0.10, 3.48), 0.68, (1.15, 0.95, 0.56)),
        ((-0.45, -0.20, 3.65), 0.72, (1.05, 0.95, 0.60)),
        ((0.55, 0.45, 3.72), 0.65, (1.00, 1.00, 0.58)),
    ]
    for c_pos, rad, scl in clusters:
        c_hi = lerp_color(c_canopy_mid, c_canopy_top, rng.uniform(0.3, 1.0))
        add_canopy_dome(bm, vcols, c_pos, rad, scl, c_canopy_dark, c_hi, rng)

    return create_mesh_with_vcol("WildernessCanopyTree", bm, vcols, mat, col, flat=True)


def build_glow_mushroom_template(mat, col):
    """Low bioluminescent cyan/purple forest-floor mushroom cluster (height <= 0.28m)."""
    bm = bmesh.new()
    vcols = []

    c_stem = hex_to_rgba("#cffafe")
    c_cyan = hex_to_rgba("#22d3ee")
    c_purple = hex_to_rgba("#c084fc")

    mushrooms = [
        ((0.0, 0.0), 0.25, 0.14, c_cyan),
        ((-0.13, 0.09), 0.18, 0.10, c_purple),
        ((0.12, -0.07), 0.15, 0.09, c_cyan),
    ]
    for (mx, my), h, cap_r, cap_col in mushrooms:
        stem_top = h - 0.04
        add_tapered_cylinder(bm, vcols, (mx, my, -0.03), (mx, my, stem_top), 0.028, 0.020, 6, c_stem, c_stem)
        add_tapered_cylinder(bm, vcols, (mx, my, stem_top - 0.01), (mx, my, h), cap_r, cap_r * 0.28, 7, cap_col, cap_col)

    return create_mesh_with_vcol("WildernessGlowMushroom", bm, vcols, mat, col, flat=True)


def spawn_instance(template_obj, name, col, loc, rot_z=0.0, scale=1.0):
    obj = bpy.data.objects.new(name, template_obj.data)
    obj.location = loc
    obj.rotation_euler = Euler((0.0, 0.0, rot_z), "XYZ")
    obj.scale = (scale, scale, scale)
    col.objects.link(obj)
    return obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    wf_col = bpy.data.collections.new("WildernessForest")
    bpy.context.scene.collection.children.link(wf_col)

    tree_mat = build_material("WildernessBarkCanopyMat", roughness=0.90, emission_strength=0.0)
    glow_mat = build_material("WildernessGlowMat", roughness=0.35, emission_strength=1.6)

    tree_tmpl = build_high_canopy_tree_template(tree_mat, wf_col)
    mush_tmpl = build_glow_mushroom_template(glow_mat, wf_col)

    trail_samples = mt.build_smooth_trail_samples()
    hazard_segs = []
    for mapping in (mt.LADDERS, mt.STREAMS, mt.LANDSLIDES):
        for f_t, t_t in mapping.items():
            hazard_segs.append((mt.tile_to_trail_point(f_t), mt.tile_to_trail_point(t_t)))
    hazard_pts = [mt.tile_to_trail_point(t) for t in HAZARD_ENDPOINT_TILES]

    def is_clear(x, y, min_trail_dist, min_hazard_dist, min_endpoint_dist):
        for sp in trail_samples:
            if math.hypot(x - sp.x, y - sp.y) < min_trail_dist:
                return False
        for a, b in hazard_segs:
            if point_seg_dist_2d(x, y, a.x, a.y, b.x, b.y) < min_hazard_dist:
                return False
        for hp in hazard_pts:
            if math.hypot(x - hp.x, y - hp.y) < min_endpoint_dist:
                return False
        if math.hypot(x - (-12.4), y - (-13.6)) < 2.8:
            return False
        return True

    rng = random.Random(4550)
    tree_spots = []
    mush_spots = []
    tree_count = 0
    mush_count = 0

    for zone_idx, (t_start, t_end) in enumerate(WILDERNESS_ZONES):
        zone_trees = 0
        zone_mush = 0
        zone_pts = [mt.tile_to_trail_point(t) for t in range(t_start, t_end + 1)]

        # 1. Pohon Kanopi Tinggi di luar jalur (>=1.25m) dan bebas hazard (>=1.45m), tajuk mengarah ke pusat zona
        for z_pt in zone_pts:
            for rad in (1.32, 1.75, 2.25, 2.85, 3.55, 4.35, 5.25, 6.20):
                for a_step in range(24):
                    ang = (a_step / 24.0) * math.pi * 2.0 + rng.uniform(-0.12, 0.12)
                    px = z_pt.x + math.cos(ang) * rad
                    py = z_pt.y + math.sin(ang) * rad
                    if abs(px) > 16.8 or abs(py) > 16.4:
                        continue
                    if not is_clear(px, py, min_trail_dist=1.25, min_hazard_dist=1.45, min_endpoint_dist=1.45):
                        continue
                    if any(math.hypot(px - tx, py - ty) < 0.90 for tx, ty in tree_spots):
                        continue
                    surf_z, _ = mt.sample_surface_height(px, py, trail_samples)
                    if surf_z < 0.25 or surf_z > 9.6:
                        continue

                    # Arahkan dahan kanopi tinggi (+X lokal) mengarah ke z_pt di atas jalur
                    aim_yaw = math.atan2(z_pt.y - py, z_pt.x - px) + rng.uniform(-0.35, 0.35)
                    spawn_instance(
                        tree_tmpl,
                        f"WildernessTree_z{zone_idx}_{tree_count:02d}",
                        wf_col,
                        (px, py, surf_z - 0.08),
                        rot_z=aim_yaw,
                        scale=rng.uniform(0.95, 1.28),
                    )
                    tree_spots.append((px, py))
                    tree_count += 1
                    zone_trees += 1

        # 2. Jamur bercahaya di tepi jalur (0.78..1.15m dari jalur, >=1.20m dari titik hazard)
        for i in range(len(zone_pts) - 1):
            p_a = zone_pts[i]
            p_b = zone_pts[i + 1]
            tx = p_b.x - p_a.x
            ty = p_b.y - p_a.y
            tlen = math.hypot(tx, ty)
            if tlen < 1e-5:
                continue
            tx /= tlen
            ty /= tlen
            nx, ny = -ty, tx
            for u in (0.15, 0.5, 0.85):
                bx = p_a.x + (p_b.x - p_a.x) * u
                by = p_a.y + (p_b.y - p_a.y) * u
                for side in (-1.0, 1.0):
                    off = rng.uniform(0.78, 1.15) * side
                    mx = bx + nx * off
                    my = by + ny * off
                    if not is_clear(mx, my, min_trail_dist=0.72, min_hazard_dist=1.00, min_endpoint_dist=1.20):
                        continue
                    if any(math.hypot(mx - ox, my - oy) < 0.65 for ox, oy in mush_spots):
                        continue
                    mz, _ = mt.sample_surface_height(mx, my, trail_samples)
                    if mz < 0.25 or mz > 9.4:
                        continue
                    spawn_instance(
                        mush_tmpl,
                        f"WildernessMush_z{zone_idx}_{mush_count:02d}",
                        wf_col,
                        (mx, my, mz - 0.02),
                        rot_z=rng.uniform(0.0, math.pi * 2.0),
                        scale=rng.uniform(0.85, 1.25),
                    )
                    mush_spots.append((mx, my))
                    mush_count += 1
                    zone_mush += 1

        print(f"[Wilderness zone {t_start}-{t_end}] trees={zone_trees}, mushrooms={zone_mush}")

    # 3. Kantong teduh alami di beberapa segmen jalur (pohon gede saja tanpa jamur bercahaya)
    grove_total = 0
    for grove_idx, (t_start, t_end) in enumerate(SHADE_GROVE_ZONES):
        grove_trees = 0
        grove_pts = [mt.tile_to_trail_point(t) for t in range(t_start, t_end + 1)]
        for z_pt in grove_pts:
            for rad in (1.35, 1.85, 2.45, 3.15, 4.00, 5.00):
                for a_step in range(24):
                    ang = (a_step / 24.0) * math.pi * 2.0 + rng.uniform(-0.12, 0.12)
                    px = z_pt.x + math.cos(ang) * rad
                    py = z_pt.y + math.sin(ang) * rad
                    if abs(px) > 16.8 or abs(py) > 16.4:
                        continue
                    if not is_clear(px, py, min_trail_dist=1.25, min_hazard_dist=1.45, min_endpoint_dist=1.45):
                        continue
                    if any(math.hypot(px - tx, py - ty) < 1.10 for tx, ty in tree_spots):
                        continue
                    surf_z, _ = mt.sample_surface_height(px, py, trail_samples)
                    if surf_z < 0.25 or surf_z > 10.2:
                        continue

                    aim_yaw = math.atan2(z_pt.y - py, z_pt.x - px) + rng.uniform(-0.35, 0.35)
                    spawn_instance(
                        tree_tmpl,
                        f"WildernessTree_g{grove_idx}_{tree_count:02d}",
                        wf_col,
                        (px, py, surf_z - 0.08),
                        rot_z=aim_yaw,
                        scale=rng.uniform(0.95, 1.28),
                    )
                    tree_spots.append((px, py))
                    tree_count += 1
                    grove_trees += 1
                    grove_total += 1

        print(f"[Shade grove {t_start}-{t_end}] trees={grove_trees}")

    # Hapus dua objek template di origin (0,0,0) agar hanya instance yang tersimpan & terekspor
    bpy.data.objects.remove(tree_tmpl, do_unlink=True)
    bpy.data.objects.remove(mush_tmpl, do_unlink=True)

    print(f"[WildernessForest total] trees={tree_count}, mushrooms={mush_count}")
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in wf_col.objects:
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
