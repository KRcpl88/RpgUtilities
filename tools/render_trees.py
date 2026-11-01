#!/usr/bin/env python3
"""Render random trees, mountains, and a hex forest: python3 tools/render_trees.py [output.svg]."""

import argparse
import json
import math
from pathlib import Path
import random


CLUSTER_JSON = """
{
  "hexes": [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
    [3, 3], [3, 4], [3, 5], [3, 6], [3, 7],
    [4, 4], [4, 5], [4, 6], [4, 7], [4, 8],
    [5, 2], [5, 3], [5, 4], [5, 5], [5, 6],
    [6, 0], [6, 1], [6, 2], [6, 3], [6, 4],
    [7, -2], [7, -1], [7, 0], [7, 1], [7, 2],
    [8, -4], [8, -3], [8, -2], [8, -1], [8, 0]
  ],
  "radius": 24
}
"""


def tree(center_x):
    width = random.uniform(38, 50)
    height = random.uniform(45, 60)
    y = 150 - height
    lobes = random.randint(9, 13)
    points = []
    for n in range(lobes):
        angle = math.tau * n / lobes
        radius = random.uniform(0.85, 1.0)
        points.append((width * radius * math.cos(angle),
                         height * radius * math.sin(angle)))
    path = f'M {points[0][0]:.2f},{points[0][1]:.2f}'
    for n in range(lobes):
        angle = math.tau * (n + 0.5) / lobes
        bulge = random.uniform(1.15, 1.4)
        x, end_y = points[(n + 1) % lobes]
        path += (f' Q {width * bulge * math.cos(angle):.2f},'
                   f'{height * bulge * math.sin(angle):.2f}'
                   f' {x:.2f},{end_y:.2f}')
    return (
        f'<g transform="translate({center_x},0)">'
        '<path d="M -6,185 L -4,130 L 4,130 L 6,185 Z" '
        'fill="#936442" stroke="#493c2b" stroke-width="2"/>'
        f'<path transform="translate(0,{y:.2f})" d="{path} Z" '
        'fill="#91b765" stroke="#395331" stroke-width="2" '
        'stroke-linejoin="round"/>'
        '</g>'
    )


def mountain(center_x):
    width = random.uniform(100, 125)
    base_y = 365
    anchors = [
        (-width / 2, base_y),
        (-random.uniform(18, 35), base_y - random.uniform(85, 125)),
        (random.uniform(-8, 8), base_y - random.uniform(35, 55)),
        (random.uniform(18, 35), base_y - random.uniform(85, 125)),
        (width / 2, base_y),
    ]
    points = [anchors[0]]
    for (start_x, start_y), (end_x, end_y) in zip(anchors, anchors[1:]):
        point_count = random.randint(2, 3)
        for n in range(1, point_count + 1):
            tx = (n + random.uniform(-0.25, 0.25)) / (point_count + 1)
            ty = (n + random.uniform(-0.25, 0.25)) / (point_count + 1)
            points.append((start_x + (end_x - start_x) * tx,
                             start_y + (end_y - start_y) * ty))
        points.append((end_x, end_y))
    path = 'M ' + ' L '.join(f'{x:.2f},{y:.2f}' for x, y in points)
    return (
        f'<g transform="translate({center_x},0)">'
        f'<path d="{path} Z" fill="#d3d3d3" stroke="none"/>'
        f'<path d="{path}" fill="none" stroke="#000000" stroke-width="2" '
        'stroke-linejoin="round" stroke-linecap="round"/>'
        '</g>'
    )


def hex_vertices(x, y, radius):
    if not math.isfinite(radius) or radius <= 0:
        raise ValueError('Hex radius must be positive and finite')
    half_height = math.sqrt(3) * radius / 2
    return [
        (x + radius, y),
        (x + radius / 2, y + half_height),
        (x - radius / 2, y + half_height),
        (x - radius, y),
        (x - radius / 2, y - half_height),
        (x + radius / 2, y - half_height),
    ]


