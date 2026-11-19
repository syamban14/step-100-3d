"""Generate Low-Poly Mountain & Winding Switchback Trail 3D asset (mountain_trail.glb + preview PNG)."""

import math
import os
import random
import bpy
import bmesh
from mathutils import Color, Euler, Matrix, Vector

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND_PATH = os.path.join(BASE_DIR, "public", "assets", "blend", "mountain_trail.blend")
GLB_PATH = os.path.join(BASE_DIR, "public", "assets", "models", "mountain_trail.glb")
PREVIEW_PATH = "/Users/syamban/.gemini/antigravity-cli/brain/af6c04c1-699f-4b22-8483-72ea48865eab/mountain_trail_preview.png"

os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)

LADDERS = {
    4: 25,
    13: 46,
    33: 49,
    42: 63,
    50: 69,
    62: 81,
    74: 92,
    84: 97,
}

STREAMS = {
    27: 5,
    40: 3,
    66: 45,
    89: 53,
}

LANDSLIDES = {
    43: 18,
    54: 31,
    76: 58,
    99: 41,
}

MYSTERY_TILES = {8, 19, 29, 36, 48, 57, 68, 79, 86, 94}


def hex_to_rgba(hex_str, alpha=1.0):
    """Convert #rrggbb sRGB hex string to scene-linear RGBA tuple."""
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


def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def tile_to_trail_point(tile):
    """Deterministic switchback mountain trail point (Blender Z-up: -Y front basecamp, +Y summit)."""
    if tile <= 0:
        return Vector((-11.8, -12.8, 0.45))

    t = max(1, min(100, tile))
    row = (t - 1) // 10
    col_in_row = (t - 1) % 10
    col = col_in_row if row % 2 == 0 else (9 - col_in_row)

    nx = (col - 4.5) / 4.5  # -1.0 .. 1.0
    half_w = 10.2 - row * 0.62
    x = nx * half_w

    # Kelokan alami (organic meander) + lengkungan punggung lereng
    meander_y = 0.45 * math.sin(nx * math.pi * 1.5 + row * 1.1)
    y_base = -10.8 + row * 1.92
    bulge = (1.0 - nx * nx) * (1.85 - row * 0.13)
    y = y_base - bulge + meander_y

    # Ketinggian naik terus sepanjang pendakian lereng
    row_progress = col_in_row / 9.0
    z = 0.65 + (row + row_progress * 0.85) * 0.92
    return Vector((x, y, z))


def build_smooth_trail_samples():
    """Build dense smoothed trail centerline samples from basecamp (0) to summit (100)."""
    anchors = [tile_to_trail_point(0)]
    for tile in range(1, 101):
        p = tile_to_trail_point(tile)
        if tile > 1 and (tile - 1) % 10 == 0:
            prev_p = tile_to_trail_point(tile - 1)
            out_dir = 1.0 if p.x >= 0 else -1.0
            mid = (prev_p + p) * 0.5
            mid.x += out_dir * 1.15
            mid.y += 0.15
            anchors.append(mid)
        anchors.append(p)

    samples = []
    n = len(anchors)
    for i in range(n - 1):
        p0 = anchors[max(0, i - 1)]
        p1 = anchors[i]
        p2 = anchors[i + 1]
        p3 = anchors[min(n - 1, i + 2)]
        steps = 4
        for s in range(steps):
            t = s / float(steps)
            t2 = t * t
            t3 = t2 * t
            pt = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            samples.append(pt)
    samples.append(anchors[-1])
    return samples


