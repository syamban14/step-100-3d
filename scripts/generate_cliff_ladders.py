"""Generate rustic Low-Poly Wood & Rope Cliff Ladders GLB asset (cliff_ladders.glb + .blend)."""

import json
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPTS_DIR)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from generate_mountain_trail import (
    LADDERS,
    add_box_to_bm,
    add_cylinder_to_bm,
    build_material,
    build_smooth_trail_samples,
    create_mesh_with_vcol,
    hex_to_rgba,
    lerp_color,
    sample_surface_height,
    smoothstep,
    tile_to_trail_point,
)

BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "cliff_ladders.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "cliff_ladders.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)


def add_icosphere_to_bm(bm, vcols, center, radius, scale_vec, rot_euler, color, subdiv=1):
    """Add flat-shaded low-poly boulder/stone to bmesh with vertex colors."""
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=radius)
    rot_m = rot_euler.to_matrix().to_4x4()
    scale_m = Matrix.Diagonal((scale_vec[0], scale_vec[1], scale_vec[2], 1.0))
    mat = Matrix.Translation(center) @ rot_m @ scale_m
    vmap = {}
    for v in tmp.verts:
        nv = bm.verts.new(mat @ v.co)
        vmap[v] = nv
        vcols.append(color)
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def build_ladder_rope_lashing(bm, vcols, center, axis_dir, side_dir, face_n, color):
    """Build snug cylindrical hemp rope collars wrapping rail and rung joints."""
    # Lilitan tali silinder tipis memeluk rapat batang utama dan leher anak tangga
    add_cylinder_to_bm(
        bm,
        vcols,
        center - axis_dir * 0.042,
        center + axis_dir * 0.042,
        0.057,
        0.057,
        8,
        color,
    )
    rung_c = center + face_n * 0.015
    add_cylinder_to_bm(
        bm,
        vcols,
        rung_c - side_dir * 0.045,
        rung_c + side_dir * 0.045,
        0.044,
        0.044,
        8,
        color,
    )


