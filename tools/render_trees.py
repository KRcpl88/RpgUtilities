#!/usr/bin/env python3
"""Render random trees, mountains, and a hex forest: python3 tools/render_trees.py [output.svg]."""

import argparse
import json
import math
from pathlib import Path
import random


g_szClusterJson = """
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


def Tree(nX):
    dWidth = random.uniform(38, 50)
    dHeight = random.uniform(45, 60)
    dY = 150 - dHeight
    nLobes = random.randint(9, 13)
    rgPoints = []
    for n in range(nLobes):
        dAngle = math.tau * n / nLobes
        dRadius = random.uniform(0.85, 1.0)
        rgPoints.append((dWidth * dRadius * math.cos(dAngle),
                         dHeight * dRadius * math.sin(dAngle)))
    szPath = f'M {rgPoints[0][0]:.2f},{rgPoints[0][1]:.2f}'
    for n in range(nLobes):
        dAngle = math.tau * (n + 0.5) / nLobes
        dBulge = random.uniform(1.15, 1.4)
        dX, dEndY = rgPoints[(n + 1) % nLobes]
        szPath += (f' Q {dWidth * dBulge * math.cos(dAngle):.2f},'
                   f'{dHeight * dBulge * math.sin(dAngle):.2f}'
                   f' {dX:.2f},{dEndY:.2f}')
    return (
        f'<g transform="translate({nX},0)">'
        '<path d="M -6,185 L -4,130 L 4,130 L 6,185 Z" '
        'fill="#936442" stroke="#493c2b" stroke-width="2"/>'
        f'<path transform="translate(0,{dY:.2f})" d="{szPath} Z" '
        'fill="#91b765" stroke="#395331" stroke-width="2" '
        'stroke-linejoin="round"/>'
        '</g>'
    )


def Mountain(nX):
    dWidth = random.uniform(100, 125)
    dBaseY = 365
    rgAnchors = [
        (-dWidth / 2, dBaseY),
        (-random.uniform(18, 35), dBaseY - random.uniform(85, 125)),
        (random.uniform(-8, 8), dBaseY - random.uniform(35, 55)),
        (random.uniform(18, 35), dBaseY - random.uniform(85, 125)),
        (dWidth / 2, dBaseY),
    ]
    rgPoints = [rgAnchors[0]]
    for (dStartX, dStartY), (dEndX, dEndY) in zip(rgAnchors, rgAnchors[1:]):
        nPoints = random.randint(2, 3)
        for n in range(1, nPoints + 1):
            dTX = (n + random.uniform(-0.25, 0.25)) / (nPoints + 1)
            dTY = (n + random.uniform(-0.25, 0.25)) / (nPoints + 1)
            rgPoints.append((dStartX + (dEndX - dStartX) * dTX,
                             dStartY + (dEndY - dStartY) * dTY))
        rgPoints.append((dEndX, dEndY))
    szPath = 'M ' + ' L '.join(f'{dX:.2f},{dY:.2f}' for dX, dY in rgPoints)
    return (
        f'<g transform="translate({nX},0)">'
        f'<path d="{szPath} Z" fill="#d3d3d3" stroke="none"/>'
        f'<path d="{szPath}" fill="none" stroke="#000000" stroke-width="2" '
        'stroke-linejoin="round" stroke-linecap="round"/>'
        '</g>'
    )


def HexVertices(dX, dY, dRadius):
    if not math.isfinite(dRadius) or dRadius <= 0:
        raise ValueError('Hex radius must be positive and finite')
    dHalfHeight = math.sqrt(3) * dRadius / 2
    return [
        (dX + dRadius, dY),
        (dX + dRadius / 2, dY + dHalfHeight),
        (dX - dRadius / 2, dY + dHalfHeight),
        (dX - dRadius, dY),
        (dX - dRadius / 2, dY - dHalfHeight),
        (dX + dRadius / 2, dY - dHalfHeight),
    ]


def BuildHexCluster(Data):
    """Build flat-top hex polygons from a dict or JSON text.

    Required: hexes, a nonempty list of integer axial [q, r] coordinates.
    Optional: radius (default 24), origin [x, y] (default [0, 0]).
    Duplicate cells and clusters not connected through shared edges are rejected.
    """
    if isinstance(Data, str):
        Data = json.loads(Data)
    if not isinstance(Data, dict) or set(Data) - {'hexes', 'radius', 'origin'}:
        raise ValueError('Cluster must be an object with hexes, radius, and/or origin')
    rgCells = Data.get('hexes')
    if not isinstance(rgCells, (list, tuple)) or not rgCells:
        raise ValueError('Cluster hexes must be a nonempty list of [q, r] coordinates')
    rgCoordinates = []
    for Cell in rgCells:
        if (not isinstance(Cell, (list, tuple)) or len(Cell) != 2
                or any(type(nValue) is not int for nValue in Cell)):
            raise ValueError('Each hex coordinate must contain two integers [q, r]')
        rgCoordinates.append(tuple(Cell))
    Cells = set(rgCoordinates)
    if len(Cells) != len(rgCoordinates):
        raise ValueError('Cluster contains duplicate hex coordinates')
    Reached = {rgCoordinates[0]}
    rgPending = [rgCoordinates[0]]
    while rgPending:
        nQ, nR = rgPending.pop()
        for nDQ, nDR in ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)):
            Neighbor = (nQ + nDQ, nR + nDR)
            if Neighbor in Cells and Neighbor not in Reached:
                Reached.add(Neighbor)
                rgPending.append(Neighbor)
    if Reached != Cells:
        raise ValueError('Cluster hexes must be connected through shared edges')

    dRadius = Data.get('radius', 24)
    if (type(dRadius) not in (int, float)
            or not math.isfinite(dRadius) or dRadius <= 0):
        raise ValueError('Cluster radius must be positive and finite')
    Origin = Data.get('origin', [0, 0])
    if (not isinstance(Origin, (list, tuple)) or len(Origin) != 2
            or any(type(dValue) not in (int, float) or not math.isfinite(dValue)
                   for dValue in Origin)):
        raise ValueError('Cluster origin must contain two finite numbers [x, y]')
    dOriginX, dOriginY = Origin
    dHeight = math.sqrt(3) * dRadius
    return [
        HexVertices(dOriginX + 1.5 * dRadius * nQ,
                    dOriginY + dHeight * (nR + nQ / 2), dRadius)
        for nQ, nR in rgCoordinates
    ]


def VHexCluster():
    """Return 45 flat-top hex polygons: four descending columns, then five ascending."""
    rgCells = []
    for nColumn in range(9):
        nStartRow = nColumn if nColumn < 4 else 12 - 2 * nColumn
        for nRow in range(nStartRow, nStartRow + 5):
            rgCells.append((nColumn, nRow))
    return BuildHexCluster({
        'hexes': rgCells,
        'origin': [81, 420 + math.sqrt(3) * 24 / 2],
    })


def HorizontalSegments(rgHexes, dY):
    """Intersect hex polygons with y=dY; return sorted ((left, y), (right, y)) pairs.

    Shared edges and overlapping intervals are merged; gaps remain separate.
    Horizontal boundary edges are included, but isolated vertex touches are not.
    """
    if not math.isfinite(dY):
        raise ValueError('Horizontal line y must be finite')
    rgIntervals = []
    for rgVertices in rgHexes:
        rgXs = []
        for (dX1, dY1), (dX2, dY2) in zip(
                rgVertices, rgVertices[1:] + rgVertices[:1]):
            if min(dY1, dY2) <= dY <= max(dY1, dY2):
                if dY1 == dY2:
                    rgXs.extend((dX1, dX2))
                else:
                    rgXs.append(dX1 + (dX2 - dX1) * (dY - dY1) / (dY2 - dY1))
        if rgXs and min(rgXs) < max(rgXs):
            rgIntervals.append((min(rgXs), max(rgXs)))
    rgMerged = []
    for dLeft, dRight in sorted(rgIntervals):
        if rgMerged and (dLeft <= rgMerged[-1][1] or math.isclose(
                dLeft, rgMerged[-1][1], rel_tol=0, abs_tol=1e-9)):
            rgMerged[-1] = (rgMerged[-1][0], max(rgMerged[-1][1], dRight))
        else:
            rgMerged.append((dLeft, dRight))
    return [((dLeft, dY), (dRight, dY)) for dLeft, dRight in rgMerged]


def HexForest(rgHexes):
    rgSvg = ['<g id="hex-cluster">']
    for rgVertices in rgHexes:
        dX = sum(dX for dX, dY in rgVertices) / len(rgVertices)
        dY = sum(dY for dX, dY in rgVertices) / len(rgVertices)
        dScale = (max(dX for dX, dY in rgVertices)
                  - min(dX for dX, dY in rgVertices)) / 240
        szPoints = ' '.join(f'{dX:.2f},{dY:.2f}' for dX, dY in rgVertices)
        rgSvg.append(
            f'<g><polygon points="{szPoints}" fill="#f5f5f5" '
            'stroke="#777777" stroke-width="1"/>'
            f'<g transform="translate({dX:.2f},{dY:.2f}) scale({dScale:g}) '
            f'translate(0,-100)">{Tree(0)}</g></g>')
    rgSvg.append('</g>')
    return '\n'.join(rgSvg)


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument('output', nargs='?', default='trees.svg')
    Args = Parser.parse_args()
    try:
        rgHexes = BuildHexCluster(g_szClusterJson)
    except ValueError as Error:
        Parser.error(f'Invalid embedded cluster JSON: {Error}')
    dMinX = min(dX for Hex in rgHexes for dX, dY in Hex)
    dMaxX = max(dX for Hex in rgHexes for dX, dY in Hex)
    dMinY = min(dY for Hex in rgHexes for dX, dY in Hex)
    dMaxY = max(dY for Hex in rgHexes for dX, dY in Hex)
    dWidth = max(450, dMaxX - dMinX + 50)
    dHeight = max(900, dMaxY - dMinY + 420 + 20)
    dLeftMargin = (dWidth - (dMaxX - dMinX)) / 2
    rgHexes = [[(dX - dMinX + dLeftMargin, dY - dMinY + 420) for dX, dY in Hex]
               for Hex in rgHexes]
    szSvg = ('<svg xmlns="http://www.w3.org/2000/svg" '
             f'width="{dWidth:g}" height="{dHeight:g}" '
             f'viewBox="0 0 {dWidth:g} {dHeight:g}">\n'
             + '\n'.join(Tree(nX) for nX in (75, 225, 375))
             + '\n' + '\n'.join(Mountain(nX) for nX in (75, 225, 375))
             + '\n' + HexForest(rgHexes)
             + '\n</svg>\n')
    Path(Args.output).write_text(szSvg, encoding='utf-8')
    print(f'Wrote {Args.output}')


if __name__ == '__main__':
    Main()
