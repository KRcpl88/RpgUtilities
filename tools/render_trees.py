#!/usr/bin/env python3
"""Render random trees, mountains, and a hex terrain cluster."""

import argparse
import json
import math
from pathlib import Path
import random


TREE_MIN_LOBES = 4
TREE_MAX_LOBES = 7


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

#returns svg, terrain_width
def _mountain_points(width):
    """Build the shared silhouette used for rendering and corner coverage."""
    xscale = 1
    yscale = 1
    num_peaks = 1 if (width < (200 * xscale)) else 2  
    if num_peaks > 1:
        # 2 peaks
        base_y = 100
        anchors = [
            (-width * 0.50, base_y),
            (-width * 0.34 + random.uniform(-8 * xscale, 8 * xscale), base_y - random.uniform(20 * yscale, 30 * yscale)),        
            (-width * 0.15 + random.uniform(-6* xscale, 6* xscale), base_y - random.uniform(80 * yscale, 90 * yscale)),
            (random.uniform(-6* xscale, 6* xscale), base_y - random.uniform(40 * yscale, 60 * yscale)),
            (width * 0.15 + random.uniform(-6* xscale, 6* xscale), base_y - random.uniform(80 * yscale, 90 * yscale)),
            (width * 0.34 + random.uniform(-8 * xscale, 8 * xscale), base_y - random.uniform(20 * yscale, 30 * yscale)), 
            (width * 0.50, base_y),
        ]
    else:
        # 1 peak
        base_y = 100
        anchors = [
            (-width * 0.50, base_y),
            (-width * 0.25 + random.uniform(-10 * xscale, 10 * xscale), base_y - random.uniform(30 * yscale, 40 * yscale)),        
            (random.uniform(-10* xscale, 10* xscale), base_y - random.uniform(80 * yscale, 90 * yscale)),
            (width * 0.25 + random.uniform(-10 * xscale, 10 * xscale), base_y - random.uniform(30 * yscale, 40 * yscale)), 
            (width * 0.50, base_y),
        ]
        #anchors = [
        #    (-width / 2, base_y),
        #    (random.uniform(-6* xscale, 6* xscale), base_y - random.uniform(35 * yscale, 50 * yscale)),
        #    (width / 2, base_y),
        #]

    points = [anchors[0]]
    for (start_x, start_y), (end_x, end_y) in zip(anchors, anchors[1:]):
        point_count = random.randint(1, 2)
        for n in range(1, point_count + 1):
            tx = (n + random.uniform(-0.25, 0.25)) / (point_count + 1)
            ty = (n + random.uniform(-0.25, 0.25)) / (point_count + 1)
            points.append((start_x + (end_x - start_x) * tx,
                             start_y + (end_y - start_y) * ty))
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


