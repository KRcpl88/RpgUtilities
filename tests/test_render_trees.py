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
import xml.etree.ElementTree as ET


Spec = importlib.util.spec_from_file_location(
    'render_trees', Path(__file__).resolve().parents[1] / 'tools/render_trees.py')
Renderer = importlib.util.module_from_spec(Spec)
Spec.loader.exec_module(Renderer)


class MountainTests(unittest.TestCase):
    def test_slopes_have_two_or_three_intermediate_points(self):
        for nSeed in range(100):
            with self.subTest(seed=nSeed), patch.object(
                    Renderer, 'random', random.Random(nSeed)):
                Group = ET.fromstring(Renderer.Mountain(75))
                Fill, Outline = Group
                self.assertEqual(Group.get('transform'), 'translate(75,0)')
                self.assertEqual(Fill.get('d'), Outline.get('d') + ' Z')
                self.assertEqual(Fill.get('fill'), '#d3d3d3')
                self.assertEqual(Fill.get('stroke'), 'none')
                self.assertEqual(Outline.get('fill'), 'none')
                self.assertEqual(Outline.get('stroke'), '#000000')
                self.assertNotIn('Z', Outline.get('d'))

                rgPoints = [
                    tuple(map(float, Match))
                    for Match in re.findall(
                        r'(-?\d+\.\d+),(-?\d+\.\d+)', Outline.get('d'))
                ]
                self.assertEqual(rgPoints[0][1], rgPoints[-1][1])
                rgDirections = []
                rgCounts = []
                for (dX1, dY1), (dX2, dY2) in zip(rgPoints, rgPoints[1:]):
                    self.assertGreater(dX2, dX1)
                    self.assertNotEqual(dY1, dY2)
                    nDirection = 1 if dY2 > dY1 else -1
                    if not rgDirections or nDirection != rgDirections[-1]:
                        rgDirections.append(nDirection)
                        rgCounts.append(0)
                    rgCounts[-1] += 1
                self.assertEqual(rgDirections, [-1, 1, -1, 1])
                self.assertTrue(all(nCount in (3, 4) for nCount in rgCounts))

    def test_mountains_vary(self):
        with patch.object(Renderer, 'random', random.Random(0)):
            self.assertNotEqual(Renderer.Mountain(75), Renderer.Mountain(75))

    def test_main_keeps_trees_and_adds_three_mountains(self):
        with tempfile.TemporaryDirectory() as szDirectory:
            Output = Path(szDirectory) / 'landscape.svg'
            with patch('sys.argv', ['render_trees.py', str(Output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                Renderer.Main()
            Svg = ET.parse(Output).getroot()
        self.assertEqual(Svg.get('viewBox'), '0 0 450 900')
        self.assertEqual(len(Svg), 7)
        for Group in list(Svg)[:3]:
            self.assertEqual(Group[0].get('fill'), '#936442')
            self.assertEqual(Group[1].get('fill'), '#91b765')
        for Group in list(Svg)[3:6]:
            self.assertEqual(Group[0].get('fill'), '#d3d3d3')
            self.assertEqual(Group[1].get('stroke'), '#000000')
        Forest = Svg[-1]
        self.assertEqual(Forest.get('id'), 'hex-cluster')
        self.assertEqual(len(Forest), 45)
        for Cell in Forest:
            self.assertEqual(Cell[0].tag, '{http://www.w3.org/2000/svg}polygon')
            rgPoints = [
                tuple(map(float, szPoint.split(',')))
                for szPoint in Cell[0].get('points').split()
            ]
            self.assertEqual(len(rgPoints), 6)
            self.assertTrue(all(0 < dX < 450 and 390 < dY < 900
                                for dX, dY in rgPoints))
            dX = sum(dX for dX, dY in rgPoints) / 6
            dY = sum(dY for dX, dY in rgPoints) / 6
            self.assertEqual(
                Cell[1].get('transform'),
                f'translate({dX:.2f},{dY:.2f}) scale(0.2) translate(0,-100)')
            Tree = Cell[1][0]
            self.assertEqual(len(Tree), 2)
            self.assertEqual(Tree[0].get('fill'), '#936442')
            self.assertEqual(Tree[1].get('fill'), '#91b765')


class HexClusterTests(unittest.TestCase):
    def assert_segments_equal(self, rgActual, rgExpected):
        self.assertEqual(len(rgActual), len(rgExpected))
        for Actual, Expected in zip(rgActual, rgExpected):
            for Point, ExpectedPoint in zip(Actual, Expected):
                self.assertAlmostEqual(Point[0], ExpectedPoint[0])
                self.assertAlmostEqual(Point[1], ExpectedPoint[1])

    def test_v_has_nine_columns_of_five_and_is_contiguous(self):
        rgHexes = Renderer.VHexCluster()
        self.assertEqual(len(rgHexes), 45)
        rgCenters = [
            (sum(dX for dX, dY in Hex) / 6, sum(dY for dX, dY in Hex) / 6)
            for Hex in rgHexes
        ]
        rgColumns = sorted(set(dX for dX, dY in rgCenters))
        self.assertEqual(len(rgColumns), 9)
        rgTops = []
        for dColumnX in rgColumns:
            rgYs = sorted(dY for dX, dY in rgCenters if dX == dColumnX)
            self.assertEqual(len(rgYs), 5)
            for dY1, dY2 in zip(rgYs, rgYs[1:]):
                self.assertAlmostEqual(dY2 - dY1, math.sqrt(3) * 24)
            rgTops.append(rgYs[0])
        self.assertTrue(all(dY1 < dY2 for dY1, dY2 in zip(rgTops[:4], rgTops[1:5])))
        self.assertTrue(all(dY1 > dY2 for dY1, dY2 in zip(rgTops[4:], rgTops[5:])))
        # Edge-sharing neighbors must reach every hex, not just touch at corners.
        rgReached = {0}
        rgPending = [0]
        while rgPending:
            nCurrent = rgPending.pop()
            dX1, dY1 = rgCenters[nCurrent]
            for nOther, (dX2, dY2) in enumerate(rgCenters):
                if nOther not in rgReached and math.isclose(
                        math.hypot(dX2 - dX1, dY2 - dY1), math.sqrt(3) * 24):
                    rgReached.add(nOther)
                    rgPending.append(nOther)
        self.assertEqual(len(rgReached), 45)

    def test_v_scanlines_preserve_upper_gap_and_merge_lower_arm(self):
        rgHexes = Renderer.VHexCluster()
        self.assertEqual(len(Renderer.HorizontalSegments(rgHexes, 430)), 2)
        self.assertEqual(len(Renderer.HorizontalSegments(rgHexes, 750)), 1)
        self.assertEqual(Renderer.HorizontalSegments(rgHexes, 419), [])
        self.assertEqual(Renderer.HorizontalSegments(rgHexes, 900), [])

    def test_single_hex_center_slopes_edges_and_vertex_touches(self):
        rgHexes = [Renderer.HexVertices(0, 0, 2)]
        dHalfHeight = math.sqrt(3)
        for dY, dExtent in ((0, 2), (dHalfHeight / 2, 1.5),
                            (dHalfHeight, 1), (-dHalfHeight, 1)):
            self.assert_segments_equal(
                Renderer.HorizontalSegments(rgHexes, dY),
                [((-dExtent, dY), (dExtent, dY))])
        rgRotated = [[(dY, dX) for dX, dY in rgHexes[0]]]
        self.assertEqual(Renderer.HorizontalSegments(rgRotated, 2), [])

    def test_shared_edges_duplicates_and_input_order(self):
        dHeight = math.sqrt(3) * 2
        rgHexes = [Renderer.HexVertices(0, 0, 2),
                   Renderer.HexVertices(3, dHeight / 2, 2)]
        dY = dHeight / 4
        rgExpected = [((-1.5, dY), (4.5, dY))]
        self.assert_segments_equal(Renderer.HorizontalSegments(rgHexes, dY), rgExpected)
        self.assert_segments_equal(
            Renderer.HorizontalSegments([rgHexes[1], *rgHexes], dY), rgExpected)
        rgStack = [rgHexes[0], Renderer.HexVertices(0, dHeight, 2)]
        self.assert_segments_equal(
            Renderer.HorizontalSegments(rgStack, dHeight / 2),
            [((-1, dHeight / 2), (1, dHeight / 2))])

    def test_arbitrary_contiguous_ring_preserves_hole(self):
        dHeight = math.sqrt(3) * 2
        rgHexes = [Renderer.HexVertices(dX, dY, 2) for dX, dY in (
            (0, -dHeight), (3, -dHeight / 2), (3, dHeight / 2),
            (0, dHeight), (-3, dHeight / 2), (-3, -dHeight / 2))]
        self.assert_segments_equal(
            Renderer.HorizontalSegments(rgHexes, 0),
            [((-4, 0), (-2, 0)), ((2, 0), (4, 0))])

    def test_empty_cluster_and_invalid_inputs(self):
        self.assertEqual(Renderer.HorizontalSegments([], 0), [])
        for dValue in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValueError):
                Renderer.HorizontalSegments([], dValue)
        for dRadius in (0, -1, math.nan, math.inf):
            with self.assertRaises(ValueError):
                Renderer.HexVertices(0, 0, dRadius)


class ClusterInputTests(unittest.TestCase):
    def test_python_and_json_inputs_match_and_preserve_input(self):
        Data = {'hexes': [[0, 0], [1, 0], [1, -1]],
                'radius': 12, 'origin': [-30, 50]}
        szJson = json.dumps(Data)
        rgHexes = Renderer.BuildHexCluster(Data)
        self.assertEqual(rgHexes, Renderer.BuildHexCluster(szJson))
        self.assertEqual(json.dumps(Data), szJson)
        for Hex, (nQ, nR) in zip(rgHexes, Data['hexes']):
            self.assertEqual(Hex, Renderer.HexVertices(
                -30 + 18 * nQ, 50 + math.sqrt(3) * 12 * (nR + nQ / 2), 12))

    def test_defaults_tuples_and_single_hex(self):
        self.assertEqual(Renderer.BuildHexCluster({'hexes': ((0, 0),)}),
                         [Renderer.HexVertices(0, 0, 24)])

    def test_ring_and_every_neighbor_direction_are_accepted(self):
        rgRing = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
        self.assertEqual(len(Renderer.BuildHexCluster({'hexes': rgRing})), 6)
        for Neighbor in rgRing:
            with self.subTest(neighbor=Neighbor):
                self.assertEqual(len(Renderer.BuildHexCluster(
                    {'hexes': [Neighbor, (0, 0)]})), 2)

    def test_default_v_geometry_is_preserved(self):
        rgExpected = []
        for nColumn in range(9):
            nStartRow = nColumn if nColumn < 4 else 12 - 2 * nColumn
            for nRow in range(nStartRow, nStartRow + 5):
                rgExpected.append(Renderer.HexVertices(
                    81 + 36 * nColumn,
                    420 + math.sqrt(3) * 24 / 2
                    + math.sqrt(3) * 24 * (nRow + nColumn / 2), 24))
        self.assertEqual(Renderer.VHexCluster(), rgExpected)

    def test_invalid_cluster_data_is_rejected(self):
        rgInvalid = [
            None, [], 'not json', '[]', {}, {'hexes': []},
            {'hexes': [[0, 0]], 'typo': 1},
            {'hexes': [[0, 0], [0, 0]]},
            {'hexes': [[0, 0], [2, 0]]},
            {'hexes': [[0, 0], [1, 1]]},
            {'hexes': [[0, 0, 0]]}, {'hexes': [[0.0, 0]]},
            {'hexes': [[True, 0]]}, {'hexes': ['0,0']},
        ]
        rgInvalid.extend({'hexes': [[0, 0]], 'radius': Value} for Value in (
            0, -1, True, '24', None, math.inf, math.nan))
        rgInvalid.extend({'hexes': [[0, 0]], 'origin': Value} for Value in (
            [], [1], [0, 0, 0], [True, 0], [0, math.inf], [math.nan, 0],
            ['0', 0], None))
        for Data in rgInvalid:
            with self.subTest(data=Data), self.assertRaises(ValueError):
                Renderer.BuildHexCluster(Data)

    def test_embedded_json_renders_every_cell_and_expands_canvas(self):
        Data = {'hexes': [[nQ, 0] for nQ in range(7)]
                + [[0, nR] for nR in range(1, 7)],
                'radius': 60, 'origin': [-1000, -1000]}
        with tempfile.TemporaryDirectory() as szDirectory:
            Output = Path(szDirectory) / 'forest.svg'
            with patch.object(Renderer, 'g_szClusterJson', json.dumps(Data)), \
                    patch('sys.argv', ['render_trees.py', str(Output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                Renderer.Main()
            Svg = ET.parse(Output).getroot()
        dWidth, dHeight = float(Svg.get('width')), float(Svg.get('height'))
        self.assertGreater(dWidth, 450)
        self.assertGreater(dHeight, 900)
        self.assertEqual(len(Svg[-1]), len(Data['hexes']))
        for Cell in Svg[-1]:
            self.assertIn('scale(0.5)', Cell[1].get('transform'))
            for szPoint in Cell[0].get('points').split():
                dX, dY = map(float, szPoint.split(','))
                self.assertTrue(0 < dX < dWidth and 390 < dY < dHeight)

    def test_bad_embedded_json_reports_error_without_writing_svg(self):
        with tempfile.TemporaryDirectory() as szDirectory:
            Output = Path(szDirectory) / 'forest.svg'
            for szJson in ('not json', '{"hexes": [[0, 0], [2, 0]]}'):
                ErrorOutput = io.StringIO()
                with self.subTest(json=szJson), \
                        patch.object(Renderer, 'g_szClusterJson', szJson), \
                        patch('sys.argv', ['render_trees.py', str(Output)]), \
                        contextlib.redirect_stderr(ErrorOutput), \
                        self.assertRaises(SystemExit) as Error:
                    Renderer.Main()
                self.assertEqual(Error.exception.code, 2)
                self.assertIn('Invalid embedded cluster JSON', ErrorOutput.getvalue())
                self.assertFalse(Output.exists())

    def test_embedded_default_matches_v_shape(self):
        rgEmbedded = Renderer.BuildHexCluster(Renderer.g_szClusterJson)
        rgV = Renderer.VHexCluster()
        for Embedded, Hex in zip(rgEmbedded, rgV):
            for (dX1, dY1), (dX2, dY2) in zip(Embedded, Hex):
                self.assertAlmostEqual(dX1 + 81, dX2)
                self.assertAlmostEqual(dY1 + 420 + math.sqrt(3) * 24 / 2, dY2)
        self.assertEqual(len(rgEmbedded), len(rgV))


if __name__ == '__main__':
    unittest.main()
