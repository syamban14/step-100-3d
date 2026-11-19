"""Generate Low-Poly Mountain Landslide Chutes, Debris Rocks & Trail Crossings GLB (mountain_landslides.glb)."""

import json
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPTS_DIR)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from generate_mountain_streams import add_icosphere_to_bm, add_prism_to_bm, resample_catmull_rom
from generate_mountain_trail import (
    LANDSLIDES,
    add_box_to_bm,
    build_material,
    build_smooth_trail_samples,
    create_mesh_with_vcol,
    hex_to_rgba,
    lerp_color,
    sample_surface_height,
    smoothstep,
    tile_to_trail_point,
)

BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "mountain_landslides.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "mountain_landslides.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)


def add_landslide_mound(bm, vcols, center, radius, height, color_top, color_rim, segs=10):
    """Add an irregular faceted earth debris mound / scarp toe anchored into terrain."""
    c_top = bm.verts.new((center.x, center.y, center.z + height))
    vcols.append(color_top)
    ring_top = []
    ring_bot = []
    for s in range(segs):
        ang = (s / float(segs)) * math.pi * 2.0
        r_var = radius * (0.88 + 0.22 * math.sin(s * 2.3))
        px = center.x + math.cos(ang) * r_var
        py = center.y + math.sin(ang) * r_var
        ring_top.append(bm.verts.new((px, py, center.z + 0.02)))
        vcols.append(color_rim)
        ring_bot.append(bm.verts.new((px, py, center.z - 0.18)))
        vcols.append(color_rim)
    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((c_top, ring_top[s], ring_top[sn]))
        bm.faces.new((ring_top[s], ring_bot[s], ring_bot[sn], ring_top[sn]))


def add_landslide_trail_crossing(bm_cross, cross_vcols, center, road_tang, c_plank_a, c_plank_b, c_stone):
    """Build 4 flush wooden stepping planks & trail stones bridging a landslide crossing seamlessly."""
    fwd = Vector((road_tang.x, road_tang.y, 0.0))
    if fwd.length < 1e-5:
        fwd = Vector((1.0, 0.0, 0.0))
    fwd.normalize()
    side = Vector((-fwd.y, fwd.x, 0.0)).normalized()
    yaw = math.atan2(fwd.y, fwd.x)

    # 4 papan pijakan kayu rata tanah menembus alur longsor searah jalan setapak
    offsets = (-0.42, -0.14, 0.14, 0.42)
    for k, s_off in enumerate(offsets):
        pos = Vector((center.x + fwd.x * s_off, center.y + fwd.y * s_off, center.z + 0.026))
        rot_e = Euler((0.0, 0.0, yaw + (0.04 if k % 2 == 0 else -0.04)), "XYZ")
        add_box_to_bm(
            bm_cross,
            cross_vcols,
            pos,
            (0.22, 0.72, 0.045),
            rot_e,
            c_plank_a if (k % 2 == 0) else c_plank_b,
        )

    # Batu pijakan datar pengapit tepi luar papan (sejajar jalan agar bebas halangan)
    for sgn_end in (-0.64, 0.64):
        for sgn_lat in (-0.34, 0.34):
            stone_p = Vector((
                center.x + fwd.x * sgn_end + side.x * sgn_lat,
                center.y + fwd.y * sgn_end + side.y * sgn_lat,
                center.z + 0.012,
            ))
            add_icosphere_to_bm(
                bm_cross,
                cross_vcols,
                stone_p,
                0.11,
                (1.15, 0.95, 0.42),
                Euler((0.0, 0.0, yaw + sgn_end)),
                c_stone,
                subdiv=1,
            )


