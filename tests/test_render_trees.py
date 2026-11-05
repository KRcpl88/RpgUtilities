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
    def test_slopes_have_two_or_three_intermediate_points(self):
        for seed in range(100):
            with self.subTest(seed=seed), patch.object(
                    renderer, 'random', random.Random(seed)):
                symbol, width = renderer.mountain(75)
                group = et.fromstring(symbol)
                self.assertGreater(width, 0)
                self.assertTrue(math.isfinite(width))
                fill, outline = group
                self.assertEqual(group.get('transform'), 'translate(75,0)')
                self.assertEqual(fill.get('d'), outline.get('d') + ' Z')
                self.assertEqual(fill.get('fill'), '#d3d3d3')
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
                self.assertEqual(directions, [-1, 1, -1, 1])
                self.assertTrue(all(count in (3, 4) for count in counts))

    def test_mountains_vary(self):
        with patch.object(renderer, 'random', random.Random(0)):
            first_symbol, _ = renderer.mountain(75)
            second_symbol, _ = renderer.mountain(75)
            self.assertNotEqual(first_symbol, second_symbol)

    def test_terrain_option_selects_symbols_for_cluster(self):
        for terrain, center_y, fill in (
                ('trees', 150, '#936442'),
                ('mountains', 305, '#d3d3d3')):
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
