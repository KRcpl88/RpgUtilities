#!/usr/bin/env python3
"""Render a hex terrain cluster filled with trees, mountains, or hills."""

import argparse
from functools import lru_cache
import json
import math
from pathlib import Path
import random


TREE_MIN_LOBES = 4
TREE_MAX_LOBES = 7
HILL_SCALE = 0.7


CLUSTER_JSON = """
{
  "hexes": [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
    [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
    [3, 2], [3, 3], [3, 4], [3, 5], 
    [4, 2], [4, 3], [4, 4], [4, 5],
    [5, 1], [5, 2], [5, 3], [5, 4], 
    [6, -2], [6, -1], [6, 0], [6, 1], [6, 2], [6, 3],
    [7, -3], [7, -2], [7, -1], [7, 0], [7, 1], [7, 2],
    [8, -4], [8, -3], [8, -2], [8, -1], [8, 0], [8, 1]
  ],
  "radius": 48
}
"""

#returns svg, terrain_width
def tree(center_x):
    width = random.uniform(38, 50)
    height = random.uniform(45, 60)
    y = 150 - height
    lobes = random.randint(TREE_MIN_LOBES, TREE_MAX_LOBES)
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
    ), width * random.uniform(1.5, 1.7)

def _mountain_points(width):
    """Build the shared silhouette used for rendering and corner coverage."""
    shoulders = ((-0.25, 10, 30, 40), (0, 10, 80, 90),
                 (0.25, 10, 30, 40)) if width < 200 else (
                     (-0.34, 8, 20, 30), (-0.15, 6, 80, 90),
                     (0, 6, 40, 60), (0.15, 6, 80, 90),
                     (0.34, 8, 20, 30))
    anchors = [(-width / 2, 100)]
    anchors.extend((width * position + random.uniform(-jitter, jitter),
                    100 - random.uniform(low, high))
                   for position, jitter, low, high in shoulders)
    anchors.append((width / 2, 100))
    points = [anchors[0]]
    for (start_x, start_y), (end_x, end_y) in zip(anchors, anchors[1:]):
        point_count = random.randint(1, 2)
        for point_index in range(1, point_count + 1):
            fraction_x = (point_index + random.uniform(-0.25, 0.25)) \
                / (point_count + 1)
            fraction_y = (point_index + random.uniform(-0.25, 0.25)) \
                / (point_count + 1)
            points.append((start_x + (end_x - start_x) * fraction_x,
                           start_y + (end_y - start_y) * fraction_y))
        points.append((end_x, end_y))
    return points


def _mountain_svg(center_x, points, stroke_width=2):
    path = 'M ' + ' L '.join(f'{x:.2f},{y:.2f}' for x, y in points)
    return (
        f'<g transform="translate({center_x},0)">'
        f'<path d="{path} Z" fill="white" stroke="none"/>'
        f'<path d="{path}" fill="none" stroke="#000000" '
        f'stroke-width="{stroke_width:.10g}" '
        'stroke-linejoin="round" stroke-linecap="round"/>'
        '</g>'
    )


def mountain(center_x, width):
    """Return a mountain SVG group and its unscaled width."""
    return _mountain_svg(center_x, _mountain_points(width)), width


def _hill_points(width):
    """Build a smooth single summit in the mountain reference coordinates."""
    peak_x = random.uniform(-10, 10)
    peak_y = 100 - random.uniform(80, 90)
    anchors = [(-width / 2, 100), (peak_x, peak_y), (width / 2, 100)]
    controls = [(peak_x - width * 0.3, peak_y),
                (peak_x + width * 0.3, peak_y)]
    points = [anchors[0]]
    for start, control, end in zip(anchors, controls, anchors[1:]):
        for step in range(1, 17):
            fraction = step / 16
            remaining = 1 - fraction
            points.append(tuple(
                remaining ** 2 * start[axis]
                + 2 * remaining * fraction * control[axis]
                + fraction ** 2 * end[axis]
                for axis in (0, 1)))
    return points


def hill(center_x, width):
    """Return one rounded hill, 30% smaller than a single-peak mountain."""
    points = [(x * HILL_SCALE, 100 + (y - 100) * HILL_SCALE)
              for x, y in _hill_points(width)]
    return _mountain_svg(center_x, points), width * HILL_SCALE


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


def cluster_bounds(hexes):
    """Return (top, bottom, left, right) in one pass over hex vertices.

    SVG y increases downward, so top is minimum y and bottom is maximum y.
    Empty clusters and nonfinite coordinates raise ValueError.
    """
    top = left = math.inf
    bottom = right = -math.inf
    for vertices in hexes:
        for x, y in vertices:
            if not math.isfinite(x) or not math.isfinite(y):
                raise ValueError('Hex vertices must contain finite coordinates')
            top = min(top, y)
            bottom = max(bottom, y)
            left = min(left, x)
            right = max(right, x)
    if top == math.inf:
        raise ValueError('Hex cluster must contain at least one vertex')
    return top, bottom, left, right


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
    return [(left_coordinate, right_coordinate) for left_coordinate, right_coordinate in merged]