def base_mountain_elevation(x, y):
    """Macro mountain shape with dramatic alpine ridges, forested flanks, and valley."""
    # Puncak utama lebih runcing & dramatis di belakang pelataran #100
    dx_peak = x * 0.88
    dy_peak = y - 10.8
    d_peak = math.hypot(dx_peak, dy_peak)
    main_peak = 15.6 * math.exp(-(d_peak * d_peak) / 96.0) + 1.8 * max(0.0, 1.0 - d_peak / 9.0)

    # Punggung puncak sekunder di kiri-kanan atas agar siluet gunung alami
    d_sub_l = math.hypot((x + 6.8) * 0.85, (y - 9.2) * 0.85)
    d_sub_r = math.hypot((x - 7.2) * 0.85, (y - 9.5) * 0.85)
    sub_peaks = 8.4 * math.exp(-(d_sub_l * d_sub_l) / 48.0) + 8.8 * math.exp(-(d_sub_r * d_sub_r) / 52.0)

    # Punggung lereng tempat jalan setapak
    slope_y = smoothstep(-14.0, 8.8, y)
    ridge_w = math.exp(-(x * x) / (235.0 - 95.0 * slope_y))
    slope_body = (9.5 * slope_y) * ridge_w

    # Bukit hutan pengapit kiri & kanan
    d_left = math.hypot((x + 13.8) * 0.85, (y + 1.2) * 0.65)
    d_right = math.hypot((x - 14.0) * 0.85, (y + 0.5) * 0.65)
    flank_left = 4.6 * math.exp(-(d_left * d_left) / 50.0)
    flank_right = 4.9 * math.exp(-(d_right * d_right) / 54.0)

    # Lipatan punggungan tebing (alpine ridges)
    ridge_fold = (
        0.55 * abs(math.sin(x * 0.32 + y * 0.18))
        + 0.35 * math.sin(x * 0.55 - y * 0.48)
    )

    base_flat = smoothstep(-16.0, -11.2, y)
    z = max(main_peak, sub_peaks, slope_body) + flank_left + flank_right + ridge_fold * base_flat

    edge_dist = max(abs(x) / 17.6, abs(y) / 17.6)
    edge_falloff = 1.0 - smoothstep(0.84, 1.04, edge_dist)
    return max(0.0, z * edge_falloff)


def sample_surface_height(x, y, trail_samples):
    """Exact blended terrain surface height at (x, y) so chutes & ladders clear intermediate shelves."""
    base_z = base_mountain_elevation(x, y)
    best_d2 = 9999.0
    best_tz = base_z
    for sp in trail_samples:
        d2 = (x - sp.x) * (x - sp.x) + (y - sp.y) * (y - sp.y)
        if d2 < best_d2:
            best_d2 = d2
            best_tz = sp.z
    best_d = math.sqrt(best_d2)
    trail_blend = 1.0 - smoothstep(0.75, 1.95, best_d)
    return base_z * (1.0 - trail_blend) + (best_tz - 0.05) * trail_blend, trail_blend