def _fit_mountain(placement, hexes, minimum_scale, corner=None):
    """Fit the full silhouette inside the terrain region, or omit the unit."""
    points = placement['points']
    original_scale = placement['scale']
    center_x = placement['center_x']
    shift_limit = 90 * original_scale / 4
    horizontal_limit = placement['width'] * original_scale / 4
    vertex_heights = {y for vertices in hexes for x, y in vertices}
    peak_y = min(y for x, y in points)

    def intersect(first, second):
        return [
            (max(left, start), min(right, end))
            for left, right in first for start, end in second
            if max(left, start) <= min(right, end)
        ]

    for factor in (1, 0.85, 0.7, 0.55, 0.4):
        local_scale = original_scale * factor
        if local_scale < minimum_scale:
            break
        top = placement['top'] + 45 * (original_scale - local_scale)
        peak = top + (peak_y - 10) * local_scale
        bottom = top + 90 * local_scale
        shifts = {0, -shift_limit, shift_limit}
        shifts.update(
            height - edge for height in vertex_heights
            for edge in (peak, bottom)
            if abs(height - edge) <= shift_limit
        )
        for shift in sorted(shifts, key=lambda value: (abs(value), value)):
            shifted_top = top + shift
            shifted_bottom = bottom + shift
            if corner is not None and shifted_bottom <= corner[1]:
                continue
            heights = {shifted_top + (y - 10) * local_scale for x, y in points}
            heights.update(
                height for height in vertex_heights
                if peak + shift < height < shifted_bottom
            )
            heights = sorted(heights)
            # Horizontal hex edges can change the available span abruptly.
            samples = heights + [
                height
                for start, end in zip(heights, heights[1:])
                for height in (
                    math.nextafter(start, end),
                    (start + end) / 2,
                    math.nextafter(end, start),
                )
            ]
            centers = [(center_x - horizontal_limit,
                        center_x + horizontal_limit)]
            for height in samples:
                local_y = 10 + (height - shifted_top) / local_scale
                silhouette = horizontal_segments([points], local_y)
                silhouette.extend(
                    (x, x) for x, y in points
                    if math.isclose(y, local_y, rel_tol=0, abs_tol=1e-8)
                )
                spans = horizontal_segments(hexes, height)
                for left, right in silhouette:
                    centers = intersect(centers, [
                        (start - left * local_scale,
                         end - right * local_scale)
                        for start, end in spans
                        if end - start >= (right - left) * local_scale
                    ])
                    if not centers:
                        break
                if not centers:
                    break
            if corner is not None and centers:
                local_y = 10 + (corner[1] - shifted_top) / local_scale
                margin = minimum_scale
                centers = intersect(centers, [
                    (corner[0] - right * local_scale + margin,
                     corner[0] - left * local_scale - margin)
                    for left, right in horizontal_segments([points], local_y)
                    if (right - left) * local_scale > 2 * margin
                ])
            if centers:
                fitted_x = min(
                    (min(max(center_x, left), right) for left, right in centers),
                    key=lambda value: abs(value - center_x))
                return {
                    **placement,
                    'center_x': fitted_x,
                    'top': shifted_top,
                    'scale': local_scale,
                    'bottom': shifted_bottom,
                }
    return None


