"""Generate Low-Poly Mountain Streams, Waterfalls, Wet River Rocks & Connected Footbridges GLB (mountain_streams.glb)."""

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

from generate_mountain_trail import (
    STREAMS,
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

BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "mountain_streams.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "mountain_streams.glb")

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)


def add_icosphere_to_bm(bm, vcols, center, radius, scale_vec, rot_euler, color, subdiv=1):
    """Add flat-shaded low-poly stone/splash sphere to bmesh."""
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


def add_prism_to_bm(bm, vcols, bot_quad, top_quad, color):
    """Add an 8-vertex closed prism with outward normals."""
    tmp = bmesh.new()
    bv = [tmp.verts.new(p) for p in bot_quad]
    tv = [tmp.verts.new(p) for p in top_quad]
    tmp.faces.new((bv[0], bv[3], bv[2], bv[1]))
    tmp.faces.new((tv[0], tv[1], tv[2], tv[3]))
    for k in range(4):
        kn = (k + 1) % 4
        tmp.faces.new((bv[k], bv[kn], tv[kn], tv[k]))
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    vmap = {}
    for v in tmp.verts:
        nv = bm.verts.new(v.co)
        vmap[v] = nv
        vcols.append(color)
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def add_water_pool_disc(bm, vcols, center, radius, depth, color_center, color_edge, segs=12):
    """Add a 3D basin pool of water anchored into the terrain rim."""
    c_top = bm.verts.new((center.x, center.y, center.z + 0.03))
    vcols.append(color_center)
    top_ring = []
    bot_ring = []
    for s in range(segs):
        ang = (s / float(segs)) * math.pi * 2.0
        px = center.x + math.cos(ang) * radius
        py = center.y + math.sin(ang) * radius
        top_ring.append(bm.verts.new((px, py, center.z)))
        vcols.append(color_edge)
        bot_ring.append(bm.verts.new((px, py, center.z - depth)))
        vcols.append(color_edge)
    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((c_top, top_ring[s], top_ring[sn]))
        bm.faces.new((top_ring[s], bot_ring[s], bot_ring[sn], top_ring[sn]))


def resample_catmull_rom(anchors, out_segs):
    """Evaluate Catmull-Rom spline over anchors and resample cleanly to uniform arc length."""
    dense = []
    n = len(anchors)
    for i in range(n - 1):
        p0 = anchors[max(0, i - 1)]
        p1 = anchors[i]
        p2 = anchors[i + 1]
        p3 = anchors[min(n - 1, i + 2)]
        sub = 12
        for s in range(sub):
            t = s / float(sub)
            t2 = t * t
            t3 = t2 * t
            pt = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            dense.append(pt)
    dense.append(anchors[-1].copy())

    cum = [0.0]
    for i in range(len(dense) - 1):
        cum.append(cum[-1] + (dense[i + 1] - dense[i]).length)
    total = max(1e-5, cum[-1])

    out = []
    for i in range(out_segs + 1):
        target = (i / float(out_segs)) * total
        j = 0
        while j < len(cum) - 2 and cum[j + 1] < target:
            j += 1
        seg_l = max(1e-5, cum[j + 1] - cum[j])
        frac = (target - cum[j]) / seg_l
        out.append(dense[j].lerp(dense[j + 1], frac))
    return out