def segment_intersection(first_segments, second_segments):
    """Return sorted, merged intersections of two collections of intervals.

    Inputs are (left, right) pairs and are not modified. Endpoint-only
    intersections are excluded. Nonfinite or reversed edges raise ValueError.
    """
    def merge_segments(segments):
        intervals = []
        for left, right in segments:
            if not math.isfinite(left) or not math.isfinite(right):
                raise ValueError('Segment edges must be finite')
            if left > right:
                raise ValueError('Segment left edge must not exceed right edge')
            if left < right:
                intervals.append((left, right))
        merged = []
        for left, right in sorted(intervals):
            if merged and left <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], right))
            else:
                merged.append((left, right))
        return merged

    first = merge_segments(first_segments)
    second = merge_segments(second_segments)
    intersections = []
    first_index = second_index = 0
    while first_index < len(first) and second_index < len(second):
        first_left, first_right = first[first_index]
        second_left, second_right = second[second_index]
        left = max(first_left, second_left)
        right = min(first_right, second_right)
        if left < right:
            intersections.append((left, right))
        if first_right <= second_right:
            first_index += 1
        if second_right <= first_right:
            second_index += 1
    return intersections


def hex_terrain(hexes, terrain='trees'):
    render_symbol, row_height, first_row_height, center_y, x_margin, bottom_margin, terrrain_height, first_symbol_offset_max = {
        'trees': (tree, 25, 1, 30, 0, 0, 60, 0)
    }[terrain]
    min_y, max_y, min_x, max_x = cluster_bounds(hexes)
    svg = ['<g id="hex-cluster">']
  
    scale = (max(x for x, y in hexes[0])
            - min(x for x, y in hexes[0])) / 240
    
    y = min_y + first_row_height
    while y <= max_y - bottom_margin:
    #while y <= min_y + first_row_height + 1:

        min_segments = segment_intersection(horizontal_segments(hexes, y), horizontal_segments(hexes, y + terrrain_height))   
        for segment in min_segments:
            x=segment[0] + x_margin + random.randint(0, first_symbol_offset_max)
            while x <= segment[1] - x_margin:
                terrain_symbol, unscaled_terrain_width = render_symbol(0)
                terrain_width = unscaled_terrain_width * scale
                if terrain_width + x <= segment[1]:
                    baseline = y  + random.uniform(-row_height/4, row_height/4)
                    svg.append(
                        f'<g transform="translate({(x + terrain_width/2):.4f},{baseline:.4f}) scale({scale:g}) '
                        f'translate(0,-{center_y})">')

                    #svg.append(
                    #    f'<g transform="translate({(x):.4f},{baseline:.4f}) scale({scale:g}) '
                    #    f'translate(0,-{center_y})">')
                    
                    svg.append(f'{terrain_symbol}')
                    svg.append('</g>')                    
                x += terrain_width
            # debug outpt segment length
            #point_coordinates = ' '.join(f'{x:.4f},{y:.4f}' for x in segment)
            #svg.append(
            #    f'<g><polygon points="{point_coordinates}" fill="none" '
            #    'stroke="red" stroke-width="1"/></g>')

        y += row_height

    for vertices in hexes:
        x = sum(x for x, y in vertices) / len(vertices)
        y = sum(y for x, y in vertices) / len(vertices)

        point_coordinates = ' '.join(f'{x:.4f},{y:.4f}' for x, y in vertices)
        svg.append(
            f'<g><polygon points="{point_coordinates}" fill="none" '
            'stroke="#777777" stroke-width="1"/>')
        #terrain_symbol, center_y = render_symbol(0)
        #svg.append(
        #    f'<g transform="translate({x:.4f},{y:.4f}) scale({scale:g}) '
        #    f'translate(0,-{center_y})">')
        #svg.append(f'{terrain_symbol}')
        #svg.append('</g>')
        svg.append('</g>')
    svg.append('</g>')
    return '\n'.join(svg)


