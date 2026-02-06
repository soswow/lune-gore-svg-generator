#!/usr/bin/env python3
"""
Generate an SVG globe gore (spherical lune) for a sphere.

This uses a standard gore approximation: distances along meridians are preserved,
while the width at each latitude equals the spherical arc between meridians.
The resulting flat patch ("peel") is commonly used for paper globes.
"""

from __future__ import annotations

import argparse
import math
import re
from pathlib import Path
from typing import Dict, List, Tuple


Point = Tuple[float, float]
Bounds = Tuple[float, float, float, float]
DEFAULT_SEAM_MM = 0.0
DEFAULT_STROKE = "none"
DEFAULT_STROKE_WIDTH_MM = 0.0
DEFAULT_FILL = "#000000"
DEFAULT_FILL_OPACITY = 0.5


def max_cos_on_interval(a: float, b: float) -> float:
    """Maximum value of cos(x) on closed interval [a, b]."""
    if a > b:
        a, b = b, a
    two_pi = 2.0 * math.pi
    k = math.ceil(a / two_pi)
    if k * two_pi <= b:
        return 1.0
    return max(math.cos(a), math.cos(b))


def gore_bounds(
    radius: float,
    gores: int,
    lat_min: float,
    lat_max: float,
) -> Bounds:
    if gores < 1:
        raise ValueError("gores must be >= 1")
    if radius <= 0:
        raise ValueError("radius must be > 0")
    if lat_min >= lat_max:
        raise ValueError("lat_min must be < lat_max")

    delta_lambda = 2.0 * math.pi / gores
    amp = 0.5 * radius * delta_lambda
    max_half_width = max(0.0, amp * max_cos_on_interval(lat_min, lat_max) + DEFAULT_SEAM_MM)

    min_x = -max_half_width
    max_x = max_half_width
    min_y = radius * lat_min
    max_y = radius * lat_max
    return (min_x, min_y, max_x, max_y)


def half_width_at_lat(radius: float, delta_lambda: float, lat: float) -> float:
    """Return half-width x(lat) at latitude lat."""
    half_width = 0.5 * radius * delta_lambda * math.cos(lat) + DEFAULT_SEAM_MM
    if half_width <= 0.0:
        return 0.0
    return half_width


def scale_factors_from_deltas(base_width: float, base_height: float, scale_x_mm: float, scale_y_mm: float) -> Tuple[float, float]:
    target_width = base_width + scale_x_mm
    target_height = base_height + scale_y_mm
    if target_width <= 0:
        raise ValueError("--scale-x-mm makes peel width <= 0")
    if target_height <= 0:
        raise ValueError("--scale-y-mm makes peel height <= 0")
    return (target_width / base_width, target_height / base_height)


def transform_point(x: float, y: float, cx: float, cy: float, sx: float, sy: float, tx: float, ty: float) -> Point:
    return (
        cx + (x - cx) * sx + tx,
        cy + (y - cy) * sy + ty,
    )


