"""Assemble complete Mountain Showcase (.blend) & export lightweight decoration pack (mountain_scenery.glb)."""

import math
import os
import random
import sys
import bpy
from mathutils import Euler, Vector

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import generate_mountain_trail as mt

BASE_DIR = os.path.dirname(SCRIPTS_DIR)
BLEND_DIR = os.path.join(BASE_DIR, "public", "assets", "blend")
MODELS_DIR = os.path.join(BASE_DIR, "public", "assets", "models")
SHOWCASE_BLEND_PATH = os.path.join(BLEND_DIR, "mountain_showcase.blend")
SCENERY_GLB_PATH = os.path.join(MODELS_DIR, "mountain_scenery.glb")


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


def load_collection_templates(blend_filename, collection_name):
    path = os.path.join(BLEND_DIR, blend_filename)
    with bpy.data.libraries.load(path, link=False) as (data_from, data_to):
        if collection_name in data_from.collections:
            data_to.collections = [collection_name]
    templates = {}
    for col in data_to.collections:
        if col is not None:
            for obj in col.objects:
                templates[obj.name] = obj
    return templates


def spawn_instance(template_obj, inst_name, collection, loc, rot_z=0.0, scale=1.0):
    obj = bpy.data.objects.new(inst_name, template_obj.data)
    obj.location = loc
    obj.rotation_euler = Euler((0.0, 0.0, rot_z), "XYZ")
    obj.scale = (scale, scale, scale)
    collection.objects.link(obj)
    return obj