def create_mesh_with_vcol(name, bm, vert_colors, material, collection, flat=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = not flat

    color_attr = mesh.color_attributes.new(name="TrailColor", type="BYTE_COLOR", domain="POINT")
    mesh.color_attributes.active_color = color_attr
    for idx, rgba in enumerate(vert_colors):
        if idx < len(color_attr.data):
            color_attr.data[idx].color = rgba

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def build_material(name, roughness=0.88, metallic=0.0, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (220, 0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "TrailColor"
    vcol.location = (-120, 120)
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])

    if emission_strength > 0.0 and "Emission Color" in bsdf.inputs:
        nt.links.new(vcol.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_box_to_bm(bm, vcols, center, size, rot_euler, color):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    mat = Matrix.Translation(center) @ rot_euler.to_matrix().to_4x4() @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    vmap = {}
    for v in tmp.verts:
        nv = bm.verts.new(mat @ v.co)
        vmap[v] = nv
        vcols.append(color)
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def add_cylinder_to_bm(bm, vcols, p0, p1, r0, r1, segs, color, cap_ends=True):
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
        ang = (s / segs) * math.pi * 2.0
        ca, sa = math.cos(ang), math.sin(ang)
        ring0.append(bm.verts.new(v0 + (x_dir * ca + y_dir * sa) * r0))
        vcols.append(color)
        ring1.append(bm.verts.new(v1 + (x_dir * ca + y_dir * sa) * r1))
        vcols.append(color)

    for s in range(segs):
        sn = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
    if cap_ends:
        bm.faces.new(list(reversed(ring0)))
        bm.faces.new(ring1)


def build_mountain_terrain(trail_samples, mats, col):
    """Build triangulated low-poly mountain terrain with alpine snow peak and carved trail shelves."""
    bm = bmesh.new()
    vcols = []

    c_valley = hex_to_rgba("#4c9442")
    c_forest = hex_to_rgba("#326936")
    c_dirt_rim = hex_to_rgba("#6d593e")
    c_rock_low = hex_to_rgba("#767e85")
    c_rock_high = hex_to_rgba("#586068")
    c_snow = hex_to_rgba("#f1f6fc")
    c_soil_skirt = hex_to_rgba("#594129")

    nx_segs = 80
    ny_segs = 80
    half_span = 18.0
    grid = []

    rng = random.Random(42)

    for iy in range(ny_segs + 1):
        row_verts = []
        ty = iy / float(ny_segs)
        y = -half_span + ty * (half_span * 2.0)
        for ix in range(nx_segs + 1):
            tx = ix / float(nx_segs)
            x = -half_span + tx * (half_span * 2.0)

            z, trail_blend = sample_surface_height(x, y, trail_samples)

            # Jitter XZ & Z ringan pada area luar jalur untuk facet segitiga low-poly alami
            jx, jy = x, y
            if trail_blend < 0.15 and 0 < ix < nx_segs and 0 < iy < ny_segs:
                jx += rng.uniform(-0.08, 0.08)
                jy += rng.uniform(-0.08, 0.08)
                if z > 0.35:
                    z += rng.uniform(-0.14, 0.16)

            if ix == 0 or ix == nx_segs or iy == 0 or iy == ny_segs:
                z = -0.6

            v = bm.verts.new((jx, jy, z))
            row_verts.append(v)

            snow_line = 10.8 + 0.45 * math.sin(x * 0.65)
            if z < 0.0:
                col_v = c_soil_skirt
            elif trail_blend > 0.42:
                col_v = lerp_color(c_forest, c_dirt_rim, trail_blend)
            elif z < 2.8:
                col_v = lerp_color(c_valley, c_forest, smoothstep(0.4, 2.8, z))
            elif z < 6.6:
                col_v = lerp_color(c_forest, c_rock_low, smoothstep(2.6, 5.8, z))
            elif z < snow_line:
                col_v = lerp_color(c_rock_low, c_rock_high, smoothstep(6.6, snow_line, z))
            else:
                col_v = lerp_color(c_rock_high, c_snow, smoothstep(snow_line - 0.5, snow_line + 0.9, z))

            vcols.append(col_v)
        grid.append(row_verts)

    for iy in range(ny_segs):
        for ix in range(nx_segs):
            v00 = grid[iy][ix]
            v10 = grid[iy][ix + 1]
            v11 = grid[iy + 1][ix + 1]
            v01 = grid[iy + 1][ix]
            # Triangulasi diagonal bergantian untuk facet segitiga low-poly alami
            if (ix + iy) % 2 == 0:
                bm.faces.new((v00, v10, v11))
                bm.faces.new((v00, v11, v01))
            else:
                bm.faces.new((v00, v10, v01))
                bm.faces.new((v10, v11, v01))

    create_mesh_with_vcol("MountainTerrain", bm, vcols, mats["terrain"], col, flat=True)


def build_winding_trail_bed(trail_samples, mats, col):
    """Build winding dirt footpath ribbon along the sculpted mountain slope."""
    bm = bmesh.new()
    vcols = []

    c_dirt_center = hex_to_rgba("#9c744c")
    c_dirt_edge = hex_to_rgba("#765638")

    rings = []
    n = len(trail_samples)
    for i, p in enumerate(trail_samples):
        p_prev = trail_samples[max(0, i - 1)]
        p_next = trail_samples[min(n - 1, i + 1)]
        tang = Vector((p_next.x - p_prev.x, p_next.y - p_prev.y, 0.0))
        if tang.length < 1e-5:
            tang = Vector((1.0, 0.0, 0.0))
        tang.normalize()
        side = Vector((-tang.y, tang.x, 0.0))

        half_w = 0.68
        vl = bm.verts.new(Vector((p.x - side.x * half_w, p.y - side.y * half_w, p.z - 0.03)))
        vc = bm.verts.new(Vector((p.x, p.y, p.z + 0.02)))
        vr = bm.verts.new(Vector((p.x + side.x * half_w, p.y + side.y * half_w, p.z - 0.03)))

        vcols.extend([c_dirt_edge, c_dirt_center, c_dirt_edge])
        rings.append((vl, vc, vr))

    for i in range(len(rings) - 1):
        l0, c0, r0 = rings[i]
        l1, c1, r1 = rings[i + 1]
        bm.faces.new((l0, c0, c1, l1))
        bm.faces.new((c0, r0, r1, c1))

    create_mesh_with_vcol("WindingTrailBed", bm, vcols, mats["trail"], col, flat=True)


def build_stepping_stones(mats, col):
    """Place 100 natural low-poly stepping stone pads along the mountain trail (#1 to #100)."""
    bm = bmesh.new()
    vcols = []

    c_stone_a = hex_to_rgba("#bfb8ab")
    c_stone_b = hex_to_rgba("#a49e92")
    c_start = hex_to_rgba("#4ade80")
    c_summit = hex_to_rgba("#facc15")
    c_ladder = hex_to_rgba("#86efac")
    c_stream = hex_to_rgba("#38bdf8")
    c_slide = hex_to_rgba("#fb923c")
    c_mystery = hex_to_rgba("#c084fc")

    rng = random.Random(101)

    for tile in range(1, 101):
        p = tile_to_trail_point(tile)
        if tile == 1:
            stone_col = c_start
            rad = 0.56
        elif tile == 100:
            stone_col = c_summit
            rad = 0.64
        elif tile in LADDERS:
            stone_col = c_ladder
            rad = 0.48
        elif tile in STREAMS:
            stone_col = c_stream
            rad = 0.48
        elif tile in LANDSLIDES:
            stone_col = c_slide
            rad = 0.48
        elif tile in MYSTERY_TILES:
            stone_col = c_mystery
            rad = 0.48
        else:
            stone_col = c_stone_a if tile % 2 == 0 else c_stone_b
            rad = rng.uniform(0.36, 0.44)

        segs = 7
        rot_off = rng.uniform(0.0, math.pi)
        top_verts = []
        bot_verts = []
        for s in range(segs):
            ang = rot_off + (s / float(segs)) * math.pi * 2.0
            r_jit = rad * rng.uniform(0.88, 1.08)
            vx = p.x + math.cos(ang) * r_jit
            vy = p.y + math.sin(ang) * r_jit * 0.85
            top_verts.append(bm.verts.new((vx, vy, p.z + 0.08)))
            vcols.append(stone_col)
            bot_verts.append(bm.verts.new((vx, vy, p.z - 0.04)))
            vcols.append(lerp_color(stone_col, hex_to_rgba("#4a4740"), 0.45))

        bm.faces.new(top_verts)
        for s in range(segs):
            sn = (s + 1) % segs
            bm.faces.new((bot_verts[s], bot_verts[sn], top_verts[sn], top_verts[s]))

    create_mesh_with_vcol("SteppingStones", bm, vcols, mats["stone"], col, flat=True)


def build_cliff_ladders(trail_samples, mats, col):
    """Build 8 timber cliff ladders arched cleanly above intermediate terraces."""
    bm = bmesh.new()
    vcols = []

    c_rail = hex_to_rgba("#8c5828")
    c_rung = hex_to_rgba("#d49653")

    for from_tile, to_tile in LADDERS.items():
        p0 = tile_to_trail_point(from_tile) + Vector((0.0, -0.25, 0.14))
        p1 = tile_to_trail_point(to_tile) + Vector((0.0, -0.25, 0.14))

        # Sampel titik kurva tangga yang selalu di atas permukaan lereng
        row_span = abs(((to_tile - 1) // 10) - ((from_tile - 1) // 10))
        arch_out = 0.35 + row_span * 0.28
        ladder_pts = []
        segs = 10
        for i in range(segs + 1):
            t = i / float(segs)
            pt = p0.lerp(p1, t)
            pt.y -= math.sin(t * math.pi) * arch_out
            surf_z, _ = sample_surface_height(pt.x, pt.y, trail_samples)
            pt.z = max(pt.z, surf_z + 0.32)
            ladder_pts.append(pt)

        axis = p1 - p0
        up_hint = Vector((0.0, -1.0, 0.4)).normalized()
        side = axis.cross(up_hint)
        if side.length < 1e-4:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()

        rail_half = 0.28
        for i in range(segs):
            a = ladder_pts[i]
            b = ladder_pts[i + 1]
            for sign in (-1.0, 1.0):
                add_cylinder_to_bm(
                    bm,
                    vcols,
                    a + side * (sign * rail_half),
                    b + side * (sign * rail_half),
                    0.06,
                    0.06,
                    6,
                    c_rail,
                )
            # Anak tangga setiap segmen
            mid = (a + b) * 0.5
            add_cylinder_to_bm(
                bm,
                vcols,
                mid - side * (rail_half + 0.04),
                mid + side * (rail_half + 0.04),
                0.042,
                0.042,
                6,
                c_rung,
            )

    create_mesh_with_vcol("CliffLadders", bm, vcols, mats["wood"], col, flat=True)


def build_streams_and_landslides(trail_samples, mats, col):
    """Build 4 cascading turquoise mountain streams and 4 dusty scree landslide chutes that hug the slope cleanly."""
    # 1. Sungai Jeram (Streams)
    bm_water = bmesh.new()
    water_vcols = []
    c_water_deep = hex_to_rgba("#0ea5e9")
    c_water_foam = hex_to_rgba("#bae6fd")

    for idx, (from_tile, to_tile) in enumerate(STREAMS.items()):
        p_start = tile_to_trail_point(from_tile) + Vector((0.0, -0.15, 0.16))
        p_end = tile_to_trail_point(to_tile) + Vector((0.0, -0.15, 0.14))
        perp = Vector((-(p_end.y - p_start.y), p_end.x - p_start.x, 0.0))
        if perp.length < 1e-4:
            perp = Vector((1.0, 0.0, 0.0))
        perp.normalize()

        row_span = abs(((from_tile - 1) // 10) - ((to_tile - 1) // 10))
        segs = 22
        prev_pair = None
        for i in range(segs + 1):
            t = i / float(segs)
            pt = p_start.lerp(p_end, t)
            swirl = math.sin(t * math.pi * 2.2 + idx) * 0.65 * math.sin(t * math.pi)
            pt += perp * swirl
            pt.y -= math.sin(t * math.pi) * (0.35 + row_span * 0.25)
            surf_z, _ = sample_surface_height(pt.x, pt.y, trail_samples)
            pt.z = max(pt.z, surf_z + 0.26) + math.sin(t * math.pi) * 0.18
            w = 0.30 + 0.08 * math.sin(t * math.pi)

            v_l = bm_water.verts.new(pt - perp * w)
            v_r = bm_water.verts.new(pt + perp * w)
            col_w = lerp_color(c_water_deep, c_water_foam, 0.25 + 0.55 * abs(math.sin(t * math.pi * 3.0)))
            water_vcols.extend([col_w, col_w])
            if prev_pair is not None:
                bm_water.faces.new((prev_pair[0], prev_pair[1], v_r, v_l))
            prev_pair = (v_l, v_r)

    create_mesh_with_vcol("MountainStreams", bm_water, water_vcols, mats["water"], col, flat=True)

    # 2. Jalur Longsoran Tebing (Landslide Chutes)
    bm_slide = bmesh.new()
    slide_vcols = []
    c_scree_a = hex_to_rgba("#b45309")
    c_scree_b = hex_to_rgba("#d97706")
    c_rock_scree = hex_to_rgba("#78716c")

    rng = random.Random(303)
    for idx, (from_tile, to_tile) in enumerate(LANDSLIDES.items()):
        p_start = tile_to_trail_point(from_tile) + Vector((0.0, -0.15, 0.16))
        p_end = tile_to_trail_point(to_tile) + Vector((0.0, -0.15, 0.14))
        perp = Vector((-(p_end.y - p_start.y), p_end.x - p_start.x, 0.0))
        if perp.length < 1e-4:
            perp = Vector((1.0, 0.0, 0.0))
        perp.normalize()

        row_span = abs(((from_tile - 1) // 10) - ((to_tile - 1) // 10))
        segs = 20
        prev_pair = None
        for i in range(segs + 1):
            t = i / float(segs)
            pt = p_start.lerp(p_end, t)
            swirl = math.sin(t * math.pi * 1.8 - idx) * 0.55 * math.sin(t * math.pi)
            pt += perp * swirl
            pt.y -= math.sin(t * math.pi) * (0.35 + row_span * 0.26)
            surf_z, _ = sample_surface_height(pt.x, pt.y, trail_samples)
            pt.z = max(pt.z, surf_z + 0.26) + math.sin(t * math.pi) * 0.16
            w = 0.34

            v_l = bm_slide.verts.new(pt - perp * w)
            v_r = bm_slide.verts.new(pt + perp * w)
            col_s = lerp_color(c_scree_a, c_scree_b, (i % 3) * 0.4)
            slide_vcols.extend([col_s, col_s])
            if prev_pair is not None:
                bm_slide.faces.new((prev_pair[0], prev_pair[1], v_r, v_l))
            prev_pair = (v_l, v_r)

            if 1 < i < segs and i % 3 == 0:
                pebble_pos = pt + perp * rng.choice([-0.38, 0.38]) + Vector((0, 0, 0.06))
                add_box_to_bm(
                    bm_slide,
                    slide_vcols,
                    pebble_pos,
                    (0.22, 0.18, 0.15),
                    Euler((rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 3))),
                    c_rock_scree,
                )

    create_mesh_with_vcol("LandslideChutes", bm_slide, slide_vcols, mats["trail"], col, flat=True)


def setup_studio(studio_col):
    world = bpy.data.worlds.new("MountainStudioWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_to_rgba("#87ceeb")
        bg.inputs["Strength"].default_value = 0.85

    sun_data = bpy.data.lights.new("SunKey", type="SUN")
    sun_data.energy = 3.2
    sun_data.color = (1.0, 0.96, 0.88)
    sun_obj = bpy.data.objects.new("SunKey", sun_data)
    sun_obj.rotation_euler = (math.radians(46), math.radians(18), math.radians(-38))
    studio_col.objects.link(sun_obj)

    fill_data = bpy.data.lights.new("SkyFill", type="SUN")
    fill_data.energy = 0.95
    fill_data.color = (0.72, 0.86, 1.0)
    fill_obj = bpy.data.objects.new("SkyFill", fill_data)
    fill_obj.rotation_euler = (math.radians(58), math.radians(-20), math.radians(135))
    studio_col.objects.link(fill_obj)

    cam_data = bpy.data.cameras.new("PreviewCamera")
    cam_data.lens = 34.0
    cam_obj = bpy.data.objects.new("PreviewCamera", cam_data)
    cam_obj.location = (0.0, -35.5, 22.0)
    cam_dir = Vector((0.0, -1.0, 4.6)) - cam_obj.location
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
                if hasattr(space, "clip_end"):
                    space.clip_end = 1000.0
                if space.region_3d is not None:
                    space.region_3d.view_perspective = "PERSP"
                    space.region_3d.view_location = Vector((0.0, -1.0, 4.6))
                    space.region_3d.view_rotation = Euler((math.radians(63.0), 0.0, 0.0), "XYZ").to_quaternion()
                    space.region_3d.view_distance = 36.0


def main():
    bpy.ops.wm.read_factory_settings(use_empty=False)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    m_col = bpy.data.collections.new("MountainTrail")
    studio_col = bpy.data.collections.new("Studio")
    bpy.context.scene.collection.children.link(m_col)
    bpy.context.scene.collection.children.link(studio_col)

    mats = {
        "terrain": build_material("MountainTerrainMat", roughness=0.92),
        "trail": build_material("MountainTrailMat", roughness=0.90),
        "stone": build_material("SteppingStoneMat", roughness=0.82),
        "wood": build_material("CliffLadderMat", roughness=0.80),
        "water": build_material("MountainStreamMat", roughness=0.18, emission_strength=0.15),
    }

    trail_samples = build_smooth_trail_samples()
    build_mountain_terrain(trail_samples, mats, m_col)
    build_winding_trail_bed(trail_samples, mats, m_col)
    build_stepping_stones(mats, m_col)
    build_cliff_ladders(trail_samples, mats, m_col)
    build_streams_and_landslides(trail_samples, mats, m_col)
    setup_studio(studio_col)

    total_verts = sum(len(o.data.vertices) for o in m_col.objects if o.type == "MESH")
    total_polys = sum(len(o.data.polygons) for o in m_col.objects if o.type == "MESH")
    print(f"[MountainTrail geometry] objects={len(m_col.objects)}, verts={total_verts}, polys={total_polys}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print(f"[Saved] {BLEND_PATH}")

    scene = bpy.context.scene
    available_engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available_engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"[Rendered preview] {PREVIEW_PATH}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in m_col.objects:
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