def sanitize_token(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return cleaned or "x"


def format_value_for_filename(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return sanitize_token(f"{value:g}".replace("-", "m").replace(".", "p"))
    if isinstance(value, Path):
        return sanitize_token(value.stem)
    return sanitize_token(str(value))


def auto_output_path(args: argparse.Namespace, defaults: Dict[str, object]) -> Path:
    parts: List[str] = ["lune"]
    for key, default_value in defaults.items():
        if key in {"output"}:
            continue
        value = getattr(args, key)
        if value == default_value:
            continue
        if isinstance(value, bool):
            if value:
                parts.append(sanitize_token(key))
            else:
                parts.append(f"{sanitize_token(key)}-false")
            continue
        parts.append(f"{sanitize_token(key)}-{format_value_for_filename(value)}")

    return Path("_".join(parts) + ".svg")


def gore_polyline_path(
    radius: float,
    gores: int,
    lat_min: float,
    lat_max: float,
    segments: int,
    cx: float,
    cy: float,
    sx: float,
    sy: float,
    tx: float,
    ty: float,
) -> str:
    if segments < 1:
        raise ValueError("samples must be >= 1")

    delta_lambda = 2.0 * math.pi / gores
    dlat = (lat_max - lat_min) / segments

    # Visual top corresponds to lat_min (smaller y), visual bottom to lat_max.
    y_top = radius * lat_min
    y_bottom = radius * lat_max
    x_top = half_width_at_lat(radius, delta_lambda, lat_min)
    x_bottom = half_width_at_lat(radius, delta_lambda, lat_max)

    # Start at visual top-left.
    x_start_t, y_start_t = transform_point(-x_top, y_top, cx=cx, cy=cy, sx=sx, sy=sy, tx=tx, ty=ty)
    parts = [f"M {x_start_t:.6f} {y_start_t:.6f}"]

    # Top cap: top-left -> top-right when width is non-zero.
    if x_top > 1e-12:
        x_tr_t, y_tr_t = transform_point(x_top, y_top, cx=cx, cy=cy, sx=sx, sy=sy, tx=tx, ty=ty)
        parts.append(f"L {x_tr_t:.6f} {y_tr_t:.6f}")

    # Right edge: top -> bottom.
    for i in range(segments):
        lat = lat_min + dlat * (i + 1)
        x = half_width_at_lat(radius, delta_lambda, lat)
        y = radius * lat
        xt, yt = transform_point(x, y, cx=cx, cy=cy, sx=sx, sy=sy, tx=tx, ty=ty)
        parts.append(f"L {xt:.6f} {yt:.6f}")

    # Bottom cap: bottom-right -> bottom-left when width is non-zero.
    if x_bottom > 1e-12:
        x_bl_t, y_bl_t = transform_point(-x_bottom, y_bottom, cx=cx, cy=cy, sx=sx, sy=sy, tx=tx, ty=ty)
        parts.append(f"L {x_bl_t:.6f} {y_bl_t:.6f}")

    # Left edge: bottom -> top.
    for i in range(segments):
        lat = lat_max - dlat * (i + 1)
        x = -half_width_at_lat(radius, delta_lambda, lat)
        y = radius * lat
        xt, yt = transform_point(x, y, cx=cx, cy=cy, sx=sx, sy=sy, tx=tx, ty=ty)
        parts.append(f"L {xt:.6f} {yt:.6f}")

    parts.append("Z")
    return " ".join(parts)


def build_svg(
    radius: float,
    gores: int,
    lat_min: float,
    lat_max: float,
    samples: int,
    count: int,
    scale_x_mm: float,
    scale_y_mm: float,
) -> str:
    if count < 1:
        raise ValueError("count must be >= 1")

    min_x, min_y, max_x, max_y = gore_bounds(
        radius=radius,
        gores=gores,
        lat_min=lat_min,
        lat_max=lat_max,
    )
    base_width = max_x - min_x
    base_height = max_y - min_y
    sx, sy = scale_factors_from_deltas(base_width, base_height, scale_x_mm, scale_y_mm)
    cx = 0.5 * (min_x + max_x)
    cy = 0.5 * (min_y + max_y)

    scaled_min_x = cx + (min_x - cx) * sx
    scaled_max_x = cx + (max_x - cx) * sx
    scaled_min_y = cy + (min_y - cy) * sy
    scaled_max_y = cy + (max_y - cy) * sy

    step_x = base_width
    x_offsets = [i * step_x for i in range(count)]
    global_min_x = min((scaled_min_x + ox) for ox in x_offsets)
    global_max_x = max((scaled_max_x + ox) for ox in x_offsets)
    global_min_y = scaled_min_y
    global_max_y = scaled_max_y

    width = global_max_x - global_min_x
    height = global_max_y - global_min_y

    path_elements: List[str] = []

    for ox in x_offsets:
        tx = -global_min_x + ox
        ty = -global_min_y
        d = gore_polyline_path(
            radius=radius,
            gores=gores,
            lat_min=lat_min,
            lat_max=lat_max,
            segments=samples,
            cx=cx,
            cy=cy,
            sx=sx,
            sy=sy,
            tx=tx,
            ty=ty,
        )
        path_elements.append(
            f'<path d="{d}" fill="{DEFAULT_FILL}" fill-opacity="{DEFAULT_FILL_OPACITY:.3f}" '
            f'stroke="{DEFAULT_STROKE}" stroke-width="{DEFAULT_STROKE_WIDTH_MM:.6f}" />'
        )

    body = ""
    body += "\n".join(path_elements) + "\n"

    svg = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.6f}mm" height="{height:.6f}mm" '
        f'viewBox="0 0 {width:.6f} {height:.6f}">\n'
        f"{body}"
        "</svg>\n"
    )
    return svg