def is_clear_of_trail_and_hazards(x, y, trail_samples, hazard_segs, min_trail_dist=1.42, min_hazard_dist=1.20):
    for sp in trail_samples:
        if math.hypot(x - sp.x, y - sp.y) < min_trail_dist:
            return False
    for a, b in hazard_segs:
        if point_seg_dist_2d(x, y, a.x, a.y, b.x, b.y) < min_hazard_dist:
            return False
    # Area Basecamp depan-kiri
    if math.hypot(x - (-12.4), y - (-13.6)) < 2.9:
        return False
    # Area Summit monument di belakang #100
    p100 = mt.tile_to_trail_point(100)
    if math.hypot(x - p100.x, y - (p100.y + 0.9)) < 1.8:
        return False
    return True


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    # Load koleksi aset
    trail_templates = load_collection_templates("mountain_trail.blend", "MountainTrail")
    tree_templates = load_collection_templates("forest_trees.blend", "ForestTrees")
    rock_templates = load_collection_templates("mountain_rocks.blend", "MountainRocks")
    camp_templates = load_collection_templates("basecamp_set.blend", "BasecampSet")
    summit_templates = load_collection_templates("summit_set.blend", "SummitSet")

    base_col = bpy.data.collections.new("MountainBase")
    scenery_col = bpy.data.collections.new("MountainScenery")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(base_col)
    bpy.context.scene.collection.children.link(scenery_col)
    bpy.context.scene.collection.children.link(studio_col)

    # Link objek gunung utama ke MountainBase (hanya untuk showcase .blend)
    for name, obj in trail_templates.items():
        base_col.objects.link(obj)

    trail_samples = mt.build_smooth_trail_samples()
    hazard_segs = []
    for mapping in (mt.LADDERS, mt.STREAMS, mt.LANDSLIDES):
        for f_t, t_t in mapping.items():
            hazard_segs.append((mt.tile_to_trail_point(f_t), mt.tile_to_trail_point(t_t)))

    rng = random.Random(2026)
    placed_spots = []

    def too_close_to_placed(x, y, min_d):
        return any(math.hypot(x - px, y - py) < min_d for px, py in placed_spots)

    # 1. Hutan Pinus & Pohon Daun Lebar di sisi kiri, kanan, lembah bawah, dan sela lereng
    tree_keys = ["PineTreeTall", "PineTreeMedium", "BroadleafTree"]
    tree_count = 0
    attempts = 0
    while tree_count < 64 and attempts < 2400:
        attempts += 1
        x = rng.uniform(-16.6, 16.6)
        y = rng.uniform(-16.4, 14.5)
        if not is_clear_of_trail_and_hazards(x, y, trail_samples, hazard_segs, min_trail_dist=1.45, min_hazard_dist=1.22):
            continue
        if too_close_to_placed(x, y, 1.55):
            continue
        surf_z, _ = mt.sample_surface_height(x, y, trail_samples)
        if surf_z < 0.15 or surf_z > 9.4:
            continue

        # Pohon daun lebar lebih banyak di lembah bawah (z < 4.5), pinus mendominasi lereng menengah-atas
        if surf_z < 3.6 and rng.random() < 0.38:
            t_key = "BroadleafTree"
        elif surf_z > 5.2 or rng.random() < 0.55:
            t_key = "PineTreeTall"
        else:
            t_key = "PineTreeMedium"

        scl = rng.uniform(0.82, 1.25) * (1.0 if surf_z < 6.0 else 0.85)
        spawn_instance(
            tree_templates[t_key],
            f"Tree_{tree_count:02d}_{t_key}",
            scenery_col,
            (x, y, surf_z - 0.08),
            rot_z=rng.uniform(0.0, math.pi * 2.0),
            scale=scl,
        )
        placed_spots.append((x, y))
        tree_count += 1

    # 2. Semak Pakis & Batang Kayu Berlumut
    foliage_count = 0
    attempts = 0
    while foliage_count < 32 and attempts < 1400:
        attempts += 1
        x = rng.uniform(-16.2, 16.2)
        y = rng.uniform(-16.0, 12.0)
        if not is_clear_of_trail_and_hazards(x, y, trail_samples, hazard_segs, min_trail_dist=1.18, min_hazard_dist=1.05):
            continue
        if too_close_to_placed(x, y, 1.1):
            continue
        surf_z, _ = mt.sample_surface_height(x, y, trail_samples)
        if surf_z < 0.15 or surf_z > 7.6:
            continue

        f_key = "ForestBushFern" if rng.random() < 0.78 else "FallenMossLog"
        spawn_instance(
            tree_templates[f_key],
            f"Foliage_{foliage_count:02d}",
            scenery_col,
            (x, y, surf_z - 0.04),
            rot_z=rng.uniform(0.0, math.pi * 2.0),
            scale=rng.uniform(0.75, 1.15),
        )
        placed_spots.append((x, y))
        foliage_count += 1

    # 3. Batu Tebing, Karang Salju, & Batu Sungai
    rock_count = 0
    attempts = 0
    while rock_count < 26 and attempts < 1200:
        attempts += 1
        x = rng.uniform(-16.4, 16.4)
        y = rng.uniform(-15.2, 14.5)
        if not is_clear_of_trail_and_hazards(x, y, trail_samples, hazard_segs, min_trail_dist=1.30, min_hazard_dist=1.05):
            continue
        if too_close_to_placed(x, y, 1.35):
            continue
        surf_z, _ = mt.sample_surface_height(x, y, trail_samples)
        if surf_z < 0.15:
            continue

        if surf_z > 8.2:
            r_key = "SnowyPeakCrag"
        elif surf_z < 2.5 and rng.random() < 0.45:
            r_key = "RiverStoneCluster"
        else:
            r_key = "CliffBoulderLarge"

        spawn_instance(
            rock_templates[r_key],
            f"Rock_{rock_count:02d}",
            scenery_col,
            (x, y, surf_z - 0.08),
            rot_z=rng.uniform(0.0, math.pi * 2.0),
            scale=rng.uniform(0.75, 1.25),
        )
        placed_spots.append((x, y))
        rock_count += 1

    # 4. Papan Penunjuk Arah di pinggir jalur strategis
    for idx, t_tile in enumerate([2, 28, 56, 88]):
        tp = mt.tile_to_trail_point(t_tile)
        ox = 0.92 if tp.x < 6.0 else -0.92
        oy = -0.55
        sx, sy = tp.x + ox, tp.y + oy
        sz, _ = mt.sample_surface_height(sx, sy, trail_samples)
        spawn_instance(
            rock_templates["TrailSignpost"],
            f"Signpost_{idx}",
            scenery_col,
            (sx, sy, sz - 0.04),
            rot_z=rng.uniform(-0.35, 0.35),
            scale=0.85,
        )

    # 5. Lentera Jalur Pendakian di tikungan switchback & kaki gunung
    lantern_tiles = [0, 10, 21, 40, 51, 70, 81, 91]
    for idx, lt in enumerate(lantern_tiles):
        tp = mt.tile_to_trail_point(lt)
        out_dir = 0.95 if tp.x >= 0 else -0.95
        lx = tp.x + out_dir
        ly = tp.y - 0.42
        lz, _ = mt.sample_surface_height(lx, ly, trail_samples)
        spawn_instance(
            summit_templates["TrailLanternPost"],
            f"LanternPost_{idx}",
            scenery_col,
            (lx, ly, lz - 0.04),
            rot_z=0.0 if out_dir < 0 else math.pi,
            scale=0.82,
        )
        spawn_instance(
            summit_templates["TrailLanternGlass"],
            f"LanternGlass_{idx}",
            scenery_col,
            (lx, ly, lz - 0.04),
            rot_z=0.0 if out_dir < 0 else math.pi,
            scale=0.82,
        )

    # 6. Basecamp Ekspedisi di area pos awal #0
    base_camp_items = [
        ("ExpeditionTent", (-13.6, -13.1), 0.55, 0.95),
        ("CampfirePit", (-11.7, -14.3), 0.0, 0.85),
        ("CampfireFlame", (-11.7, -14.3), 0.0, 0.85),
        ("LogBench", (-10.6, -14.9), 0.65, 0.78),
        ("HikerBackpack", (-12.7, -13.9), -0.45, 0.85),
    ]
    for k, (bx, by), rz, sc in base_camp_items:
        bz, _ = mt.sample_surface_height(bx, by, trail_samples)
        spawn_instance(camp_templates[k], f"Basecamp_{k}", scenery_col, (bx, by, bz - 0.03), rot_z=rz, scale=sc)

    # 7. Tugu Bendera Puncak di belakang batu #100
    p100 = mt.tile_to_trail_point(100)
    sx, sy = p100.x - 0.15, p100.y + 0.95
    sz, _ = mt.sample_surface_height(sx, sy, trail_samples)
    spawn_instance(summit_templates["SummitFlagMonument"], "Summit_FlagMonument", scenery_col, (sx, sy, sz - 0.04), rot_z=0.25, scale=1.05)
    spawn_instance(summit_templates["SummitCrownOrb"], "Summit_CrownOrb", scenery_col, (sx, sy, sz - 0.04), rot_z=0.25, scale=1.05)

    # Studio pencahayaan & kamera untuk Showcase Blender
    mt.setup_studio(studio_col)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True
                if space.region_3d is not None:
                    space.region_3d.view_perspective = "PERSP"
                    space.region_3d.view_location = Vector((0.0, -1.5, 4.4))
                    space.region_3d.view_distance = 36.5

    total_scenery_objs = len(scenery_col.objects)
    total_scenery_polys = sum(len(o.data.polygons) for o in scenery_col.objects if o.type == "MESH")
    print(f"[MountainScenery] instances={total_scenery_objs}, total_instanced_polys={total_scenery_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=SHOWCASE_BLEND_PATH)
    print(f"[Saved] {SHOWCASE_BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in scenery_col.objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=SCENERY_GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_vertex_color="ACTIVE",
    )
    print(f"[Exported] {SCENERY_GLB_PATH}")


if __name__ == "__main__":
    main()
