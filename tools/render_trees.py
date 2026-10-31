#!/usr/bin/env python3
"""Render three random trees: python3 tools/render_trees.py [output.svg]."""

import argparse
import math
from pathlib import Path
import random


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


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument('output', nargs='?', default='trees.svg')
    Args = Parser.parse_args()
    szSvg = ('<svg xmlns="http://www.w3.org/2000/svg" '
             'width="450" height="210" viewBox="0 0 450 210">\n'
             + '\n'.join(Tree(nX) for nX in (75, 225, 375))
             + '\n</svg>\n')
    Path(Args.output).write_text(szSvg, encoding='utf-8')
    print(f'Wrote {Args.output}')


if __name__ == '__main__':
    Main()