def parse_args() -> Tuple[argparse.Namespace, Dict[str, object]]:
    p = argparse.ArgumentParser(description="Generate an SVG globe gore (lune).")
    p.add_argument("--diameter", type=float, default=200.0, help="Sphere diameter in mm.")
    p.add_argument("--gores", type=int, default=12, help="Number of gores to cover the sphere.")
    p.add_argument("--count", type=int, default=1, help="Number of peels laid out side by side.")
    p.add_argument("--scale-x-mm", type=float, default=0.0, help="Additive width change per peel in mm.")
    p.add_argument("--scale-y-mm", type=float, default=0.0, help="Additive height change per peel in mm.")
    p.add_argument(
        "--lat-min",
        type=float,
        default=-90.0,
        help="Minimum latitude in degrees (default: -90).",
    )
    p.add_argument(
        "--lat-max",
        type=float,
        default=90.0,
        help="Maximum latitude in degrees (default: 90).",
    )
    p.add_argument("--samples", type=int, default=24, help="Number of line segments per edge.")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output SVG file. If omitted, auto-generated from non-default parameters.",
    )
    args = p.parse_args()
    defaults = {action.dest: action.default for action in p._actions if action.dest != "help"}
    return args, defaults


def main() -> None:
    args, defaults = parse_args()
    if args.count < 1:
        raise ValueError("count must be >= 1")
    if args.output is None:
        args.output = auto_output_path(args, defaults)

    radius = args.diameter * 0.5

    lat_min = math.radians(args.lat_min)
    lat_max = math.radians(args.lat_max)

    min_x, min_y, max_x, max_y = gore_bounds(
        radius=radius,
        gores=args.gores,
        lat_min=lat_min,
        lat_max=lat_max,
    )
    base_lune_width = max_x - min_x
    base_lune_height = max_y - min_y
    sx, sy = scale_factors_from_deltas(base_lune_width, base_lune_height, args.scale_x_mm, args.scale_y_mm)
    cx = 0.5 * (min_x + max_x)
    cy = 0.5 * (min_y + max_y)
    scaled_min_x = cx + (min_x - cx) * sx
    scaled_max_x = cx + (max_x - cx) * sx
    scaled_min_y = cy + (min_y - cy) * sy
    scaled_max_y = cy + (max_y - cy) * sy
    scaled_lune_width = scaled_max_x - scaled_min_x
    scaled_lune_height = scaled_max_y - scaled_min_y

    step_x = base_lune_width
    x_offsets = [i * step_x for i in range(args.count)]
    global_min_x = min((scaled_min_x + ox) for ox in x_offsets)
    global_max_x = max((scaled_max_x + ox) for ox in x_offsets)
    layout_width = global_max_x - global_min_x
    layout_height = scaled_lune_height
    canvas_width = layout_width
    canvas_height = layout_height

    svg = build_svg(
        radius=radius,
        gores=args.gores,
        lat_min=lat_min,
        lat_max=lat_max,
        samples=args.samples,
        count=args.count,
        scale_x_mm=args.scale_x_mm,
        scale_y_mm=args.scale_y_mm,
    )

    args.output.write_text(svg, encoding="utf-8")
    print(f"Wrote {args.output}")
    print(f"Sphere diameter: {args.diameter:.3f} mm")
    print(f"Single peel (base):   {base_lune_width:.3f} x {base_lune_height:.3f} mm")
    print(f"Single peel (scaled): {scaled_lune_width:.3f} x {scaled_lune_height:.3f} mm")
    print(f"Layout: count={args.count}, step_x={step_x:.3f} mm")
    print(f"Layout size: {layout_width:.3f} x {layout_height:.3f} mm")
    print(f"SVG canvas:  {canvas_width:.3f} x {canvas_height:.3f} mm")


if __name__ == "__main__":
    main()