def add_footbridge(bm_wood, wood_vcols, center, road_tang, c_deck_a, c_deck_b, c_beam, c_tie):
    """Build a continuous arched wooden footbridge seamlessly anchored into the trail dirt on both ends."""
    fwd = Vector((road_tang.x, road_tang.y, 0.0))
    if fwd.length < 1e-5:
        fwd = Vector((1.0, 0.0, 0.0))
    fwd.normalize()
    side = Vector((-fwd.y, fwd.x, 0.0)).normalized()

    span = 1.64
    half_w = 0.45

    def deck_z(u):
        return center.z - 0.04 + math.sin(u * math.pi) * 0.18

    def deck_pt(u, s_lat, dz=0.0):
        s_off = (u - 0.5) * span
        return Vector((center.x + fwd.x * s_off + side.x * s_lat, center.y + fwd.y * s_off + side.y * s_lat, deck_z(u) + dz))

    # 1. Balok tumpuan pangkal & ujung jembatan tertanam ke tanah jalan (u = 0.02 & u = 0.98)
    for abut_u in (0.02, 0.98):
        p_l = deck_pt(abut_u, -half_w - 0.04, -0.05)
        p_r = deck_pt(abut_u, half_w + 0.04, -0.05)
        add_cylinder_to_bm(bm_wood, wood_vcols, p_l, p_r, 0.055, 0.055, 6, c_beam)

    # 2. 2 balok gelagar utama kontinu dari u=0.0 ke u=1.0 mengikuti lengkung jembatan
    beam_segs = 12
    for sgn in (-1.0, 1.0):
        lat = sgn * (half_w - 0.07)
        for k in range(beam_segs):
            a = deck_pt(k / float(beam_segs), lat, -0.035)
            b = deck_pt((k + 1) / float(beam_segs), lat, -0.035)
            add_cylinder_to_bm(bm_wood, wood_vcols, a, b, 0.042, 0.042, 6, c_beam)

    # 3. 12 papan lantai & papan tanjakan bersentuhan rapat membentuk dek menyambung utuh
    plank_segs = 12
    plank_thick = 0.042
    for k in range(plank_segs):
        u0 = max(0.0, k / float(plank_segs) - 0.004)
        u1 = min(1.0, (k + 1) / float(plank_segs) + 0.004)
        t_l0 = deck_pt(u0, -half_w, 0.0)
        t_r0 = deck_pt(u0, half_w, 0.0)
        t_r1 = deck_pt(u1, half_w, 0.0)
        t_l1 = deck_pt(u1, -half_w, 0.0)
        b_l0 = deck_pt(u0, -half_w, -plank_thick)
        b_r0 = deck_pt(u0, half_w, -plank_thick)
        b_r1 = deck_pt(u1, half_w, -plank_thick)
        b_l1 = deck_pt(u1, -half_w, -plank_thick)
        add_prism_to_bm(
            bm_wood,
            wood_vcols,
            [b_l0, b_r0, b_r1, b_l1],
            [t_l0, t_r0, t_r1, t_l1],
            c_deck_a if (k % 2 == 0) else c_deck_b,
        )

    # 4. 3 pasang tiang penyangga vertikal & pegangan tangan kontinu di kiri dan kanan
    post_us = (0.08, 0.50, 0.92)
    for sgn in (-1.0, 1.0):
        lat = sgn * (half_w - 0.03)
        for pu in post_us:
            post_bot = Vector((center.x + fwd.x * ((pu - 0.5) * span) + side.x * lat, center.y + fwd.y * ((pu - 0.5) * span) + side.y * lat, center.z - 0.28))
            post_top = deck_pt(pu, lat, 0.28)
            add_cylinder_to_bm(bm_wood, wood_vcols, post_bot, post_top, 0.036, 0.032, 6, c_beam)
            # Lilitan ikatan di pertemuan tiang & palang atas
            add_cylinder_to_bm(bm_wood, wood_vcols, deck_pt(pu, lat, 0.21), deck_pt(pu, lat, 0.27), 0.043, 0.043, 6, c_tie)

        rail_steps = 8
        for rail_h, rail_r in ((0.255, 0.030), (0.13, 0.022)):
            for rk in range(rail_steps):
                ru0 = post_us[0] + (post_us[-1] - post_us[0]) * (rk / float(rail_steps))
                ru1 = post_us[0] + (post_us[-1] - post_us[0]) * ((rk + 1) / float(rail_steps))
                add_cylinder_to_bm(
                    bm_wood,
                    wood_vcols,
                    deck_pt(ru0, lat, rail_h),
                    deck_pt(ru1, lat, rail_h),
                    rail_r,
                    rail_r,
                    6,
                    c_beam,
                )


