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


class MountainTests(unittest.TestCase):
    def test_slopes_have_two_or_three_intermediate_points(self):
        for seed in range(100):
            with self.subTest(seed=seed), patch.object(
                    renderer, 'random', random.Random(seed)):
                group = et.fromstring(renderer.mountain(75))
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
            self.assertNotEqual(renderer.mountain(75), renderer.mountain(75))

    def test_main_keeps_trees_and_adds_three_mountains(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'landscape.svg'
            with patch('sys.argv', ['render_trees.py', str(output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                renderer.main()
            svg = et.parse(output).getroot()
        self.assertEqual(svg.get('viewBox'), '0 0 450 900')
        self.assertEqual(len(svg), 7)
        for group in list(svg)[:3]:
            self.assertEqual(group[0].get('fill'), '#936442')
            self.assertEqual(group[1].get('fill'), '#91b765')
        for group in list(svg)[3:6]:
            self.assertEqual(group[0].get('fill'), '#d3d3d3')
            self.assertEqual(group[1].get('stroke'), '#000000')
        forest = svg[-1]
        self.assertEqual(forest.get('id'), 'hex-cluster')
        self.assertEqual(len(forest), 45)
        for cell in forest:
            self.assertEqual(cell[0].tag, '{http://www.w3.org/2000/svg}polygon')
            points = [
                tuple(map(float, point.split(',')))
                for point in cell[0].get('points').split()
            ]
            self.assertEqual(len(points), 6)
            self.assertTrue(all(0 < x < 450 and 390 < y < 900
                                for x, y in points))
            x = sum(x for x, y in points) / 6
            y = sum(y for x, y in points) / 6
            self.assertEqual(
                cell[1].get('transform'),
                f'translate({x:.2f},{y:.2f}) scale(0.2) translate(0,-100)')
            tree = cell[1][0]
            self.assertEqual(len(tree), 2)
            self.assertEqual(tree[0].get('fill'), '#936442')
            self.assertEqual(tree[1].get('fill'), '#91b765')


class HexClusterTests(unittest.TestCase):
    def assert_segments_equal(self, actual_segments, expected_items):
        self.assertEqual(len(actual_segments), len(expected_items))
        for actual, expected in zip(actual_segments, expected_items):
            for point, expected_point in zip(actual, expected):
                self.assertAlmostEqual(point[0], expected_point[0])
                self.assertAlmostEqual(point[1], expected_point[1])

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
                [((-extent, y), (extent, y))])
        rotated = [[(y, x) for x, y in hexes[0]]]
        self.assertEqual(renderer.horizontal_segments(rotated, 2), [])

    def test_shared_edges_duplicates_and_input_order(self):
        height = math.sqrt(3) * 2
        hexes = [renderer.hex_vertices(0, 0, 2),
                   renderer.hex_vertices(3, height / 2, 2)]
        y = height / 4
        expected_items = [((-1.5, y), (4.5, y))]
        self.assert_segments_equal(renderer.horizontal_segments(hexes, y), expected_items)
        self.assert_segments_equal(
            renderer.horizontal_segments([hexes[1], *hexes], y), expected_items)
        stack = [hexes[0], renderer.hex_vertices(0, height, 2)]
        self.assert_segments_equal(
            renderer.horizontal_segments(stack, height / 2),
            [((-1, height / 2), (1, height / 2))])

    def test_arbitrary_contiguous_ring_preserves_hole(self):
        height = math.sqrt(3) * 2
        hexes = [renderer.hex_vertices(x, y, 2) for x, y in (
            (0, -height), (3, -height / 2), (3, height / 2),
            (0, height), (-3, height / 2), (-3, -height / 2))]
        self.assert_segments_equal(
            renderer.horizontal_segments(hexes, 0),
            [((-4, 0), (-2, 0)), ((2, 0), (4, 0))])

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

    def test_embedded_json_renders_every_cell_and_expands_canvas(self):
        data = {'hexes': [[q, 0] for q in range(7)]
                + [[0, r] for r in range(1, 7)],
                'radius': 60, 'origin': [-1000, -1000]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'forest.svg'
            with patch.object(renderer, 'CLUSTER_JSON', json.dumps(data)), \
                    patch('sys.argv', ['render_trees.py', str(output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                renderer.main()
            svg = et.parse(output).getroot()
        width, height = float(svg.get('width')), float(svg.get('height'))
        self.assertGreater(width, 450)
        self.assertGreater(height, 900)
        self.assertEqual(len(svg[-1]), len(data['hexes']))
        for cell in svg[-1]:
            self.assertIn('scale(0.5)', cell[1].get('transform'))
            for point in cell[0].get('points').split():
                x, y = map(float, point.split(','))
                self.assertTrue(0 < x < width and 390 < y < height)

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

    def test_embedded_default_matches_v_shape(self):
        embedded_hexes = renderer.build_hex_cluster(renderer.CLUSTER_JSON)
        v = renderer.v_hex_cluster()
        for embedded, hexagon in zip(embedded_hexes, v):
            for (x1, y1), (x2, y2) in zip(embedded, hexagon):
                self.assertAlmostEqual(x1 + 81, x2)
                self.assertAlmostEqual(y1 + 420 + math.sqrt(3) * 24 / 2, y2)
        self.assertEqual(len(embedded_hexes), len(v))


if __name__ == '__main__':
    unittest.main()