def _mountain_layout(hexes, terrain='mountains'):
    """Place staggered grids using cached rectangular placement envelopes."""
    if terrain not in ('mountains', 'hills'):
        raise ValueError(f'Unsupported mountain terrain: {terrain}')
    min_y, max_y, min_x, max_x = cluster_bounds(hexes)
    scale = (max(x for x, y in hexes[0])
            - min(x for x, y in hexes[0])) / 240
    if terrain == 'hills':
        scale *= HILL_SCALE
    make_points = _hill_points if terrain == 'hills' else _mountain_points
    heights = sorted({y for polygon in hexes for x, y in polygon})
    patterns = {}
    placements = []

    @lru_cache(maxsize=512)
    def available(top, local_scale):
        bottom = top + 90 * local_scale
        samples = [top, bottom]
        # Probe both sides of horizontal edges; other edges vary linearly.
        samples.extend(height + offset for height in heights
                       if top < height < bottom
                       for offset in (-1e-7 * scale, 1e-7 * scale))
        spans = [(min_x, max_x)]
        for height in samples:
            spans = segment_intersection(
                spans, horizontal_segments(hexes, height))
        return spans

    def covers(unit, x, y):
        return unit['top'] < y < unit['bottom'] and any(
            left < (x - unit['center_x']) / unit['scale'] < right
            for left, right in horizontal_segments(
                [unit['points']], 10 + (y - unit['top']) / unit['scale']))

    def add(center_x, top, width, original_scale, corner=None):
        points = make_points(width)
        for factor in (1, 0.75, 0.5):
            local_scale = original_scale * factor
            shifted_top = top + 45 * (original_scale - local_scale)
            half_width = width * local_scale / 2
            if local_scale < scale / 2:
                break
            for left, right in available(shifted_top, local_scale):
                if right - left < 2 * half_width:
                    continue
                x = min(max(center_x, left + half_width), right - half_width)
                unit = dict(center_x=x, top=shifted_top, width=width,
                            scale=local_scale, points=points,
                            bottom=shifted_top + 90 * local_scale)
                if abs(x - center_x) <= width * original_scale / 4 and (
                        corner is None or covers(unit, *corner)):
                    placements.append(unit)
                    return unit
        return None

    for band in range(math.ceil((max_y - min_y) / (45 * scale))):
        top = min_y + band * 45 * scale
        sample_y = min(top + 22.5 * scale, (top + max_y) / 2)
        for start, end in horizontal_segments(hexes, sample_y):
            maximum_width = 190 if (
                terrain == 'hills' or end - start < 500 * scale) else 300
            subrows = min(2, max(1, math.ceil(
                (2 * maximum_width - 100) * scale / (end - start))))
            local_scale = scale / subrows
            key = (maximum_width, subrows)
            if key not in patterns:
                columns = []
                left = min_x
                while left < max_x:
                    width = random.uniform(150, maximum_width)
                    columns.append((left + width * local_scale / 2, width))
                    left += (width - 100) * local_scale
                patterns[key] = columns
            for subrow in range(subrows):
                for column, (x, width) in enumerate(patterns[key]):
                    if (column % 2 == (band * subrows + subrow) % 2
                            and start <= x <= end):
                        add(x, top + subrow * 45 * local_scale,
                            width, local_scale)

    # Bounded passes repair grid transitions without chains of tiny foothills.
    for _ in range(3):
        for unit in placements[:]:
            bottom, local_scale = unit['bottom'], unit['scale']
            corners = [unit['center_x'] + side * unit['width'] * local_scale / 2
                       for side in (-1, 1)]
            if bottom + 45 * local_scale >= max_y or any(
                    covers(other, x, bottom)
                    for x in corners for other in placements):
                continue
            for x in corners:
                if add(x, bottom - 45 * local_scale, 180, local_scale,
                       (x, bottom)):
                    break
    return sorted(placements, key=lambda placement: placement['bottom'])


def hex_mountains(hexes, terrain='mountains'):
    """Render fitted mountains or rounded hills in increasing bottom-y order."""
    scale = (max(x for x, y in hexes[0])
             - min(x for x, y in hexes[0])) / 240
    svg = ['<g id="hex-cluster">']
    for placement in _mountain_layout(hexes, terrain):
        center_x = placement['center_x']
        local_scale = placement['scale']
        origin_y = placement['top'] + 10 * local_scale
        terrain_symbol = _mountain_svg(
            0, placement['points'], stroke_width=2 * scale / local_scale)
        svg.append(
            f'<g transform="translate({center_x:.8f},{origin_y:.8f}) '
            f'scale({local_scale:.10g}) translate(0,-20)">'
            f'{terrain_symbol}</g>')

    for vertices in hexes:
        point_coordinates = ' '.join(f'{x:.4f},{y:.4f}' for x, y in vertices)
        #svg.append(
        #    f'<g><polygon points="{point_coordinates}" fill="none" '
        #    'stroke="#777777" stroke-width="1"/></g>')
    svg.append('</g>')
    return '\n'.join(svg)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', default='trees.svg')
    parser.add_argument(
        '--terrain', choices=('trees', 'mountains', 'hills'),
        default='mountains',
        help='Terrain used to fill the hexes (default: mountains)')
    args = parser.parse_args()
    try:
        hexes = build_hex_cluster(CLUSTER_JSON)
    except ValueError as error:
        parser.error(f'Invalid embedded cluster JSON: {error}')
    min_y, max_y, min_x, max_x = cluster_bounds(hexes)
    width = max(450, max_x - min_x + 50)
    height = max(900, max_y - min_y + 420 + 20)
    left_margin = (width - (max_x - min_x)) / 2
    top_margin = 20
    hexes = [[(x - min_x + left_margin, y - min_y + top_margin) for x, y in hexagon]
               for hexagon in hexes]
    render_method = {
        'trees': hex_terrain,
        'mountains': hex_mountains,
        'hills': hex_mountains,
    }[args.terrain]

    svg_terrain = render_method(hexes, args.terrain)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" '
             f'width="{width:g}" height="{height:g}" '
             f'viewBox="0 0 {width:g} {height:g}">\n'
             + '\n' + svg_terrain
             + '\n</svg>\n')
    Path(args.output).write_text(svg, encoding='utf-8')
    print(f'Wrote {args.output}')


if __name__ == '__main__':
    main()