def _mountain_layout(hexes):
    """Lay out local staggered grids, repairing exposed corners at transitions."""
    min_y, max_y, _, _ = cluster_bounds(hexes)
    scale = (max(x for x, y in hexes[0])
            - min(x for x, y in hexes[0])) / 240
    overlap = 100
    stagger = 45
    placements = []
    previous_patterns = []

    def add_mountain(center_x, top, width, local_scale, corner=None):
        points = _mountain_points(width)
        placement = _fit_mountain({
            'center_x': center_x,
            'top': top,
            'width': width,
            'scale': local_scale,
            'bottom': top + 90 * local_scale,
            'points': points,
        }, hexes, scale / 8, corner)
        if placement is not None:
            placements.append(placement)
        return placement

    band_index = 0
    while min_y + band_index * stagger * scale < max_y:
        top = min_y + band_index * stagger * scale
        sample_y = min(top + stagger * scale / 2, (top + max_y) / 2)
        patterns = []
        for start, end in horizontal_segments(hexes, sample_y):
            span_width = end - start
            single_peaks = span_width < 500 * scale
            maximum_width = 190 if single_peaks else 300
            pair_width = 2 * maximum_width - overlap
            subrows = max(1, math.ceil(pair_width * scale / span_width))
            local_scale = scale / subrows
            matching = [
                pattern for left, right, pattern in previous_patterns
                if left < end and start < right
            ]
            columns = []
            if len(matching) == 1:
                previous = matching[0]
                fitting = [
                    column for column in previous['columns']
                    if start <= column[1]
                    and column[1] + column[2] * previous['scale'] <= end
                ]
                if len(fitting) >= 2 and previous['scale'] in (
                        scale, local_scale):
                    columns = fitting
                    local_scale = previous['scale']
                    subrows = round(scale / local_scale)
                    single_peaks = previous['single_peaks'] and single_peaks
                    maximum_width = 190 if single_peaks else 300
            if len(columns) < 2:
                columns = []
                column_index = 0
                left = start
            else:
                column_index, left, width = columns[-1]
                left += (width - overlap) * local_scale
                column_index += 1
                first_index, first_left, _ = columns[0]
                while True:
                    width = random.uniform(150, maximum_width)
                    new_left = first_left - (width - overlap) * local_scale
                    if new_left < start:
                        break
                    first_index -= 1
                    columns.insert(0, (first_index, new_left, width))
                    first_left = new_left
            while left + 150 * local_scale <= end:
                width = random.uniform(150, maximum_width)
                width = min(width, (end - left) / local_scale)
                columns.append((column_index, left, width))
                left += (width - overlap) * local_scale
                column_index += 1
            pattern = {
                'scale': local_scale,
                'single_peaks': single_peaks,
                'columns': columns,
            }
            patterns.append((start, end, pattern))
            for subrow in range(subrows):
                row_index = band_index * subrows + subrow
                row_top = top + subrow * stagger * local_scale
                for column_index, left, width in columns:
                    if column_index % 2 == row_index % 2:
                        add_mountain(
                            left + width * local_scale / 2,
                            row_top, width, local_scale)
        previous_patterns = patterns
        band_index += 1

    def covers(placement, corner_x, corner_y):
        if not placement['top'] < corner_y < placement['bottom']:
            return False
        local_x = (corner_x - placement['center_x']) / placement['scale']
        local_y = 10 + (corner_y - placement['top']) / placement['scale']
        return any(left < local_x < right for left, right in
                   horizontal_segments([placement['points']], local_y))

    # A changed grid can expose an old corner. Bridge it with a single peak,
    # and process that peak too, rather than leaving an isolated terrain unit.
    pending = sorted(placements, key=lambda placement: placement['bottom'])
    while pending:
        placement = pending.pop(0)
        bottom = placement['bottom']
        half_width = placement['width'] * placement['scale'] / 2
        corners = [
            placement['center_x'] - half_width,
            placement['center_x'] + half_width,
        ]
        visible_segments = horizontal_segments(hexes, bottom)
        corners = [
            corner for corner in corners
            if any(left < corner < right for left, right in visible_segments)
        ]
        if not corners or any(
                covers(other, corner, bottom)
                for corner in corners for other in placements
                if other['bottom'] > bottom):
            continue
        local_scale = placement['scale']
        if bottom + stagger * local_scale >= max_y:
            continue
        width = random.uniform(150, 190)
        for _ in range(8):
            below = horizontal_segments(
                hexes, bottom + stagger * local_scale / 2)
            half_width = width * local_scale / 2
            corner = next((
                corner for corner in corners
                if any(left < corner + half_width
                       and corner - half_width < right for left, right in below)
            ), None)
            if corner is not None:
                bridge = add_mountain(
                    corner, bottom - stagger * local_scale, width, local_scale,
                    (corner, bottom))
                if bridge is not None:
                    pending.append(bridge)
                    pending.sort(key=lambda item: item['bottom'])
                    break
            local_scale /= 2
    return sorted(placements, key=lambda placement: placement['bottom'])


def hex_mountains(hexes, terrain='mountains'):
    """Render fitted mountain silhouettes in increasing bottom-y order."""
    if terrain != 'mountains':
        raise ValueError(f'Unsupported mountain terrain: {terrain}')
    scale = (max(x for x, y in hexes[0])
             - min(x for x, y in hexes[0])) / 240
    svg = ['<g id="hex-cluster">']
    for placement in _mountain_layout(hexes):
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
        x = sum(x for x, y in vertices) / len(vertices)
        y = sum(y for x, y in vertices) / len(vertices)

        point_coordinates = ' '.join(f'{x:.4f},{y:.4f}' for x, y in vertices)
        svg.append(
            f'<g><polygon points="{point_coordinates}" fill="none" '
            'stroke="#777777" stroke-width="1"/>')
        svg.append('</g>')

    svg.append('</g>')
    return '\n'.join(svg)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', default='trees.svg')
    parser.add_argument(
        '--terrain', choices=('trees', 'mountains'), default='mountains',
        help='Terrain used to fill the hexes (default: trees)')
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
        'mountains': hex_mountains
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