def generate_landslides_geometry(trail_samples, mats, col):
    """Build 4 grounded low-poly landslide chutes, debris boulders, and flush road crossings."""
    bm_chute = bmesh.new()
    chute_vcols = []

    bm_rocks = bmesh.new()
    rock_vcols = []

    bm_cross = bmesh.new()
    cross_vcols = []

    c_soil_deep = hex_to_rgba("#8c3b10")
    c_soil_scar = hex_to_rgba("#a84b18")
    c_gravel = hex_to_rgba("#b8622a")
    c_berm = hex_to_rgba("#786452")

    c_rock_palette = [
        hex_to_rgba("#6b655e"),
        hex_to_rgba("#847c72"),
        hex_to_rgba("#57534e"),
        hex_to_rgba("#94714f"),
    ]
    c_plank_a = hex_to_rgba("#8e5b2e")
    c_plank_b = hex_to_rgba("#a36d3c")
    c_flat_stone = hex_to_rgba("#918b82")

    row_gaps = {r: [] for r in range(10)}
    for tile in range(1, 101):
        if tile % 10 != 0:
            r = (tile - 1) // 10
            p_a = tile_to_trail_point(tile)
            p_b = tile_to_trail_point(tile + 1)
            mid = (p_a + p_b) * 0.5
            tang = Vector((p_b.x - p_a.x, p_b.y - p_a.y, 0.0)).normalized()
            row_gaps[r].append((mid, tang))

    rng = random.Random(909)
    landslide_curves_three = {}
    crossing_count = 0

    for idx, (from_tile, to_tile) in enumerate(LANDSLIDES.items()):
        p_from = tile_to_trail_point(from_tile)
        p_to = tile_to_trail_point(to_tile)

        h_delta = Vector((p_to.x - p_from.x, p_to.y - p_from.y, 0.0))
        h_dir = h_delta.normalized() if h_delta.length > 1e-5 else Vector((0.0, -1.0, 0.0))

        # Pangkal patahan atas & gundukan runtuhan bawah di bibir batu pijakan
        p_start = p_from + Vector((h_dir.x * 0.16, -0.46, 0.02))
        p_end = p_to + Vector((-h_dir.x * 0.16, 0.46, 0.02))
        s_start_z, _ = sample_surface_height(p_start.x, p_start.y, trail_samples)
        s_end_z, _ = sample_surface_height(p_end.x, p_end.y, trail_samples)
        p_start.z = max(p_from.z + 0.02, s_start_z + 0.03)
        p_end.z = max(p_to.z + 0.02, s_end_z + 0.03)

        row_from = (from_tile - 1) // 10
        row_to = (to_tile - 1) // 10
        line_vec = Vector((p_end.x - p_start.x, p_end.y - p_start.y, 0.0))
        line_len = max(1e-5, line_vec.length)

        anchors = [p_start]
        cross_points = []
        for r in range(row_from - 1, row_to, -1):
            candidates = row_gaps.get(r, [])
            if not candidates:
                continue
            best_gap = min(
                candidates,
                key=lambda g: abs((g[0].x - p_start.x) * line_vec.y - (g[0].y - p_start.y) * line_vec.x) / line_len
                + 0.10 * math.hypot(g[0].x - p_start.x, g[0].y - p_start.y),
            )
            cross_p, road_tang = best_gap
            n_down = Vector((-road_tang.y, road_tang.x, 0.0)).normalized()
            if n_down.y > 0.0:
                n_down = -n_down

            anchors.extend([cross_p - n_down * 0.44, cross_p.copy(), cross_p + n_down * 0.44])
            cross_points.append((cross_p.copy(), road_tang.copy()))

        anchors.append(p_end)

        segs = 44
        pts = resample_catmull_rom(anchors, segs)

        stream_axis = line_vec.normalized()
        d_roads = []
        near_road_z = []
        for i in range(segs + 1):
            t = i / float(segs)
            min_dr = 9999.0
            nr_z = pts[i].z
            for cp, _ in cross_points:
                dc = math.hypot(pts[i].x - cp.x, pts[i].y - cp.y)
                if dc < min_dr:
                    min_dr = dc
                    nr_z = cp.z

            if 0 < i < segs:
                road_mask = smoothstep(0.55, 1.35, min_dr)
                p_prev = pts[max(0, i - 1)]
                p_next = pts[min(segs, i + 1)]
                loc_axis = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0))
                loc_perp = Vector((-loc_axis.y, loc_axis.x, 0.0)).normalized() if loc_axis.length > 1e-5 else Vector((1.0, 0.0, 0.0))
                swirl = math.sin(t * math.pi * 2.5 - idx * 1.1) * 0.18 * road_mask
                pts[i].x += loc_perp.x * swirl
                pts[i].y += loc_perp.y * swirl
                min_dr = min((math.hypot(pts[i].x - cp.x, pts[i].y - cp.y) for cp, _ in cross_points), default=9999.0)

            surf_z, _ = sample_surface_height(pts[i].x, pts[i].y, trail_samples)
            if i == 0:
                pts[i].z = p_start.z
            elif i == segs:
                pts[i].z = p_end.z
            elif min_dr < 0.65:
                pts[i].z = nr_z + 0.015
            else:
                pts[i].z = surf_z + 0.03

            d_roads.append(min_dr)
            near_road_z.append(nr_z)

        # 5 pass Gaussian smoothing agar talang longsoran menyatu halus dengan lereng & jalan
        for _ in range(5):
            smoothed = [pts[0].copy()]
            for i in range(1, segs):
                nz = 0.25 * pts[i - 1].z + 0.50 * pts[i].z + 0.25 * pts[i + 1].z
                if d_roads[i] < 0.65:
                    nz = near_road_z[i] + 0.015
                else:
                    sz, _ = sample_surface_height(pts[i].x, pts[i].y, trail_samples)
                    nz = max(nz, sz + 0.025)
                smoothed.append(Vector((pts[i].x, pts[i].y, nz)))
            smoothed.append(pts[-1].copy())
            pts = smoothed

        # 1. Alur Talang Tanah & Kerikil Longsoran 3D (5-titik menancap ke lereng)
        rings = []
        for i in range(segs + 1):
            t = i / float(segs)
            p_prev = pts[max(0, i - 1)]
            p_next = pts[min(segs, i + 1)]
            tan_xy = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0))
            if tan_xy.length < 1e-5:
                tan_xy = stream_axis
            tan_xy.normalize()
            lat = Vector((-tan_xy.y, tan_xy.x, 0.0)).normalized()

            road_mask = smoothstep(0.42, 0.88, d_roads[i])
            half_w = 0.24 + 0.06 * math.sin(t * math.pi)
            bank_h = 0.005 + 0.055 * road_mask
            pt = pts[i]

            v_toe_l = bm_chute.verts.new(pt - lat * (half_w + 0.10) + Vector((0.0, 0.0, -0.20)))
            v_berm_l = bm_chute.verts.new(pt - lat * half_w + Vector((0.0, 0.0, bank_h)))
            v_bed = bm_chute.verts.new(pt + Vector((0.0, 0.0, 0.01)))
            v_berm_r = bm_chute.verts.new(pt + lat * half_w + Vector((0.0, 0.0, bank_h)))
            v_toe_r = bm_chute.verts.new(pt + lat * (half_w + 0.10) + Vector((0.0, 0.0, -0.20)))

            col_ctr = lerp_color(c_soil_deep, c_soil_scar, (i % 3) * 0.35)
            col_berm_v = lerp_color(c_gravel, c_berm, 0.45 + 0.25 * math.sin(i * 0.9))
            chute_vcols.extend([c_berm, col_berm_v, col_ctr, col_berm_v, c_berm])
            rings.append((v_toe_l, v_berm_l, v_bed, v_berm_r, v_toe_r, lat, half_w, road_mask))

        for i in range(segs):
            r0 = rings[i]
            r1 = rings[i + 1]
            for c_idx in range(4):
                bm_chute.faces.new((r0[c_idx], r0[c_idx + 1], r1[c_idx + 1], r1[c_idx]))

        # Patahan tebing atas (crown scarp) & gundukan runtuhan bawah (debris toe mound)
        add_landslide_mound(bm_chute, chute_vcols, p_start + Vector((0.0, 0.08, 0.0)), 0.34, 0.10, c_soil_scar, c_berm, segs=10)
        add_landslide_mound(bm_chute, chute_vcols, p_end, 0.42, 0.08, c_gravel, c_berm, segs=10)

        # 2. Bongkahan Batu Tebing Runtuh Low-Poly (bebas badan jalan setapak d >= 0.80m)
        for i in range(1, segs, 2):
            pt = pts[i]
            _, _, _, _, _, lat, half_w, _ = rings[i]
            for side_sign in (-1.0, 1.0):
                rx = pt.x + lat.x * side_sign * (half_w + rng.uniform(0.08, 0.18))
                ry = pt.y + lat.y * side_sign * (half_w + rng.uniform(0.08, 0.18))
                d_any_trail = min(math.hypot(rx - sp.x, ry - sp.y) for sp in trail_samples)
                if d_any_trail < 0.80:
                    continue
                rz, _ = sample_surface_height(rx, ry, trail_samples)
                add_icosphere_to_bm(
                    bm_rocks,
                    rock_vcols,
                    Vector((rx, ry, rz + 0.03)),
                    rng.uniform(0.11, 0.19),
                    (rng.uniform(0.95, 1.35), rng.uniform(0.80, 1.15), rng.uniform(0.60, 0.90)),
                    Euler((rng.uniform(0, 2), rng.uniform(0, 2), rng.uniform(0, 3))),
                    c_rock_palette[(i + int(side_sign > 0)) % len(c_rock_palette)],
                    subdiv=1,
                )

        # Gugusan batu runtuhan di patahan atas & tumpukan bawah (di luar lingkaran piringan angka petak)
        for anchor_c, tile_center, rad in ((p_start, p_from, 0.40), (p_end, p_to, 0.46)):
            for b_i in range(5):
                ang = (b_i / 5.0) * math.pi * 2.0 + idx * 0.5
                rx = anchor_c.x + math.cos(ang) * rad
                ry = anchor_c.y + math.sin(ang) * rad
                if math.hypot(rx - tile_center.x, ry - tile_center.y) < 0.54:
                    continue
                rz, _ = sample_surface_height(rx, ry, trail_samples)
                add_icosphere_to_bm(
                    bm_rocks,
                    rock_vcols,
                    Vector((rx, ry, rz + 0.03)),
                    rng.uniform(0.09, 0.15),
                    (1.2, 0.95, 0.72),
                    Euler((rng.uniform(0, 1.5), rng.uniform(0, 1.5), ang)),
                    c_rock_palette[b_i % len(c_rock_palette)],
                    subdiv=1,
                )

        # 3. Penyeberangan papan & batu pijakan rata tanah di setiap persimpangan jalan setapak
        for cross_p, road_tang in cross_points:
            add_landslide_trail_crossing(
                bm_cross,
                cross_vcols,
                cross_p,
                road_tang,
                c_plank_a,
                c_plank_b,
                c_flat_stone,
            )
            crossing_count += 1

        # 4. Ekspor kurva luncuran 1:1 dalam koordinat Three.js Y-up (bx, bz, -by)
        curve_three = []
        stand_start = Vector((p_from.x, p_from.y, p_from.z + 0.08))
        stand_end = Vector((p_to.x, p_to.y, p_to.z + 0.08))
        curve_three.append([round(stand_start.x, 4), round(stand_start.z, 4), round(-stand_start.y, 4)])
        for i in range(0, segs + 1, 2):
            sp = pts[i]
            curve_three.append([round(sp.x, 4), round(sp.z + 0.04, 4), round(-sp.y, 4)])
        curve_three.append([round(stand_end.x, 4), round(stand_end.z, 4), round(-stand_end.y, 4)])

        landslide_curves_three[str(from_tile)] = {
            "toTile": to_tile,
            "points": curve_three,
        }

    create_mesh_with_vcol("MountainLandslideChutes", bm_chute, chute_vcols, mats["soil"], col, flat=True)
    create_mesh_with_vcol("MountainLandslideRocks", bm_rocks, rock_vcols, mats["rock"], col, flat=True)
    create_mesh_with_vcol("MountainLandslideCrossings", bm_cross, cross_vcols, mats["crossing"], col, flat=True)
    print(f"[MountainLandslides crossings] built={crossing_count}")
    return landslide_curves_three


