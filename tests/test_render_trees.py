import contextlib
import importlib.util
import io
import json
import math
from pathlib import Path
import random
import re
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as et


spec = importlib.util.spec_from_file_location(
    'render_trees', Path(__file__).resolve().parents[1] / 'tools/render_trees.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class TreeTests(unittest.TestCase):
    def test_tree_returns_svg_and_measurements(self):
        symbol, width = renderer.tree(75)
        group = et.fromstring(symbol)
        self.assertEqual(group.get('transform'), 'translate(75,0)')
        trunk, crown = group
        self.assertEqual(trunk.get('fill'), '#936442')
        self.assertEqual(crown.get('fill'), '#91b765')
        self.assertGreater(width, 0)
        self.assertTrue(math.isfinite(width))


class MountainTests(unittest.TestCase):
    def test_single_and_double_peak_profiles(self):
        for seed in range(100):
            requested_width = 180 if seed % 2 else 250
            with self.subTest(seed=seed), patch.object(
                    renderer, 'random', random.Random(seed)):
                symbol, width = renderer.mountain(75, requested_width)
                group = et.fromstring(symbol)
                self.assertGreater(width, 0)
                self.assertTrue(math.isfinite(width))
                fill, outline = group
                self.assertEqual(group.get('transform'), 'translate(75,0)')
                self.assertEqual(fill.get('d'), outline.get('d') + ' Z')
                self.assertEqual(fill.get('fill'), 'white')
                self.assertEqual(fill.get('stroke'), 'none')
                self.assertEqual(outline.get('fill'), 'none')
                self.assertEqual(outline.get('stroke'), '#000000')
                self.assertNotIn('Z', outline.get('d'))

                points = [
                    tuple(map(float, match))
                    for match in re.findall(
                        r'(-?\d+\.\d+),(-?\d+\.\d+)', outline.get('d'))
                ]
                self.assertEqual(points[0][1], points[-1][1])
                directions = []
                counts = []
                for (x1, y1), (x2, y2) in zip(points, points[1:]):
                    self.assertGreater(x2, x1)
                    self.assertNotEqual(y1, y2)
                    direction = 1 if y2 > y1 else -1
                    if not directions or direction != directions[-1]:
                        directions.append(direction)
                        counts.append(0)
                    counts[-1] += 1
                if requested_width < 200:
                    self.assertEqual(directions, [-1, 1])
                    self.assertTrue(all(4 <= count <= 6 for count in counts))
                else:
                    self.assertEqual(directions, [-1, 1, -1, 1])
                    for count, limits in zip(
                            counts, ((4, 6), (2, 3), (2, 3), (4, 6))):
                        self.assertTrue(limits[0] <= count <= limits[1])

    def test_mountains_vary(self):
        with patch.object(renderer, 'random', random.Random(0)):
            first_symbol, _ = renderer.mountain(75, 250)
            second_symbol, _ = renderer.mountain(75, 250)
            self.assertNotEqual(first_symbol, second_symbol)

    def test_terrain_option_selects_symbols_for_cluster(self):
        for terrain, center_y, fill in (
                ('trees', 30, '#936442'),
                ('mountains', 20, 'white')):
            with self.subTest(terrain=terrain), \
                    tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'terrain.svg'
                with patch('sys.argv', [
                        'render_trees.py', '--terrain', terrain, str(output)]), \
                        contextlib.redirect_stdout(io.StringIO()):
                    renderer.main()
                svg = et.parse(output).getroot()
                self.assertEqual(len(svg), 1)
                self.assertEqual(svg[0].get('id'), 'hex-cluster')
                cells = [
                    group for group in svg[0]
                    if group.find(
                        '{http://www.w3.org/2000/svg}polygon') is not None
                ]
                symbols = [
                    group for group in svg[0]
                    if group.get('transform') is not None
                ]
                self.assertEqual(
                    len(cells), len(json.loads(renderer.CLUSTER_JSON)['hexes']))
                self.assertTrue(symbols)
                for group in symbols:
                    self.assertTrue(group.get('transform').endswith(
                        f'translate(0,-{center_y})'))
                    symbol = group[0]
                    self.assertEqual(symbol[0].get('fill'), fill)
                    if terrain == 'mountains':
                        self.assertEqual(symbol[1].get('fill'), 'none')
                        self.assertEqual(symbol[1].get('stroke'), '#000000')

    def test_unknown_terrain_reports_error_without_writing_svg(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'terrain.svg'
            error_output = io.StringIO()
            with patch('sys.argv', [
                    'render_trees.py', str(output), '--terrain', 'desert']), \
                    contextlib.redirect_stderr(error_output), \
                    self.assertRaises(SystemExit) as error:
                renderer.main()
            self.assertEqual(error.exception.code, 2)
            self.assertIn('invalid choice', error_output.getvalue())
            self.assertFalse(output.exists())


class MountainPlacementTests(unittest.TestCase):
    @staticmethod
    def placement(center_x, top, scale=1):
        return {
            'center_x': center_x,
            'top': top,
            'width': 160,
            'scale': scale,
            'bottom': top + 90 * scale,
            'points': [(-80, 100), (0, 10), (80, 100)],
        }

    @staticmethod
    def point_inside(point, polygon):
        sides = [
            (end_x - start_x) * (point[1] - start_y)
            - (end_y - start_y) * (point[0] - start_x)
            for (start_x, start_y), (end_x, end_y)
            in zip(polygon, polygon[1:] + polygon[:1])
        ]
        return all(side >= -1e-7 for side in sides) or all(
            side <= 1e-7 for side in sides)

    def assert_units_inside(self, units, hexes):
        for unit in units:
            points = [
                (unit['center_x'] + x * unit['scale'],
                 unit['top'] + (y - 10) * unit['scale'])
                for x, y in unit['points']
            ]
            for (start_x, start_y), (end_x, end_y) in zip(
                    points, points[1:] + points[:1]):
                for step in range(6):
                    fraction = step / 5
                    point = (start_x + (end_x - start_x) * fraction,
                             start_y + (end_y - start_y) * fraction)
                    self.assertTrue(
                        any(self.point_inside(point, hexagon)
                            for hexagon in hexes),
                        f'Mountain outline outside terrain at {point}')
            for step in range(1, 10):
                local_y = 10 + step * 9
                for left, right in renderer.horizontal_segments(
                        [unit['points']], local_y):
                    for fraction in (0.25, 0.5, 0.75):
                        point = (
                            unit['center_x']
                            + (left + (right - left) * fraction) * unit['scale'],
                            unit['top'] + (local_y - 10) * unit['scale'])
                        self.assertTrue(
                            any(self.point_inside(point, hexagon)
                                for hexagon in hexes),
                            f'Mountain fill outside terrain at {point}')

    def test_interior_unit_keeps_its_position_and_scale(self):
        hexes = [[(0, 0), (240, 0), (240, 200), (0, 200)]]
        original = self.placement(120, 40)
        fitted = renderer._fit_mountain(original, hexes, 0.125)
        self.assertEqual(fitted, original)

    def test_bottom_unit_is_moved_and_shrunk_to_fit(self):
        hexes = [[(0, 0), (240, 0), (240, 200), (0, 200)]]
        fitted = renderer._fit_mountain(
            self.placement(120, 140), hexes, 0.125, corner=(120, 180))
        self.assertIsNotNone(fitted)
        self.assertLess(fitted['scale'], 1)
        self.assertLessEqual(fitted['bottom'], 200)
        self.assertGreater(fitted['bottom'], 180)
        local_x = (120 - fitted['center_x']) / fitted['scale']
        local_y = 10 + (180 - fitted['top']) / fitted['scale']
        self.assertTrue(any(
            left < local_x < right for left, right
            in renderer.horizontal_segments([fitted['points']], local_y)))
        self.assert_units_inside([fitted], hexes)

    def test_units_that_cannot_fit_are_omitted(self):
        hexes = [[(0, 0), (240, 0), (240, 200), (0, 200)]]
        for original in (self.placement(1000, 40), self.placement(120, 300)):
            with self.subTest(original=original):
                self.assertIsNone(
                    renderer._fit_mountain(original, hexes, 0.125))
        ring = renderer.build_hex_cluster({
            'hexes': [[1, 0], [1, -1], [0, -1],
                      [-1, 0], [-1, 1], [0, 1]],
            'radius': 48,
        })
        self.assertIsNone(renderer._fit_mountain(
            self.placement(0, -18, 0.4), ring, 0.05))

    def test_fitting_checks_both_sides_of_horizontal_region_edges(self):
        hexes = [
            [(0, 0), (100, 0), (100, 100), (0, 100)],
            [(100, 40), (200, 40), (200, 100), (100, 100)],
        ]
        original = self.placement(80, 0)
        fitted = renderer._fit_mountain(original, hexes, 0.125)
        self.assertIsNotNone(fitted)
        self.assertNotEqual(fitted, original)
        self.assert_units_inside([fitted], hexes)

    def test_cluster_boundaries_bottom_edges_and_holes_are_respected(self):
        ring = {'hexes': [[1, 0], [1, -1], [0, -1],
                          [-1, 0], [-1, 1], [0, 1]], 'radius': 48}
        for data in ({'hexes': [[0, 0]], 'radius': 48},
                     json.loads(renderer.CLUSTER_JSON), ring):
            hexes = renderer.build_hex_cluster(data)
            with self.subTest(data=data), patch.object(
                    renderer, 'random', random.Random(7)):
                units = renderer._mountain_layout(hexes)
                self.assertTrue(units)
                self.assert_units_inside(units, hexes)

    def test_no_clipping_and_uniform_strokes_in_bottom_y_order(self):
        hexes = renderer.build_hex_cluster(renderer.CLUSTER_JSON)
        with patch.object(renderer, 'random', random.Random(7)):
            group = et.fromstring(renderer.hex_mountains(hexes))
        for element in group.iter():
            self.assertNotEqual(element.tag, 'clipPath')
            self.assertIsNone(element.get('clip-path'))
        bottoms = []
        scales = set()
        for unit in group:
            if unit.get('transform') is None:
                continue
            center_x, origin_y, scale, offset_x, offset_y = map(
                float, re.findall(r'-?\d+(?:\.\d+)?', unit.get('transform')))
            bottoms.append(origin_y + (100 + offset_y) * scale)
            scales.add(scale)
            outline = unit[0][1]
            self.assertAlmostEqual(
                float(outline.get('stroke-width')) * scale, 0.8)
        self.assertGreater(len(scales), 1)
        for first, second in zip(bottoms, bottoms[1:]):
            self.assertLessEqual(first, second + 1e-7)


class SegmentIntersectionTests(unittest.TestCase):
    def test_example_and_swapped_inputs(self):
        first = [(0, 2), (4, 8)]
        second = [(1, 5), (6, 9)]
        expected = [(1, 2), (4, 5), (6, 8)]
        self.assertEqual(renderer.segment_intersection(first, second), expected)
        self.assertEqual(renderer.segment_intersection(second, first), expected)

    def test_unsorted_overlapping_inputs_are_merged_without_mutation(self):
        first = [(4, 8), (0, 3), (2, 6), (0, 3)]
        second = [(7, 9), (1, 5), (5, 7)]
        original_first = first.copy()
        original_second = second.copy()
        self.assertEqual(
            renderer.segment_intersection(first, second), [(1, 8)])
        self.assertEqual(first, original_first)
        self.assertEqual(second, original_second)

    def test_empty_disjoint_and_endpoint_only_intersections(self):
        for first, second in (
                ([], [(0, 2)]),
                ([(0, 2)], []),
                ([(0, 2)], [(3, 4)]),
                ([(0, 2)], [(2, 4)]),
                ([(1, 1)], [(0, 2)])):
            with self.subTest(first=first, second=second):
                self.assertEqual(
                    renderer.segment_intersection(first, second), [])

    def test_contained_negative_and_fractional_intervals(self):
        self.assertEqual(
            renderer.segment_intersection(
                [(-5, 5)], [(-4.5, -2), (0.5, 2.5)]),
            [(-4.5, -2), (0.5, 2.5)])

    def test_reversed_and_nonfinite_edges_are_rejected(self):
        invalid = [(2, 1)]
        for value in (math.nan, math.inf, -math.inf):
            invalid.extend(((value, 2), (0, value)))
        for segment in invalid:
            for first, second in (([segment], []), ([], [segment])):
                with self.subTest(first=first, second=second), \
                        self.assertRaises(ValueError):
                    renderer.segment_intersection(first, second)


class HexClusterTests(unittest.TestCase):
    def assert_segments_equal(self, actual_segments, expected_items):
        self.assertEqual(len(actual_segments), len(expected_items))
        for actual, expected in zip(actual_segments, expected_items):
            self.assertEqual(len(actual), 2)
            self.assertAlmostEqual(actual[0], expected[0])
            self.assertAlmostEqual(actual[1], expected[1])

    def test_cluster_bounds_single_hex(self):
        bounds = renderer.cluster_bounds([renderer.hex_vertices(0, 0, 2)])
        expected = (-math.sqrt(3), math.sqrt(3), -2, 2)
        for actual, limit in zip(bounds, expected):
            self.assertAlmostEqual(actual, limit)

    def test_cluster_bounds_single_pass_over_translated_hexes(self):
        hexes = (iter(vertices) for vertices in (
            renderer.hex_vertices(-8, 3, 2),
            renderer.hex_vertices(5, -7, 4),
        ))
        bounds = renderer.cluster_bounds(hexes)
        expected = (-7 - 2 * math.sqrt(3), 3 + math.sqrt(3), -10, 9)
        for actual, limit in zip(bounds, expected):
            self.assertAlmostEqual(actual, limit)

    def test_cluster_bounds_rejects_empty_or_nonfinite_vertices(self):
        invalid = [[], [[]]]
        for value in (math.nan, math.inf, -math.inf):
            invalid.extend(([[(value, 0)]], [[(0, value)]]))
        for hexes in invalid:
            with self.subTest(hexes=hexes), self.assertRaises(ValueError):
                renderer.cluster_bounds(hexes)

    def test_v_has_nine_columns_of_five_and_is_contiguous(self):
        hexes = renderer.v_hex_cluster()
        self.assertEqual(len(hexes), 45)
        centers = [
            (sum(x for x, y in hexagon) / 6, sum(y for x, y in hexagon) / 6)
            for hexagon in hexes
        ]
        columns = sorted(set(x for x, y in centers))
        self.assertEqual(len(columns), 9)
        tops = []
        for column_x in columns:
            ys = sorted(y for x, y in centers if x == column_x)
            self.assertEqual(len(ys), 5)
            for y1, y2 in zip(ys, ys[1:]):
                self.assertAlmostEqual(y2 - y1, math.sqrt(3) * 24)
            tops.append(ys[0])
        self.assertTrue(all(y1 < y2 for y1, y2 in zip(tops[:4], tops[1:5])))
        self.assertTrue(all(y1 > y2 for y1, y2 in zip(tops[4:], tops[5:])))
        # Edge-sharing neighbors must reach every hex, not just touch at corners.
        reached = {0}
        pending = [0]
        while pending:
            current = pending.pop()
            x1, y1 = centers[current]
            for other, (x2, y2) in enumerate(centers):
                if other not in reached and math.isclose(
                        math.hypot(x2 - x1, y2 - y1), math.sqrt(3) * 24):
                    reached.add(other)
                    pending.append(other)
        self.assertEqual(len(reached), 45)

    def test_v_scanlines_preserve_upper_gap_and_merge_lower_arm(self):
        hexes = renderer.v_hex_cluster()
        self.assertEqual(len(renderer.horizontal_segments(hexes, 430)), 2)
        self.assertEqual(len(renderer.horizontal_segments(hexes, 750)), 1)
        self.assertEqual(renderer.horizontal_segments(hexes, 419), [])
        self.assertEqual(renderer.horizontal_segments(hexes, 900), [])

    def test_single_hex_center_slopes_edges_and_vertex_touches(self):
        hexes = [renderer.hex_vertices(0, 0, 2)]
        half_height = math.sqrt(3)
        for y, extent in ((0, 2), (half_height / 2, 1.5),
                            (half_height, 1), (-half_height, 1)):
            self.assert_segments_equal(
                renderer.horizontal_segments(hexes, y),
                [(-extent, extent)])
        rotated = [[(y, x) for x, y in hexes[0]]]
        self.assertEqual(renderer.horizontal_segments(rotated, 2), [])

    def test_shared_edges_duplicates_and_input_order(self):
        height = math.sqrt(3) * 2
        hexes = [renderer.hex_vertices(0, 0, 2),
                   renderer.hex_vertices(3, height / 2, 2)]
        y = height / 4
        expected_items = [(-1.5, 4.5)]
        self.assert_segments_equal(renderer.horizontal_segments(hexes, y), expected_items)
        self.assert_segments_equal(
            renderer.horizontal_segments([hexes[1], *hexes], y), expected_items)
        stack = [hexes[0], renderer.hex_vertices(0, height, 2)]
        self.assert_segments_equal(
            renderer.horizontal_segments(stack, height / 2),
            [(-1, 1)])

    def test_arbitrary_contiguous_ring_preserves_hole(self):
        height = math.sqrt(3) * 2
        hexes = [renderer.hex_vertices(x, y, 2) for x, y in (
            (0, -height), (3, -height / 2), (3, height / 2),
            (0, height), (-3, height / 2), (-3, -height / 2))]
        self.assert_segments_equal(
            renderer.horizontal_segments(hexes, 0),
            [(-4, -2), (2, 4)])

    def test_empty_cluster_and_invalid_inputs(self):
        self.assertEqual(renderer.horizontal_segments([], 0), [])
        for value in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValueError):
                renderer.horizontal_segments([], value)
        for radius in (0, -1, math.nan, math.inf):
            with self.assertRaises(ValueError):
                renderer.hex_vertices(0, 0, radius)


class ClusterInputTests(unittest.TestCase):
    def test_python_and_json_inputs_match_and_preserve_input(self):
        data = {'hexes': [[0, 0], [1, 0], [1, -1]],
                'radius': 12, 'origin': [-30, 50]}
        cluster_json = json.dumps(data)
        hexes = renderer.build_hex_cluster(data)
        self.assertEqual(hexes, renderer.build_hex_cluster(cluster_json))
        self.assertEqual(json.dumps(data), cluster_json)
        for hexagon, (q, r) in zip(hexes, data['hexes']):
            self.assertEqual(hexagon, renderer.hex_vertices(
                -30 + 18 * q, 50 + math.sqrt(3) * 12 * (r + q / 2), 12))

    def test_defaults_tuples_and_single_hex(self):
        self.assertEqual(renderer.build_hex_cluster({'hexes': ((0, 0),)}),
                         [renderer.hex_vertices(0, 0, 24)])

    def test_ring_and_every_neighbor_direction_are_accepted(self):
        ring = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
        self.assertEqual(len(renderer.build_hex_cluster({'hexes': ring})), 6)
        for neighbor in ring:
            with self.subTest(neighbor=neighbor):
                self.assertEqual(len(renderer.build_hex_cluster(
                    {'hexes': [neighbor, (0, 0)]})), 2)

    def test_default_v_geometry_is_preserved(self):
        expected_items = []
        for column in range(9):
            start_row = column if column < 4 else 12 - 2 * column
            for row in range(start_row, start_row + 5):
                expected_items.append(renderer.hex_vertices(
                    81 + 36 * column,
                    420 + math.sqrt(3) * 24 / 2
                    + math.sqrt(3) * 24 * (row + column / 2), 24))
        self.assertEqual(renderer.v_hex_cluster(), expected_items)

    def test_invalid_cluster_data_is_rejected(self):
        invalid = [
            None, [], 'not json', '[]', {}, {'hexes': []},
            {'hexes': [[0, 0]], 'typo': 1},
            {'hexes': [[0, 0], [0, 0]]},
            {'hexes': [[0, 0], [2, 0]]},
            {'hexes': [[0, 0], [1, 1]]},
            {'hexes': [[0, 0, 0]]}, {'hexes': [[0.0, 0]]},
            {'hexes': [[True, 0]]}, {'hexes': ['0,0']},
        ]
        invalid.extend({'hexes': [[0, 0]], 'radius': value} for value in (
            0, -1, True, '24', None, math.inf, math.nan))
        invalid.extend({'hexes': [[0, 0]], 'origin': value} for value in (
            [], [1], [0, 0, 0], [True, 0], [0, math.inf], [math.nan, 0],
            ['0', 0], None))
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValueError):
                renderer.build_hex_cluster(data)

    def test_bad_embedded_json_reports_error_without_writing_svg(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'forest.svg'
            for cluster_json in ('not json', '{"hexes": [[0, 0], [2, 0]]}'):
                error_output = io.StringIO()
                with self.subTest(json=cluster_json), \
                        patch.object(renderer, 'CLUSTER_JSON', cluster_json), \
                        patch('sys.argv', ['render_trees.py', str(output)]), \
                        contextlib.redirect_stderr(error_output), \
                        self.assertRaises(SystemExit) as error:
                    renderer.main()
                self.assertEqual(error.exception.code, 2)
                self.assertIn('Invalid embedded cluster JSON', error_output.getvalue())
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