def build_hex_cluster(data):
    """Build flat-top hex polygons from a dict or JSON text.

    Required: hexes, a nonempty list of integer axial [q, r] coordinates.
    Optional: radius (default 24), origin [x, y] (default [0, 0]).
    Duplicate cells and clusters not connected through shared edges are rejected.
    """
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict) or set(data) - {'hexes', 'radius', 'origin'}:
        raise ValueError('Cluster must be an object with hexes, radius, and/or origin')
    axial_cells = data.get('hexes')
    if not isinstance(axial_cells, (list, tuple)) or not axial_cells:
        raise ValueError('Cluster hexes must be a nonempty list of [q, r] coordinates')
    coordinates = []
    for cell in axial_cells:
        if (not isinstance(cell, (list, tuple)) or len(cell) != 2
                or any(type(value) is not int for value in cell)):
            raise ValueError('Each hex coordinate must contain two integers [q, r]')
        coordinates.append(tuple(cell))
    cells = set(coordinates)
    if len(cells) != len(coordinates):
        raise ValueError('Cluster contains duplicate hex coordinates')
    reached = {coordinates[0]}
    pending = [coordinates[0]]
    while pending:
        q, r = pending.pop()
        for dq, dr in ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)):
            neighbor = (q + dq, r + dr)
            if neighbor in cells and neighbor not in reached:
                reached.add(neighbor)
                pending.append(neighbor)
    if reached != cells:
        raise ValueError('Cluster hexes must be connected through shared edges')

    radius = data.get('radius', 24)
    if (type(radius) not in (int, float)
            or not math.isfinite(radius) or radius <= 0):
        raise ValueError('Cluster radius must be positive and finite')
    origin = data.get('origin', [0, 0])
    if (not isinstance(origin, (list, tuple)) or len(origin) != 2
            or any(type(value) not in (int, float) or not math.isfinite(value)
                   for value in origin)):
        raise ValueError('Cluster origin must contain two finite numbers [x, y]')
    origin_x, origin_y = origin
    height = math.sqrt(3) * radius
    return [
        hex_vertices(origin_x + 1.5 * radius * q,
                    origin_y + height * (r + q / 2), radius)
        for q, r in coordinates
    ]


def v_hex_cluster():
    """Return 45 flat-top hex polygons: four descending columns, then five ascending."""
    axial_cells = []
    for column in range(9):
        start_row = column if column < 4 else 12 - 2 * column
        for row in range(start_row, start_row + 5):
            axial_cells.append((column, row))
    return build_hex_cluster({
        'hexes': axial_cells,
        'origin': [81, 420 + math.sqrt(3) * 24 / 2],
    })


def horizontal_segments(hexes, y):
    """Intersect hex polygons at y; return sorted ((left, y), (right, y)) pairs.

    Shared edges and overlapping intervals are merged; gaps remain separate.
    Horizontal boundary edges are included, but isolated vertex touches are not.
    """
    if not math.isfinite(y):
        raise ValueError('Horizontal line y must be finite')
    intervals = []
    for vertices in hexes:
        xs = []
        for (x1, y1), (x2, y2) in zip(
                vertices, vertices[1:] + vertices[:1]):
            if min(y1, y2) <= y <= max(y1, y2):
                if y1 == y2:
                    xs.extend((x1, x2))
                else:
                    xs.append(x1 + (x2 - x1) * (y - y1) / (y2 - y1))
        if xs and min(xs) < max(xs):
            intervals.append((min(xs), max(xs)))
    merged = []
    for left_coordinate, right_coordinate in sorted(intervals):
        if merged and (left_coordinate <= merged[-1][1] or math.isclose(
                left_coordinate, merged[-1][1], rel_tol=0, abs_tol=1e-9)):
            merged[-1] = (merged[-1][0], max(merged[-1][1], right_coordinate))
        else:
            merged.append((left_coordinate, right_coordinate))
    return [((left_coordinate, y), (right_coordinate, y)) for left_coordinate, right_coordinate in merged]


def hex_forest(hexes):
    svg = ['<g id="hex-cluster">']
    for vertices in hexes:
        x = sum(x for x, y in vertices) / len(vertices)
        y = sum(y for x, y in vertices) / len(vertices)
        scale = (max(x for x, y in vertices)
                  - min(x for x, y in vertices)) / 240
        point_coordinates = ' '.join(f'{x:.2f},{y:.2f}' for x, y in vertices)
        svg.append(
            f'<g><polygon points="{point_coordinates}" fill="#f5f5f5" '
            'stroke="#777777" stroke-width="1"/>'
            f'<g transform="translate({x:.2f},{y:.2f}) scale({scale:g}) '
            f'translate(0,-100)">{tree(0)}</g></g>')
    svg.append('</g>')
    return '\n'.join(svg)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', default='trees.svg')
    args = parser.parse_args()
    try:
        hexes = build_hex_cluster(CLUSTER_JSON)
    except ValueError as error:
        parser.error(f'Invalid embedded cluster JSON: {error}')
    min_x = min(x for hexagon in hexes for x, y in hexagon)
    max_x = max(x for hexagon in hexes for x, y in hexagon)
    min_y = min(y for hexagon in hexes for x, y in hexagon)
    max_y = max(y for hexagon in hexes for x, y in hexagon)
    width = max(450, max_x - min_x + 50)
    height = max(900, max_y - min_y + 420 + 20)
    left_margin = (width - (max_x - min_x)) / 2
    hexes = [[(x - min_x + left_margin, y - min_y + 420) for x, y in hexagon]
               for hexagon in hexes]
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" '
             f'width="{width:g}" height="{height:g}" '
             f'viewBox="0 0 {width:g} {height:g}">\n'
             + '\n'.join(tree(center_x) for center_x in (75, 225, 375))
             + '\n' + '\n'.join(mountain(center_x) for center_x in (75, 225, 375))
             + '\n' + hex_forest(hexes)
             + '\n</svg>\n')
    Path(args.output).write_text(svg, encoding='utf-8')
    print(f'Wrote {args.output}')


if __name__ == '__main__':
    main()