def generate_streams_geometry(trail_samples, mats, col):
    """Build 4 cascading rocky mountain streams crossing perpendicularly beneath connected footbridges."""
    bm_water = bmesh.new()
    water_vcols = []

    bm_foam = bmesh.new()
    foam_vcols = []

    bm_rocks = bmesh.new()
    rock_vcols = []

    bm_wood = bmesh.new()
    wood_vcols = []

    c_water_deep = hex_to_rgba("#0284c7")
    c_water_mid = hex_to_rgba("#38bdf8")
    c_water_bright = hex_to_rgba("#7dd3fc")
    c_foam_white = hex_to_rgba("#f0f9ff")
    c_foam_ice = hex_to_rgba("#bae6fd")
    c_rock_palette = [
        hex_to_rgba("#57606f"),
        hex_to_rgba("#6c757d"),
        hex_to_rgba("#495057"),
    ]
    c_deck_a = hex_to_rgba("#9c6634")
    c_deck_b = hex_to_rgba("#b57c46")
    c_beam = hex_to_rgba("#6b421c")
    c_tie = hex_to_rgba("#d6b883")

    # Celah antar-petak per baris jalan setapak untuk mengarahkan persimpangan sungai tegak lurus
    row_gaps = {r: [] for r in range(10)}
    for tile in range(1, 101):
        if tile % 10 != 0:
            r = (tile - 1) // 10
            p_a = tile_to_trail_point(tile)
            p_b = tile_to_trail_point(tile + 1)
            mid = (p_a + p_b) * 0.5
            tang = Vector((p_b.x - p_a.x, p_b.y - p_a.y, 0.0)).normalized()
            row_gaps[r].append((mid, tang))

    rng = random.Random(707)
    stream_curves_three = {}
    bridge_count = 0

    for idx, (from_tile, to_tile) in enumerate(STREAMS.items()):
        p_from = tile_to_trail_point(from_tile)
        p_to = tile_to_trail_point(to_tile)

        h_delta = Vector((p_to.x - p_from.x, p_to.y - p_from.y, 0.0))
        h_dir = h_delta.normalized() if h_delta.length > 1e-5 else Vector((0.0, -1.0, 0.0))

        p_start = p_from + Vector((h_dir.x * 0.18, -0.46, 0.02))
        p_end = p_to + Vector((-h_dir.x * 0.18, 0.46, 0.02))
        s_start_z, _ = sample_surface_height(p_start.x, p_start.y, trail_samples)
        s_end_z, _ = sample_surface_height(p_end.x, p_end.y, trail_samples)
        p_start.z = max(p_from.z + 0.02, s_start_z + 0.04)
        p_end.z = max(p_to.z + 0.02, s_end_z + 0.04)

        row_from = (from_tile - 1) // 10
        row_to = (to_tile - 1) // 10
        line_vec = Vector((p_end.x - p_start.x, p_end.y - p_start.y, 0.0))
        line_len = max(1e-5, line_vec.length)

        # Pilih tepat 1 celah jalan per baris menengah dan paksa sungai lewat tegak lurus
        anchors = [p_start]
        cross_points = []
        for r in range(row_from - 1, row_to, -1):
            candidates = row_gaps.get(r, [])
            if not candidates:
                continue
            best_gap = min(
                candidates,
                key=lambda g: abs((g[0].x - p_start.x) * line_vec.y - (g[0].y - p_start.y) * line_vec.x) / line_len
                + 0.12 * math.hypot(g[0].x - p_start.x, g[0].y - p_start.y),
            )
            cross_p, road_tang = best_gap
            n_down = Vector((-road_tang.y, road_tang.x, 0.0)).normalized()
            if n_down.y > 0.0:
                n_down = -n_down

            p_in = cross_p - n_down * 0.46
            p_out = cross_p + n_down * 0.46
            anchors.extend([p_in, cross_p.copy(), p_out])
            cross_points.append((cross_p.copy(), road_tang.copy()))

        anchors.append(p_end)

        segs = 48
        pts = resample_catmull_rom(anchors, segs)

        # Tambah kelokan alami ringan hanya di lereng antara jembatan (nol tepat di kolong jembatan)
        stream_axis = line_vec.normalized()
        d_bridges = []
        near_bridge_z = []
        for i in range(segs + 1):
            t = i / float(segs)
            min_db = 9999.0
            nb_z = pts[i].z
            for cp, _ in cross_points:
                dc = math.hypot(pts[i].x - cp.x, pts[i].y - cp.y)
                if dc < min_db:
                    min_db = dc
                    nb_z = cp.z

            if 0 < i < segs:
                bridge_mask = smoothstep(0.55, 1.35, min_db)
                p_prev = pts[max(0, i - 1)]
                p_next = pts[min(segs, i + 1)]
                loc_axis = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0))
                loc_perp = Vector((-loc_axis.y, loc_axis.x, 0.0)).normalized() if loc_axis.length > 1e-5 else Vector((1.0, 0.0, 0.0))
                swirl = math.sin(t * math.pi * 3.0 + idx * 1.4) * 0.16 * bridge_mask
                pts[i].x += loc_perp.x * swirl
                pts[i].y += loc_perp.y * swirl
                min_db = min((math.hypot(pts[i].x - cp.x, pts[i].y - cp.y) for cp, _ in cross_points), default=9999.0)

            surf_z, _ = sample_surface_height(pts[i].x, pts[i].y, trail_samples)
            if i == 0:
                pts[i].z = p_start.z
            elif i == segs:
                pts[i].z = p_end.z
            elif min_db < 0.65:
                pts[i].z = nb_z - 0.08
            else:
                pts[i].z = surf_z + 0.05

            d_bridges.append(min_db)
            near_bridge_z.append(nb_z)

        # 5 pass Gaussian smoothing dengan air tetap terbenam rapi di bawah kolong jembatan
        for _ in range(5):
            smoothed = [pts[0].copy()]
            for i in range(1, segs):
                nz = 0.25 * pts[i - 1].z + 0.50 * pts[i].z + 0.25 * pts[i + 1].z
                if d_bridges[i] < 0.65:
                    nz = min(nz, near_bridge_z[i] - 0.07)
                else:
                    sz, _ = sample_surface_height(pts[i].x, pts[i].y, trail_samples)
                    nz = max(nz, sz + 0.03)
                smoothed.append(Vector((pts[i].x, pts[i].y, nz)))
            smoothed.append(pts[-1].copy())
            pts = smoothed

        # 1. Aliran Air Bervolume 3D menyempit rapi tepat di bawah kolong jembatan
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

            drop = p_prev.z - p_next.z
            horiz = max(0.05, math.hypot(p_next.x - p_prev.x, p_next.y - p_prev.y))
            steepness = max(0.0, min(1.0, (drop / horiz) * 1.15))

            base_w = 0.24 + 0.06 * math.sin(t * math.pi)
            half_w = 0.19 + (base_w - 0.19) * smoothstep(0.35, 0.90, d_bridges[i])
            pt = pts[i]
            v_bank_l = bm_water.verts.new(pt - lat * (half_w + 0.05) + Vector((0.0, 0.0, -0.22)))
            v_sh_l = bm_water.verts.new(pt - lat * half_w + Vector((0.0, 0.0, 0.02)))
            v_ctr = bm_water.verts.new(pt + Vector((0.0, 0.0, 0.055)))
            v_sh_r = bm_water.verts.new(pt + lat * half_w + Vector((0.0, 0.0, 0.02)))
            v_bank_r = bm_water.verts.new(pt + lat * (half_w + 0.05) + Vector((0.0, 0.0, -0.22)))

            col_edge = c_water_deep
            col_sh = lerp_color(c_water_mid, c_water_bright, steepness * 0.55)
            col_mid = lerp_color(c_water_mid, c_water_bright, 0.25 + steepness * 0.70)
            water_vcols.extend([col_edge, col_sh, col_mid, col_sh, col_edge])
            rings.append((v_bank_l, v_sh_l, v_ctr, v_sh_r, v_bank_r, lat, half_w, steepness))

        for i in range(segs):
            r0 = rings[i]
            r1 = rings[i + 1]
            for c_idx in range(4):
                bm_water.faces.new((r0[c_idx], r0[c_idx + 1], r1[c_idx + 1], r1[c_idx]))

        add_water_pool_disc(bm_water, water_vcols, p_start, 0.36, 0.22, c_water_bright, c_water_deep, segs=12)
        add_water_pool_disc(bm_water, water_vcols, p_end, 0.42, 0.24, c_water_mid, c_water_deep, segs=12)

        # 2. Pita & Cipratan Buih Air Terjun
        foam_prev = None
        for i in range(segs + 1):
            pt = pts[i]
            _, _, _, _, _, lat, half_w, steepness = rings[i]
            if steepness > 0.36 and 1 <= i <= segs - 1 and d_bridges[i] > 0.45:
                fw = half_w * (0.55 + 0.28 * steepness)
                foam_jitter = math.sin(i * 1.9 + idx) * 0.035
                f_l = bm_foam.verts.new(pt - lat * (fw - foam_jitter) + Vector((0.0, 0.0, 0.065)))
                f_r = bm_foam.verts.new(pt + lat * (fw + foam_jitter) + Vector((0.0, 0.0, 0.065)))
                col_f = c_foam_white if (i % 2 == 0) else c_foam_ice
                foam_vcols.extend([col_f, col_f])
                if foam_prev is not None:
                    bm_foam.faces.new((foam_prev[0], foam_prev[1], f_r, f_l))
                foam_prev = (f_l, f_r)
            else:
                foam_prev = None

        for pool_c, pool_r in ((p_start, 0.28), (p_end, 0.34)):
            for b_i in range(6):
                ang = (b_i / 6.0) * math.pi * 2.0 + idx * 0.7
                fx = pool_c.x + math.cos(ang) * pool_r * rng.uniform(0.75, 1.0)
                fy = pool_c.y + math.sin(ang) * pool_r * rng.uniform(0.75, 1.0)
                add_icosphere_to_bm(
                    bm_foam,
                    foam_vcols,
                    Vector((fx, fy, pool_c.z + 0.04)),
                    rng.uniform(0.06, 0.095),
                    (1.2, 1.1, 0.45),
                    Euler((0.0, 0.0, ang)),
                    c_foam_white if (b_i % 2 == 0) else c_foam_ice,
                    subdiv=1,
                )

        # 3. Batu Kali Basah mengapit tepian sungai di luar badan jalan
        for i in range(1, segs, 2):
            pt = pts[i]
            _, _, _, _, _, lat, half_w, _ = rings[i]
            for side_sign in (-1.0, 1.0):
                rx = pt.x + lat.x * side_sign * (half_w + rng.uniform(0.11, 0.19))
                ry = pt.y + lat.y * side_sign * (half_w + rng.uniform(0.11, 0.19))
                d_any_trail = min(math.hypot(rx - sp.x, ry - sp.y) for sp in trail_samples)
                if d_any_trail < 0.84:
                    continue
                rz, _ = sample_surface_height(rx, ry, trail_samples)
                add_icosphere_to_bm(
                    bm_rocks,
                    rock_vcols,
                    Vector((rx, ry, rz + 0.02)),
                    rng.uniform(0.12, 0.18),
                    (rng.uniform(0.95, 1.25), rng.uniform(0.85, 1.15), rng.uniform(0.55, 0.76)),
                    Euler((rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 3))),
                    c_rock_palette[(i + int(side_sign > 0)) % len(c_rock_palette)],
                    subdiv=1,
                )

        for pool_c, tile_center, radius in ((p_start, p_from, 0.42), (p_end, p_to, 0.48)):
            for r_i in range(5):
                ang = (r_i / 5.0) * math.pi * 2.0 + 0.4
                rx = pool_c.x + math.cos(ang) * radius
                ry = pool_c.y + math.sin(ang) * radius
                if math.hypot(rx - tile_center.x, ry - tile_center.y) < 0.54:
                    continue
                rz, _ = sample_surface_height(rx, ry, trail_samples)
                add_icosphere_to_bm(
                    bm_rocks,
                    rock_vcols,
                    Vector((rx, ry, rz + 0.02)),
                    rng.uniform(0.10, 0.15),
                    (1.1, 0.95, 0.65),
                    Euler((rng.uniform(0, 1), rng.uniform(0, 1), ang)),
                    c_rock_palette[r_i % len(c_rock_palette)],
                    subdiv=1,
                )

        # 4. Bangun 1 Jembatan Papan Kayu Menyambung Utuh di tiap celah persimpangan
        for cross_p, road_tang in cross_points:
            bridge_center = Vector((cross_p.x, cross_p.y, cross_p.z + 0.01))
            add_footbridge(bm_wood, wood_vcols, bridge_center, road_tang, c_deck_a, c_deck_b, c_beam, c_tie)
            bridge_count += 1

        # 5. Ekspor kurva hanyut 1:1 dalam koordinat Three.js Y-up (bx, bz, -by)
        curve_three = []
        stand_start = Vector((p_from.x, p_from.y, p_from.z + 0.08))
        stand_end = Vector((p_to.x, p_to.y, p_to.z + 0.08))
        curve_three.append([round(stand_start.x, 4), round(stand_start.z, 4), round(-stand_start.y, 4)])
        for i in range(0, segs + 1, 2):
            sp = pts[i]
            curve_three.append([round(sp.x, 4), round(sp.z + 0.05, 4), round(-sp.y, 4)])
        curve_three.append([round(stand_end.x, 4), round(stand_end.z, 4), round(-stand_end.y, 4)])

        stream_curves_three[str(from_tile)] = {
            "toTile": to_tile,
            "points": curve_three,
        }

    create_mesh_with_vcol("MountainStreamWater", bm_water, water_vcols, mats["water"], col, flat=True)
    create_mesh_with_vcol("MountainStreamFoam", bm_foam, foam_vcols, mats["foam"], col, flat=True)
    create_mesh_with_vcol("MountainStreamRocks", bm_rocks, rock_vcols, mats["rock"], col, flat=True)
    create_mesh_with_vcol("MountainStreamBridges", bm_wood, wood_vcols, mats["wood"], col, flat=True)
    print(f"[MountainStreams bridges] built={bridge_count}")
    return stream_curves_three


def setup_stream_studio(studio_col):
    world = bpy.data.worlds.new("StreamStudioWorld")
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

    stream_col = bpy.data.collections.new("MountainStreamsSet")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(stream_col)
    bpy.context.scene.collection.children.link(studio_col)

    mats = {
        "water": build_material("StreamWaterMat", roughness=0.14, emission_strength=0.12),
        "foam": build_material("StreamFoamMat", roughness=0.35, emission_strength=0.18),
        "rock": build_material("StreamRockMat", roughness=0.80),
        "wood": build_material("StreamBridgeWoodMat", roughness=0.78),
    }

    trail_samples = build_smooth_trail_samples()
    stream_meta = generate_streams_geometry(trail_samples, mats, stream_col)
    setup_stream_studio(studio_col)

    total_verts = sum(len(o.data.vertices) for o in stream_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in stream_col.objects if o.type == "MESH")
    print(f"[MountainStreams geometry] objects={len(stream_col.objects)}, verts={total_verts}, polys={total_polys}")
    print("STREAM_CURVES_JSON=" + json.dumps(stream_meta))

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in stream_col.objects:
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