def setup_landslide_studio(studio_col):
    world = bpy.data.worlds.new("LandslideStudioWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_rgba("#87ceeb")
        bg.inputs["Strength"].default_value = 0.85

    sun = bpy.data.lights.new("SunKey", type="SUN")
    sun.energy = 3.2
    sun_obj = bpy.data.objects.new("SunKey", sun)
    sun_obj.rotation_euler = (math.radians(46), math.radians(18), math.radians(-38))
    studio_col.objects.link(sun_obj)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    ls_col = bpy.data.collections.new("MountainLandslidesSet")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(ls_col)
    bpy.context.scene.collection.children.link(studio_col)

    mats = {
        "soil": build_material("LandslideSoilMat", roughness=0.92),
        "rock": build_material("LandslideRockMat", roughness=0.86),
        "crossing": build_material("LandslideCrossingMat", roughness=0.82),
    }

    trail_samples = build_smooth_trail_samples()
    ls_meta = generate_landslides_geometry(trail_samples, mats, ls_col)
    setup_landslide_studio(studio_col)

    total_verts = sum(len(o.data.vertices) for o in ls_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in ls_col.objects if o.type == "MESH")
    print(f"[MountainLandslides geometry] objects={len(ls_col.objects)}, verts={total_verts}, polys={total_polys}")
    print("LANDSLIDE_CURVES_JSON=" + json.dumps(ls_meta))

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in ls_col.objects:
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