def generate_ladders_geometry(trail_samples, mats, col):
    """Build 8 detailed rustic wood & rope cliff ladders and return Three.js climb curve metadata."""
    bm_wood = bmesh.new()
    wood_vcols = []

    bm_rope = bmesh.new()
    rope_vcols = []

    bm_stone = bmesh.new()
    stone_vcols = []

    c_rail_a = hex_to_rgba("#7c4a21")
    c_rail_b = hex_to_rgba("#8f5729")
    c_stake = hex_to_rgba("#5c3617")
    c_rung_a = hex_to_rgba("#d69e5c")
    c_rung_b = hex_to_rgba("#c48b48")
    c_rope = hex_to_rgba("#e6ca96")
    c_rope_dark = hex_to_rgba("#cdb07a")
    c_rock_a = hex_to_rgba("#7b828a")
    c_rock_b = hex_to_rgba("#646b73")

    rng = random.Random(505)
    ladder_curves_three = {}

    for from_tile, to_tile in LADDERS.items():
        p_from = tile_to_trail_point(from_tile)
        p_to = tile_to_trail_point(to_tile)

        h_delta = Vector((p_to.x - p_from.x, p_to.y - p_from.y, 0.0))
        h_dir = h_delta.normalized() if h_delta.length > 1e-5 else Vector((0.0, 1.0, 0.0))

        # Pangkal bawah di bibir tebing atas (+Y) petak asal & ujung atas di bibir tebing bawah (-Y) petak tujuan
        # sehingga jalur jalan kaki (+/-X) dan piringan angka (r=0.28) tetap terbuka 100%.
        rim_from = Vector((h_dir.x * 0.25, max(0.42, abs(h_dir.y) * 0.48), 0.0)).normalized() * 0.48
        rim_to = Vector((-h_dir.x * 0.25, -max(0.42, abs(h_dir.y) * 0.48), 0.0)).normalized() * 0.48
        p0 = Vector((p_from.x + rim_from.x, p_from.y + rim_from.y, p_from.z + 0.08))
        p1 = Vector((p_to.x + rim_to.x, p_to.y + rim_to.y, p_to.z + 0.08))

        ladder_h = Vector((p1.x - p0.x, p1.y - p0.y, 0.0)).normalized()
        # Vektor horizontal kanan murni (side.z == 0 agar seluruh anak tangga rata tanpa melintir)
        right = ladder_h.cross(Vector((0.0, 0.0, 1.0))).normalized()
        chord = (p1 - p0).normalized()
        # Normal permukaan tangga mengarah keluar/atas lereng (ke sisi pendaki)
        face_n = right.cross(chord).normalized()
        if face_n.z < 0.0:
            face_n = -face_n

        span_xy = math.hypot(p1.x - p0.x, p1.y - p0.y)
        mid_trail_pts = [
            sp
            for sp in trail_samples
            if 0.16 * span_xy < ((sp.x - p0.x) * ladder_h.x + (sp.y - p0.y) * ladder_h.y) < 0.84 * span_xy
            and math.hypot(sp.x - p_from.x, sp.y - p_from.y) > 1.35
            and math.hypot(sp.x - p_to.x, sp.y - p_to.y) > 1.35
        ]

        # Sampling 20 segmen dan bentuk selubung cembung atas yang halus (>= 2.08m di atas jalan setapak menengah)
        segs = 20
        pts = []
        req_zs = []
        for i in range(segs + 1):
            t = i / float(segs)
            pt = p0.lerp(p1, t)
            surf_z, _ = sample_surface_height(pt.x, pt.y, trail_samples)

            d_road = 9999.0
            road_z = 0.0
            for sp in mid_trail_pts:
                d_sp = math.hypot(pt.x - sp.x, pt.y - sp.y)
                if d_sp < d_road:
                    d_road = d_sp
                    road_z = sp.z

            road_lift = (1.0 - smoothstep(0.55, 1.25, d_road)) * 2.08 if d_road < 1.25 else 0.0
            floor_z = (
                pt.z
                if (i == 0 or i == segs)
                else max(pt.z + 0.25 * math.sin(t * math.pi), surf_z + 0.18, road_z + road_lift)
            )
            pts.append(Vector((pt.x, pt.y, floor_z)))
            req_zs.append(floor_z)

        hull = []
        for i, z in enumerate(req_zs):
            while len(hull) >= 2:
                x1, y1 = hull[-2]
                x2, y2 = hull[-1]
                if (x2 - x1) * (z - y1) - (y2 - y1) * (i - x1) >= 0.0:
                    hull.pop()
                else:
                    break
            hull.append((i, z))

        zs = [0.0] * (segs + 1)
        for k in range(len(hull) - 1):
            i0, z0 = hull[k]
            i1, z1 = hull[k + 1]
            for i in range(i0, i1 + 1):
                w = (i - i0) / float(max(1, i1 - i0))
                zs[i] = z0 * (1.0 - w) + z1 * w

        for _ in range(4):
            zs = (
                [zs[0]]
                + [max(0.25 * zs[i - 1] + 0.50 * zs[i] + 0.25 * zs[i + 1], req_zs[i]) for i in range(1, segs)]
                + [zs[-1]]
            )

        for i in range(segs + 1):
            pts[i].z = zs[i]

        rail_half = 0.30

        # 1. Batang Kayu Utama Kiri & Kanan dengan sedikit variasi ketebalan organik
        rail_pts = { -1.0: [], 1.0: [] }
        for side_sign in (-1.0, 1.0):
            for i, pt in enumerate(pts):
                jitter = 0.0 if (i == 0 or i == segs) else rng.uniform(-0.008, 0.008)
                rp = pt + right * (side_sign * (rail_half + jitter))
                rail_pts[side_sign].append(rp)

            for i in range(segs):
                a = rail_pts[side_sign][i]
                b = rail_pts[side_sign][i + 1]
                r_a = 0.052 - 0.006 * (i / float(segs))
                r_b = 0.052 - 0.006 * ((i + 1) / float(segs))
                add_cylinder_to_bm(
                    bm_wood,
                    wood_vcols,
                    a,
                    b,
                    r_a,
                    r_b,
                    8,
                    c_rail_a if (i % 2 == 0) else c_rail_b,
                )

            # Pegangan tangan vertikal atas melengkung masuk ke bibir petak tujuan
            top_pt = rail_pts[side_sign][-1]
            post_mid = top_pt + Vector((0.0, 0.0, 0.24)) + ladder_h * 0.05
            post_tip = post_mid + ladder_h * 0.14 + Vector((0.0, 0.0, 0.05))
            add_cylinder_to_bm(bm_wood, wood_vcols, top_pt, post_mid, 0.048, 0.044, 8, c_rail_a)
            add_cylinder_to_bm(bm_wood, wood_vcols, post_mid, post_tip, 0.044, 0.036, 8, c_rail_b)
            add_cylinder_to_bm(
                bm_rope,
                rope_vcols,
                top_pt + Vector((0.0, 0.0, 0.04)),
                top_pt + Vector((0.0, 0.0, 0.11)),
                0.056,
                0.056,
                8,
                c_rope,
            )

        # 2. Patok Pancang & Batu Pengganjal di Pangkal Bawah & Ujung Atas
        for end_pt, is_top in ((pts[0], False), (pts[-1], True)):
            end_surf, _ = sample_surface_height(end_pt.x, end_pt.y, trail_samples)
            for side_sign in (-1.0, 1.0):
                stake_top = (
                    end_pt
                    + right * (side_sign * (rail_half + 0.07))
                    + ladder_h * (0.04 if is_top else 0.02)
                    + Vector((0.0, 0.0, 0.20 if not is_top else 0.16))
                )
                stake_bot = Vector((stake_top.x, stake_top.y, min(end_pt.z, end_surf) - 0.16))
                add_cylinder_to_bm(bm_wood, wood_vcols, stake_bot, stake_top, 0.045, 0.035, 6, c_stake)

                # Ikatan tali pancang ke rail tangga
                tie_a = end_pt + right * (side_sign * (rail_half - 0.01)) + Vector((0.0, 0.0, 0.05))
                tie_b = end_pt + right * (side_sign * (rail_half + 0.09)) + Vector((0.0, 0.0, 0.07))
                add_cylinder_to_bm(bm_rope, rope_vcols, tie_a, tie_b, 0.052, 0.052, 8, c_rope_dark)

                # Batu low-poly pengganjal di dasar tiang bawah
                if not is_top:
                    rock_pos = end_pt + right * (side_sign * (rail_half + 0.06)) + ladder_h * 0.04 + Vector((0.0, 0.0, 0.03))
                    add_icosphere_to_bm(
                        bm_stone,
                        stone_vcols,
                        rock_pos,
                        0.11,
                        (1.15, 0.92, 0.72),
                        Euler((rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 3))),
                        c_rock_a if side_sign < 0 else c_rock_b,
                    )

        # 3. Tiang Penyangga Lereng (Cliff Support Struts) hanya di luar badan jalan setapak (d_road >= 0.88m)
        for strut_t in (0.28, 0.50, 0.72):
            idx = int(round(strut_t * segs))
            anchor_c = pts[idx]
            for side_sign in (-1.0, 1.0):
                top_s = anchor_c + right * (side_sign * rail_half)
                foot_xy = top_s + ladder_h * 0.18 + right * (side_sign * 0.06)

                nearest_sp = None
                d_road_foot = 9999.0
                for sp in trail_samples:
                    d_sp = math.hypot(foot_xy.x - sp.x, foot_xy.y - sp.y)
                    if d_sp < d_road_foot:
                        d_road_foot = d_sp
                        nearest_sp = sp

                if d_road_foot < 0.88 and nearest_sp is not None:
                    push = Vector((foot_xy.x - nearest_sp.x, foot_xy.y - nearest_sp.y, 0.0))
                    if push.length > 1e-4:
                        push.normalize()
                        foot_xy = Vector((nearest_sp.x + push.x * 0.94, nearest_sp.y + push.y * 0.94, foot_xy.z))
                    d_recheck = min(math.hypot(foot_xy.x - sp.x, foot_xy.y - sp.y) for sp in trail_samples)
                    if d_recheck < 0.88:
                        continue

                foot_z, _ = sample_surface_height(foot_xy.x, foot_xy.y, trail_samples)
                foot_s = Vector((foot_xy.x, foot_xy.y, foot_z - 0.16))
                if top_s.z - foot_z > 0.22:
                    add_cylinder_to_bm(bm_wood, wood_vcols, foot_s, top_s, 0.042, 0.036, 6, c_stake)
                    strut_dir = (top_s - foot_s).normalized()
                    add_cylinder_to_bm(
                        bm_rope,
                        rope_vcols,
                        top_s - strut_dir * 0.075,
                        top_s - strut_dir * 0.005,
                        0.050,
                        0.052,
                        8,
                        c_rope,
                    )

        # 4. Anak Tangga Bulat & Lilitan Tali Tambang setiap jarak ~0.42m di sepanjang busur
        cum_len = [0.0]
        for i in range(segs):
            cum_len.append(cum_len[-1] + (pts[i + 1] - pts[i]).length)
        total_len = cum_len[-1]
        rung_count = max(5, int(round(total_len / 0.42)))

        for r_idx in range(rung_count):
            u = (r_idx + 0.5) / float(rung_count)
            target_d = u * total_len
            seg_i = 0
            while seg_i < segs - 1 and cum_len[seg_i + 1] < target_d:
                seg_i += 1
            seg_span = max(1e-5, cum_len[seg_i + 1] - cum_len[seg_i])
            local_t = (target_d - cum_len[seg_i]) / seg_span
            rung_mid = pts[seg_i].lerp(pts[seg_i + 1], local_t)
            seg_tan = (pts[seg_i + 1] - pts[seg_i]).normalized()
            local_n = right.cross(seg_tan).normalized()
            if local_n.z < 0.0:
                local_n = -local_n

            rung_l = rung_mid - right * (rail_half + 0.055) + local_n * 0.025
            rung_r = rung_mid + right * (rail_half + 0.055) + local_n * 0.025
            add_cylinder_to_bm(
                bm_wood,
                wood_vcols,
                rung_l,
                rung_r,
                0.038,
                0.038,
                8,
                c_rung_a if (r_idx % 2 == 0) else c_rung_b,
            )

            # Lilitan tali tambang silang pada sambungan kiri & kanan
            for side_sign in (-1.0, 1.0):
                joint = rung_mid + right * (side_sign * rail_half) + local_n * 0.01
                build_ladder_rope_lashing(bm_rope, rope_vcols, joint, seg_tan, right, local_n, c_rope)

        # 5. Ekspor titik-titik kurva panjat Three.js (Y-up: bx, bz, -by) menempel tepat di sisi depan anak tangga
        curve_three = []
        # Titik awal berdiri di batu asal -> pangkal tangga -> sepanjang anak tangga -> keluar di batu tujuan
        start_stand = Vector((p_from.x, p_from.y, p_from.z + 0.08))
        end_stand = Vector((p_to.x, p_to.y, p_to.z + 0.08))
        curve_three.append([round(start_stand.x, 4), round(start_stand.z, 4), round(-start_stand.y, 4)])

        for i in range(0, segs + 1, 2):
            p_prev = pts[max(0, i - 1)]
            p_next = pts[min(segs, i + 1)]
            loc_tan = (p_next - p_prev).normalized()
            loc_n = right.cross(loc_tan).normalized()
            if loc_n.z < 0.0:
                loc_n = -loc_n
            climb_pt = pts[i] + loc_n * 0.18 - Vector((0.0, 0.0, 0.04))
            curve_three.append([round(climb_pt.x, 4), round(climb_pt.z, 4), round(-climb_pt.y, 4)])

        curve_three.append([round(end_stand.x, 4), round(end_stand.z, 4), round(-end_stand.y, 4)])
        # Arah hadap lurus ke anak tangga dalam koordinat Three.js: atan2(dx, dz) = atan2(ladder_h.x, -ladder_h.y)
        climb_yaw = round(math.atan2(ladder_h.x, -ladder_h.y), 5)
        ladder_curves_three[str(from_tile)] = {
            "toTile": to_tile,
            "yaw": climb_yaw,
            "points": curve_three,
        }

    create_mesh_with_vcol("CliffLadderTimber", bm_wood, wood_vcols, mats["wood"], col, flat=True)
    create_mesh_with_vcol("CliffLadderRope", bm_rope, rope_vcols, mats["rope"], col, flat=True)
    create_mesh_with_vcol("CliffLadderRocks", bm_stone, stone_vcols, mats["stone"], col, flat=True)
    return ladder_curves_three


def setup_ladder_studio(studio_col):
    world = bpy.data.worlds.new("LadderStudioWorld")
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

    ladder_col = bpy.data.collections.new("CliffLaddersSet")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(ladder_col)
    bpy.context.scene.collection.children.link(studio_col)

    mats = {
        "wood": build_material("LadderWoodMat", roughness=0.78),
        "rope": build_material("LadderRopeMat", roughness=0.92),
        "stone": build_material("LadderStoneMat", roughness=0.86),
    }

    trail_samples = build_smooth_trail_samples()
    climb_meta = generate_ladders_geometry(trail_samples, mats, ladder_col)
    setup_ladder_studio(studio_col)

    total_verts = sum(len(o.data.vertices) for o in ladder_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in ladder_col.objects if o.type == "MESH")
    print(f"[CliffLadders geometry] objects={len(ladder_col.objects)}, verts={total_verts}, polys={total_polys}")
    print("CLIMB_CURVES_JSON=" + json.dumps(climb_meta))

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in ladder_col.objects:
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
