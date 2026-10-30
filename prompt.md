
Please create a plan to build a HTML based javascript global outdoor map editor for a fantasy role playing game. 

# Features

1. The implementation shall use native javascript controls and not rely on any external JS framewroks like node.js.  All the controls and functionality will use raw native JS embedded directly in the HTML page.
1. Unit tests may be implemented as external cjs files.
1. The map will be represented as standard hexagonal tiles, each tile shall have an internally defined terrain type
1. The map will support overlays for roads, rivers and water courses.  Each layer shall be represented as a connected sequence of coordinates indicating a contiguous connected feature.
1. The map will support attaching text labels for regions, locations, and cities.  Labels can be attached to any hex tile and the size and rotation of the text will be configurable for each label individually
1. The map will support adding location features such as cities, towns, villages, etc, which will be attached to a map tile but will be distinct from the terrain type for that tile.  Hoever, no more than one feature may be added per tile, so the feature layer will be a distinct data layer in the internal map representation
1. The map can be saved in a human readable ASCII text file.  Terrain tiles will be a sequence of lines of ASCII text the width of a map section, and each ASCII char will represent  a unique terrain type for that map hex tile.  Other layers like labels, features, rivers, and roads will be appended to the bottom of the file annotated with the locations of the data element in the universal map coordinate system.
1. The map editor will support exporting the map as an SVG, allowing an optional selection of which data layers to include on the SVG at the time of SVG export.  The SVG export will render the outline of contiguous land tiles using an algorithm to represent the shorelines as a line.  Other terrain tiles will be rendered using a terrain color as well as a terrain specific SVG representation, which will be rendered at the time of export.  For example, for a forest, individual trees will be rendered across contiguous forest tiles using an algorithm defined in the code.  Likewise, hills, mountains, and other terrain types will be rendered using an SVG output algorithm for each type of terrain.
1. The map editor will support local maps at different scales, which can be defined using rectanfular width and height as well as a global anchor point for location reference, or as a global map.  The global map includes 18 panels as defined in the Map Projection section,

 # Map projection

The primary function of this map editor is to provide a contiguous representation of a spherical world projected onto a non Mercator project to preserve land area, distances, and angles.  The editor supports 2 map types, local maps which are smaller in scale and do not include corrections for spherical map projections, or a global map which is a projection onto a chamfered cube, which is defined by the following python code:

```
#!/usr/bin/env python3
# Requires Python 3.8 or later.
"""Generate the equilateral chamfered cube net using only the Python standard library.

Run from any directory:
    python tools/generate_map_projection.py
    python tools/generate_map_projection.py --labels
    python tools/generate_map_projection.py --labels --check

Outputs default to doc/equilateral-chamfered-cube.{svg,json}, relative to this
script's repository. --output-dir selects another directory. --check validates
the geometry and checks that both existing exports are exactly reproducible.

Construction, with unit edges:
    s = 1/2, u = s + 1/sqrt(3), t = s + 2/sqrt(3).
    Eight vertices are (+/-u, +/-u, +/-u).
    Twenty-four are the signed permutations of (t, s, s).
    Squares lie on signed coordinate = t; hexagons on two signed coordinates
    summing to 2u. Their angles are A = acos(-1/3), B = (360 - A)/2.

The explicit hinge tree below is unfolded once, without layout search,
optimization, or iterative geometry fitting. All coordinates are computed from
the exact radical construction, not the rounded angles in the specification.

The net is viewed from the outside, with clockwise sectors running right to left.
Top attachments, left to right:    --HS--HS--HS
Bottom attachments, left to right: --SH--SH--SH
Here S = square, H = hexagon, - = an unattached strip edge. Bottom pairs are
reversed locally so squares attach to opposite edges of strip faces 2, 4, 6.
A literal reversal of the entire top sequence would put squares on edges
reserved for hexagons. The last bottom hexagon/strip junction wraps around the
cut ends of the strip when folded. Three hexagons meet at a common SOLID vertex,
not necessarily at one point of the paper: their angle deficit is positive.

JSON includes both the 3D solid and 2D net, ordered face boundaries, every edge,
fold hinges, and paired cut seams. Coordinates are in edge-length units, with
y up in the net; the SVG reverses y and uses 80 SVG units per edge. The SVG is
plain geometry by default: closed, unfilled face polygons with black outlines and
no vertex markers or labels. --labels adds centered, light-gray Greek sector
letters with a font size one third of a square panel's side length, with their
spelled-out names in smaller text below.
Face IDs match the JSON; vertex correspondence remains
in the JSON. JSON coordinates are rounded to 12 decimal places for reproducibility
across Python versions. Equal
cut-edge labels in the JSON are glued together, matching endpoints by their
solid_vertex IDs. No glue tabs are added.
"""

import argparse
from collections import Counter
from itertools import combinations, product
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET


g_dTolerance = 1e-9
g_dAcuteAngle = math.degrees(math.acos(-1.0 / 3.0))
g_dObtuseAngle = (360.0 - g_dAcuteAngle) / 2.0
g_szStem = "equilateral-chamfered-cube"

# North is (+1, -1, -1); eta's opposite vertex (+1, +1, -1)
# sets the prime meridian. Equatorial labels run clockwise viewed from north.
g_SectorLabels = {
    "Hyz+-": "\u03b1", "Hxz--": "\u03b2", "Hxy--": "\u03b3",
    "Hyz-+": "\u03b4", "Hxz++": "\u03b5", "Hxy++": "\u03b6",
    "Hxz+-": "\u03b7", "Hyz--": "\u03b8", "Hxy+-": "\u03b9",
    "Hxy-+": "\u03ba", "Hxz-+": "\u03bb", "Hyz++": "\u03bc",
    "Sz-": "\u03bd", "Sy-": "\u03be", "Sx+": "\u03bf",
    "Sx-": "\u03c0", "Sz+": "\u03c1", "Sy+": "\u03c3",
}
g_SectorNames = {
    "\u03b1": "Alpha", "\u03b2": "Beta", "\u03b3": "Gamma",
    "\u03b4": "Delta", "\u03b5": "Epsilon", "\u03b6": "Zeta",
    "\u03b7": "Eta", "\u03b8": "Theta", "\u03b9": "Iota",
    "\u03ba": "Kappa", "\u03bb": "Lambda", "\u03bc": "Mu",
    "\u03bd": "Nu", "\u03be": "Xi", "\u03bf": "Omicron",
    "\u03c0": "Pi", "\u03c1": "Rho", "\u03c3": "Sigma",
}


def Require(fCondition, szMessage):
    """Reject a failed geometry invariant with its diagnostic."""
    if not fCondition:
        raise ValueError(szMessage)


def Subtract(Left, Right):
    """Subtract corresponding vector coordinates."""
    return tuple(dLeft - dRight for dLeft, dRight in zip(Left, Right))


def Dot(Left, Right):
    """Compute a vector dot product in coordinate order."""
    return sum(dLeft * dRight for dLeft, dRight in zip(Left, Right))


def Unit(Vector):
    """Normalize a nonzero vector to unit length."""
    dLength = math.sqrt(Dot(Vector, Vector))
    return tuple(dValue / dLength for dValue in Vector)


def Cross(Left, Right):
    """Compute the three-dimensional cross product."""
    return (
        Left[1] * Right[2] - Left[2] * Right[1],
        Left[2] * Right[0] - Left[0] * Right[2],
        Left[0] * Right[1] - Left[1] * Right[0],
    )


def Center(Points):
    """Average the coordinates of a collection of points."""
    return tuple(sum(Axis) / len(Points) for Axis in zip(*Points))


def Boundary(Items):
    """Iterate consecutive boundary pairs, including the closing edge."""
    return zip(Items, Items[1:] + Items[:1])


def EdgeKey(szFirst, szSecond):
    """Return an order-independent pair of endpoint identifiers."""
    return tuple(sorted((szFirst, szSecond)))


def Angle(Previous, Vertex, Following):
    """Measure an interior angle in degrees, clamping rounding error."""
    dCosine = Dot(Unit(Subtract(Previous, Vertex)), Unit(Subtract(Following, Vertex)))
    return math.degrees(math.acos(max(-1.0, min(1.0, dCosine))))


def BuildSolidVertices():
    """Construct the radical-coordinate vertices in stable identifier order."""
    dSmall = 0.5
    dCorner = dSmall + 1.0 / math.sqrt(3.0)
    dLarge = dSmall + 2.0 / math.sqrt(3.0)
    Points = [
        tuple(nSign * dCorner for nSign in Signs)
        for Signs in product((-1, 1), repeat=3)
    ]
    for nAxis in range(3):
        for Signs in product((-1, 1), repeat=3):
            Points.append(tuple(
                nSign * (dLarge if nCoordinate == nAxis else dSmall)
                for nCoordinate, nSign in enumerate(Signs)
            ))
    Vertices = {f"V{nIndex + 1:02}": Point for nIndex, Point in enumerate(Points)}
    return Vertices, dLarge, dCorner


def BuildSolid():
    """Build ordered solid faces and their shared edges from exact vertices."""
    Vertices, dLarge, dCorner = BuildSolidVertices()
    Faces = {}
    for nCount, szPrefix, dOffset in ((1, "S", dLarge), (2, "H", 2.0 * dCorner)):
        for Axes in combinations(range(3), nCount):
            for Signs in product((-1, 1), repeat=nCount):
                Normal = tuple(
                    Signs[Axes.index(nAxis)] if nAxis in Axes else 0
                    for nAxis in range(3)
                )
                szName = szPrefix + "".join("xyz"[nAxis] for nAxis in Axes)
                szName += "".join("+" if nSign > 0 else "-" for nSign in Signs)
                Ids = [
                    szId for szId, Point in Vertices.items()
                    if abs(Dot(Point, Normal) - dOffset) < g_dTolerance
                ]
                Origin = Center([Vertices[szId] for szId in Ids])
                AxisX = Unit(Subtract(Vertices[Ids[0]], Origin))
                AxisY = Cross(Unit(Normal), AxisX)
                Ids.sort(key=lambda szId: math.atan2(
                    Dot(Subtract(Vertices[szId], Origin), AxisY),
                    Dot(Subtract(Vertices[szId], Origin), AxisX),
                ))
                Faces[szName] = {
                    "id": szName,
                    "kind": "square" if nCount == 1 else "hexagon",
                    "vertices": Ids,
                    "normal": Unit(Normal),
                }
    EdgeFaces = {}
    for szId, Face in Faces.items():
        for szFirst, szSecond in Boundary(Face["vertices"]):
            EdgeFaces.setdefault(EdgeKey(szFirst, szSecond), []).append(szId)
    Edges = {
        Key: {"id": f"E{nIndex + 1:02}", "vertices": Key, "faces": EdgeFaces[Key]}
        for nIndex, Key in enumerate(sorted(EdgeFaces))
    }
    return Vertices, Faces, Edges


def InitializeNet(Vertices, Faces, Strip):
    """Place the first strip face and establish its solid-to-net mapping."""
    dRootThree = math.sqrt(3.0)
    dSmall, dCorner, dLarge = 0.5, 0.5 + 1.0 / dRootThree, 0.5 + 2.0 / dRootThree
    dA, dB, dC = math.sqrt(2.0 / 3.0), 1.0 / dRootThree, 2.0 * math.sqrt(2.0) / 3.0
    RootSolid = [
        (dLarge, dSmall, dSmall), (dLarge, dSmall, -dSmall),
        (dCorner, dCorner, -dCorner), (dSmall, dLarge, -dSmall),
        (dSmall, dLarge, dSmall), (dCorner, dCorner, dCorner),
    ]
    RootFlat = [
        (0.0, 0.5), (dA, 0.5 + dB), (dA + dC, 0.5 + dB - 1.0 / 3.0),
        (dA + dC, -0.5 + dB - 1.0 / 3.0), (dC, -5.0 / 6.0), (0.0, -0.5),
    ]
    PointIds = {Point: szId for szId, Point in Vertices.items()}
    NetVertices, NetFaces, FaceMaps = {}, {}, {}

    # Reflect the seed face so its outward winding is preserved in the net.
    RootMap = {
        PointIds[SolidPoint]: AddNetVertex(
            NetVertices, PointIds[SolidPoint], (-FlatPoint[0], FlatPoint[1])
        )
        for SolidPoint, FlatPoint in zip(RootSolid, RootFlat)
    }
    FaceMaps[Strip[0]] = RootMap
    NetFaces[Strip[0]] = {
        "id": Strip[0], "kind": "hexagon", "placement": "strip",
        "vertices": [RootMap[szId] for szId in Faces[Strip[0]]["vertices"]],
        "parent": None, "hinge": None,
    }

    return NetVertices, NetFaces, FaceMaps


def AddNetVertex(NetVertices, szSolidId, Point):
    """Append a net vertex with its stable identifier and solid correspondence."""
    szId = f"N{len(NetVertices) + 1:02}"
    NetVertices[szId] = {"id": szId, "position": Point, "solid_vertex": szSolidId}
    return szId


def AttachNetFace(Vertices, Faces, Edges, NetVertices, NetFaces, FaceMaps,
                  szParent, szChild, szPlacement):
    """Unfold one child across its parent's shared edge, reusing hinge vertices."""
    Require(szChild not in NetFaces, f"Repeated face: {szChild}")
    Shared = sorted(set(Faces[szParent]["vertices"]) & set(Faces[szChild]["vertices"]))
    Require(len(Shared) == 2, f"Faces do not share an edge: {szParent}, {szChild}")
    szFirst, szSecond = Shared
    SolidStart, SolidEnd = Vertices[szFirst], Vertices[szSecond]
    FlatStart = NetVertices[FaceMaps[szParent][szFirst]]["position"]
    FlatEnd = NetVertices[FaceMaps[szParent][szSecond]]["position"]
    Axis3D = Unit(Subtract(SolidEnd, SolidStart))
    ChildCenter = Center([Vertices[szId] for szId in Faces[szChild]["vertices"]])
    TowardCenter = Subtract(ChildCenter, SolidStart)
    Inward3D = Unit(tuple(
        dValue - Dot(TowardCenter, Axis3D) * dAxis
        for dValue, dAxis in zip(TowardCenter, Axis3D)
    ))
    Axis2D = Unit(Subtract(FlatEnd, FlatStart))
    Perpendicular = (-Axis2D[1], Axis2D[0])
    ParentCenter = Center([
        NetVertices[szId]["position"] for szId in NetFaces[szParent]["vertices"]
    ])
    dSign = -math.copysign(1.0, Dot(Subtract(ParentCenter, FlatStart), Perpendicular))
    ChildMap = {}
    for szSolidId in Faces[szChild]["vertices"]:
        if szSolidId in Shared:
            ChildMap[szSolidId] = FaceMaps[szParent][szSolidId]
        else:
            Relative = Subtract(Vertices[szSolidId], SolidStart)
            dAlong, dAcross = Dot(Relative, Axis3D), Dot(Relative, Inward3D)
            Point = tuple(
                dStart + dAlong * dAxis + dSign * dAcross * dPerpendicular
                for dStart, dAxis, dPerpendicular in zip(FlatStart, Axis2D, Perpendicular)
            )
            ChildMap[szSolidId] = AddNetVertex(NetVertices, szSolidId, Point)
    FaceMaps[szChild] = ChildMap
    NetFaces[szChild] = {
        "id": szChild, "kind": Faces[szChild]["kind"], "placement": szPlacement,
        "vertices": [ChildMap[szId] for szId in Faces[szChild]["vertices"]],
        "parent": szParent, "hinge": Edges[EdgeKey(*Shared)]["id"],
    }


def BuildNetEdges(NetVertices, NetFaces, Edges):
    """Collect net edge incidences and pair copies of cut solid edges."""
    NetEdges = {}
    for szId, Face in NetFaces.items():
        for szFirst, szSecond in Boundary(Face["vertices"]):
            Key = EdgeKey(szFirst, szSecond)
            if Key not in NetEdges:
                SolidKey = EdgeKey(
                    NetVertices[szFirst]["solid_vertex"], NetVertices[szSecond]["solid_vertex"]
                )
                NetEdges[Key] = {
                    "id": f"NE{len(NetEdges) + 1:02}", "vertices": Key,
                    "solid_edge": Edges[SolidKey]["id"], "faces": [],
                }
            NetEdges[Key]["faces"].append(szId)
    Copies = {}
    for Edge in NetEdges.values():
        Edge["kind"] = "fold" if len(Edge["faces"]) == 2 else "cut"
        Copies.setdefault(Edge["solid_edge"], []).append(Edge)
    for Pair in Copies.values():
        for Edge in Pair:
            Edge["mate"] = next(
                (Other["id"] for Other in Pair if Other is not Edge), None
            )
    return NetEdges


def BuildNet(Vertices, Faces, Edges):
    """Unfold the fixed strip and attachments, then identify folds and cut seams."""
    Strip = ["Hxy++", "Hyz+-", "Hxz--", "Hxy--", "Hyz-+", "Hxz++"]
    Attachments = [
        ("Hxy++", ["Sx+", "Hxz+-"], ["Hyz++", "Sy+"]),
        ("Hxz--", ["Sz-", "Hyz--"], ["Hxy-+", "Sx-"]),
        ("Hyz-+", ["Sy-", "Hxy+-"], ["Hxz-+", "Sz+"]),
    ]
    NetVertices, NetFaces, FaceMaps = InitializeNet(Vertices, Faces, Strip)
    for nIndex in range(1, len(Strip)):
        AttachNetFace(Vertices, Faces, Edges, NetVertices, NetFaces, FaceMaps,
                      Strip[nIndex - 1], Strip[nIndex], "strip")
    for szParent, Top, Bottom in Attachments:
        for szChild in Top:
            AttachNetFace(Vertices, Faces, Edges, NetVertices, NetFaces, FaceMaps,
                          szParent, szChild, "top")
        for szChild in Bottom:
            AttachNetFace(Vertices, Faces, Edges, NetVertices, NetFaces, FaceMaps,
                          szParent, szChild, "bottom")
    NetEdges = BuildNetEdges(NetVertices, NetFaces, Edges)
    return NetVertices, NetFaces, NetEdges, list(reversed(Strip))


def InteriorsOverlap(First, Second):
    """Test convex polygon interior overlap while allowing touching boundaries."""
    # Separating-axis theorem for the convex faces; touching edges are allowed.
    for Polygon in (First, Second):
        for Start, End in Boundary(Polygon):
            Direction = Subtract(End, Start)
            Axis = Unit((-Direction[1], Direction[0]))
            Left = [Dot(Point, Axis) for Point in First]
            Right = [Dot(Point, Axis) for Point in Second]
            if min(max(Left), max(Right)) - max(min(Left), min(Right)) <= g_dTolerance:
                return False
    return True


def ValidateFaceAngles(szId, Face, SolidPolygon, FlatPolygon, Incidences,
                       nExpected, dMaxLengthError, dMaxAngleError):
    """Check face angles, side lengths, planarity, and acute-vertex positions."""
    AcuteIndices = []
    for nIndex, szVertex in enumerate(Face["vertices"]):
        Incidences[szVertex].append(szId)
        dExpected = 90.0
        if nExpected == 6:
            fCorner = int(szVertex[1:]) <= 8
            dExpected = g_dAcuteAngle if fCorner else g_dObtuseAngle
            if fCorner:
                AcuteIndices.append(nIndex)
        for Polygon in (SolidPolygon, FlatPolygon):
            dAngle = Angle(Polygon[nIndex - 1], Polygon[nIndex], Polygon[(nIndex + 1) % nExpected])
            dMaxAngleError = max(dMaxAngleError, abs(dAngle - dExpected))
            dMaxLengthError = max(
                dMaxLengthError, abs(math.dist(Polygon[nIndex - 1], Polygon[nIndex]) - 1.0)
            )
        Require(abs(Dot(Subtract(SolidPolygon[nIndex], SolidPolygon[0]), Face["normal"])) < g_dTolerance,
                f"Nonplanar face: {szId}")
    return AcuteIndices, dMaxLengthError, dMaxAngleError


def ValidateHexagonEdges(szId, Face, Faces, Edges, AcuteIndices):
    """Require opposite acute corners and opposite square-adjacent hexagon edges."""
    Require(len(AcuteIndices) == 2 and AcuteIndices[1] - AcuteIndices[0] == 3,
            f"Acute vertices must be opposite: {szId}")
    SquareEdges = []
    for nIndex, (szFirst, szSecond) in enumerate(Boundary(Face["vertices"])):
        Adjacent = Edges[EdgeKey(szFirst, szSecond)]["faces"]
        if any(Faces[szOther]["kind"] == "square" for szOther in Adjacent):
            SquareEdges.append(nIndex)
            Require(nIndex not in AcuteIndices and (nIndex + 1) % 6 not in AcuteIndices,
                    f"Square at an acute vertex: {szId}")
    Require(len(SquareEdges) == 2 and SquareEdges[1] - SquareEdges[0] == 3,
            f"Square edges must be opposite: {szId}")


def ValidateFaces(Vertices, Faces, Edges, NetVertices, NetFaces):
    """Validate each unfolded face and accumulate geometry errors and incidences."""
    dMaxLengthError, dMaxAngleError, dMaxDistanceError = 0.0, 0.0, 0.0
    Incidences = {szId: [] for szId in Vertices}
    Polygons = {}
    for szId, Face in Faces.items():
        SolidPolygon = [Vertices[szVertex] for szVertex in Face["vertices"]]
        NetFace = NetFaces[szId]
        FlatPolygon = [NetVertices[szVertex]["position"] for szVertex in NetFace["vertices"]]
        Require(sum(
            First[0] * Second[1] - Second[0] * First[1]
            for First, Second in Boundary(FlatPolygon)
        ) > 0.0, f"Net face must be viewed from outside: {szId}")
        Polygons[szId] = FlatPolygon
        Require([
            NetVertices[szVertex]["solid_vertex"] for szVertex in NetFace["vertices"]
        ] == Face["vertices"], f"Vertex correspondence: {szId}")
        nExpected = 6 if Face["kind"] == "hexagon" else 4
        Require(len(SolidPolygon) == nExpected, f"Polygon size: {szId}")
        AcuteIndices, dMaxLengthError, dMaxAngleError = ValidateFaceAngles(
            szId, Face, SolidPolygon, FlatPolygon, Incidences,
            nExpected, dMaxLengthError, dMaxAngleError
        )
        if nExpected == 6:
            ValidateHexagonEdges(szId, Face, Faces, Edges, AcuteIndices)
        for nFirst, nSecond in combinations(range(nExpected), 2):
            dMaxDistanceError = max(dMaxDistanceError, abs(
                math.dist(SolidPolygon[nFirst], SolidPolygon[nSecond])
                - math.dist(FlatPolygon[nFirst], FlatPolygon[nSecond])
            ))
    return Incidences, Polygons, dMaxLengthError, dMaxAngleError, dMaxDistanceError


def ValidateSolidIncidences(Faces, Edges, Incidences):
    """Check the solid's vertex face types and manifold edge incidences."""
    for szVertex, IncidentFaces in Incidences.items():
        Expected = {"hexagon": 3} if int(szVertex[1:]) <= 8 else {"hexagon": 2, "square": 1}
        Require(Counter(Faces[szId]["kind"] for szId in IncidentFaces) == Expected,
                f"Vertex incidence: {szVertex}")
    for Edge in Edges.values():
        Require(len(Edge["faces"]) == 2, f"Nonmanifold edge: {Edge['id']}")

def ValidateSeams(Edges, NetVertices, NetEdges):
    """Check fold counts and paired cut endpoints against the closed solid."""
    Copies = {}
    NetEdgeIds = {Edge["id"]: Edge for Edge in NetEdges.values()}
    nFolds = 0
    for Edge in NetEdges.values():
        Copies.setdefault(Edge["solid_edge"], []).append(Edge)
        if Edge["kind"] == "fold":
            nFolds += 1
            Require(len(Edge["faces"]) == 2 and Edge["mate"] is None, "Invalid fold")
        else:
            Require(len(Edge["faces"]) == 1 and Edge["mate"] in NetEdgeIds, "Unpaired cut")
            Mate = NetEdgeIds[Edge["mate"]]
            Require(Mate["mate"] == Edge["id"] and Mate["solid_edge"] == Edge["solid_edge"],
                    "Cut seam mismatch")
    Require(nFolds == 17, "The 18-face tree must have 17 hinges")
    for Edge in Edges.values():
        Pair = Copies[Edge["id"]]
        Require(len(Pair) in (1, 2), "Wrong number of edge copies")
        Require(sorted(szId for Copy in Pair for szId in Copy["faces"]) == sorted(Edge["faces"]),
                "Folded edge incidence does not close")
        for Copy in Pair:
            Require(EdgeKey(*(NetVertices[szId]["solid_vertex"] for szId in Copy["vertices"]))
                    == Edge["vertices"], "Folded endpoints do not close")


def ValidateHingeTree(NetFaces, NetEdges):
    """Ensure face insertion order describes a connected, acyclic hinge tree."""
    Visited = set()
    for szId, Face in NetFaces.items():
        Require(Face["parent"] in Visited or (not Visited and Face["parent"] is None),
                "Disconnected or cyclic hinge tree")
        if Face["parent"] is not None:
            Require(any(
                Edge["kind"] == "fold" and Edge["solid_edge"] == Face["hinge"]
                and set(Edge["faces"]) == {szId, Face["parent"]}
                for Edge in NetEdges.values()
            ), "Parent hinge missing")
        Visited.add(szId)


def ValidateStrip(Faces, NetVertices, NetEdges, Strip, Polygons):
    """Check strip alignment and the prescribed alternating attachment pattern."""
    Centers = [Center(Polygons[szId]) for szId in Strip]
    Require(max(Point[1] for Point in Centers) - min(Point[1] for Point in Centers) < g_dTolerance,
            "Strip centers are not horizontal")
    Require(all(First[0] < Second[0] for First, Second in zip(Centers, Centers[1:])),
            "Strip must be ordered left to right")
    for nIndex, szId in enumerate(Strip):
        for szSide in ("top", "bottom"):
            dCenterY = Centers[nIndex][1]
            SideEdges = [
                Edge for Edge in NetEdges.values() if szId in Edge["faces"]
                and abs(
                    NetVertices[Edge["vertices"][0]]["position"][0]
                    - NetVertices[Edge["vertices"][1]]["position"][0]
                ) > g_dTolerance
                and (Center([NetVertices[szVertex]["position"] for szVertex in Edge["vertices"]])[1]
                     > dCenterY) == (szSide == "top")
            ]
            SideEdges.sort(key=lambda Edge: Center([
                NetVertices[szVertex]["position"] for szVertex in Edge["vertices"]
            ])[0])
            Pattern = [
                next((Faces[szOther]["kind"] for szOther in Edge["faces"] if szOther != szId), "-")
                for Edge in SideEdges
            ]
            Expected = ["hexagon", "square"] if szSide == "top" else ["square", "hexagon"]
            Require(Pattern == (Expected if nIndex % 2 == 1 else ["-", "-"]),
                    f"Incorrect {szSide} attachment pattern: {szId}")


def Validate(Vertices, Faces, Edges, NetVertices, NetFaces, NetEdges, Strip):
    """Validate solid topology, unfolded geometry, seams, and strip placement."""
    Require((len(Vertices), len(Edges), len(Faces)) == (32, 48, 18), "Solid counts")
    Require(Counter(Face["kind"] for Face in Faces.values()) == {
        "hexagon": 12, "square": 6,
    }, "Face types")
    Require(set(Faces) == set(NetFaces), "Every solid face must appear exactly once")
    Require((len(NetVertices), len(NetEdges)) == (62, 79), "Net counts")
    Require(len(Vertices) - len(Edges) + len(Faces) == 2, "Solid Euler characteristic")
    Require(len(NetVertices) - len(NetEdges) + len(NetFaces) == 1, "Net Euler characteristic")
    Incidences, Polygons, dMaxLengthError, dMaxAngleError, dMaxDistanceError = ValidateFaces(
        Vertices, Faces, Edges, NetVertices, NetFaces
    )
    ValidateSolidIncidences(Faces, Edges, Incidences)
    Require(dMaxLengthError < g_dTolerance, "Unequal side lengths")
    Require(dMaxAngleError < g_dTolerance, "Incorrect interior angles")
    Require(dMaxDistanceError < g_dTolerance, "Unfolding changed a face's geometry")
    for szFirst, szSecond in combinations(Polygons, 2):
        Require(not InteriorsOverlap(Polygons[szFirst], Polygons[szSecond]),
                f"Overlapping faces: {szFirst}, {szSecond}")
    ValidateSeams(Edges, NetVertices, NetEdges)
    ValidateHingeTree(NetFaces, NetEdges)
    ValidateStrip(Faces, NetVertices, NetEdges, Strip, Polygons)
    return {
        "solid_counts": {"vertices": 32, "edges": 48, "faces": 18},
        "net_counts": {"vertices": 62, "edges": 79, "faces": 18, "hinges": 17, "cut_pairs": 31},
        "edge_length_tolerance": g_dTolerance,
        "angle_tolerance_degrees": g_dTolerance,
        "face_distance_tolerance": g_dTolerance,
        "overlapping_face_pairs": 0,
        "folded_seams_match": True,
    }


def SerializeJson(Vertices, Faces, Edges, NetVertices, NetFaces, NetEdges, Strip, Validation):
    """Serialize the solid, net, and validation with reproducible rounded coordinates."""
    def Canonicalize(Value):
        """Recursively round floats and normalize signed zero for JSON."""
        if isinstance(Value, float):
            dRounded = round(Value, 12)
            return dRounded if dRounded != 0.0 else 0.0
        if isinstance(Value, dict):
            return {szKey: Canonicalize(Item) for szKey, Item in Value.items()}
        if isinstance(Value, (list, tuple)):
            return [Canonicalize(Item) for Item in Value]
        return Value

    Data = {
        "schema_version": 1,
        "name": "Equilateral chamfered cube",
        "edge_length": 1,
        "construction": {
            "method": "Exact radical coordinates and a fixed hinge tree; no iterative layout.",
            "s": "1/2", "u": "1/2 + 1/sqrt(3)", "t": "1/2 + 2/sqrt(3)",
            "hexagon_angles_degrees": [g_dAcuteAngle, g_dObtuseAngle, g_dObtuseAngle] * 2,
            "square_angle_degrees": 90,
        },
        "solid": {
            "coordinate_system": "right-handed xyz, centered at the origin",
            "vertices": [{"id": szId, "position": Point} for szId, Point in Vertices.items()],
            "edges": list(Edges.values()), "faces": list(Faces.values()),
        },
        "net": {
            "coordinate_system": "xy, x right, y up; outside view; unit edge length",
            "coordinate_decimal_places": 12,
            "strip_left_to_right": Strip,
            "top_left_to_right": "--HS--HS--HS",
            "bottom_left_to_right": "--SH--SH--SH",
            "pattern_key": {"S": "square", "H": "hexagon", "-": "unattached strip edge"},
            "bottom_order_note": "Pairs reverse locally, keeping squares opposite on strip faces 2, 4, 6.",
            "assembly": "Fold dashed edges; join equal solid_edge cut labels, matching solid_vertex endpoints.",
            "vertices": list(NetVertices.values()), "edges": list(NetEdges.values()),
            "faces": list(NetFaces.values()),
        },
        "validation": Validation,
    }
    return json.dumps(Canonicalize(Data), indent=2, allow_nan=False) + "\n"


def ValidateSvg(szSvg, Polygons, fLabels=False):
    """Verify ordered, unfilled face polygons and optional centered sector labels."""
    Root = ET.fromstring(szSvg)
    szNamespace = "{http://www.w3.org/2000/svg}"
    Require(Root.tag == szNamespace + "svg" and len(Root) == (2 if fLabels else 1),
            "SVG must contain faces and only the requested labels")
    Group = Root[0]
    Require(Group.tag == szNamespace + "g" and Group.attrib == {
        "id": "faces", "fill": "none", "stroke": "black", "stroke-width": "1",
    }, "SVG faces must have unfilled black outlines")
    Require(Counter(len(Points) for Points in Polygons.values()) == {6: 12, 4: 6},
            "SVG must contain 12 hexagons and 6 squares")
    Require(len(Group) == 18 and [Polygon.get("id") for Polygon in Group] == list(Polygons),
            "SVG face IDs or order do not match the net")
    for Polygon in Group:
        szId = Polygon.get("id")
        Require(Polygon.tag == szNamespace + "polygon" and len(Polygon) == 0
                and set(Polygon.attrib) == {"id", "points"}, f"SVG face must be a polygon: {szId}")
        szExpected = " ".join(f"{dX:.6f},{dY:.6f}" for dX, dY in Polygons[szId])
        Require(Polygon.get("points") == szExpected, f"SVG face boundary mismatch: {szId}")
    if fLabels:
        Labels = Root[1]
        Require(Labels.tag == szNamespace + "g" and Labels.attrib == {
            "id": "labels", "fill": "lightgray", "font-family": "sans-serif",
            "font-size": f"{80.0 / 3.0:.6f}", "text-anchor": "middle",
            "dominant-baseline": "central",
        }, "SVG labels must be centered, light gray, and one third of a square side")
        Require(len(Labels) == len(Polygons), "SVG must label every face once")
        for Label, (szId, Points) in zip(Labels, Polygons.items()):
            dX, dY = Center(Points)
            Require(Label.tag == szNamespace + "text" and len(Label) == 1
                    and Label.attrib == {
                        "x": f"{dX:.6f}", "y": f"{dY:.6f}", "data-face": szId,
                    } and Label.text == g_SectorLabels[szId],
                    f"SVG sector label mismatch: {szId}")
            Name = Label[0]
            Require(Name.tag == szNamespace + "tspan" and len(Name) == 0
                    and Name.attrib == {
                        "x": f"{dX:.6f}", "y": f"{dY + 80.0 / 4.0:.6f}",
                        "font-size": f"{80.0 / 8.0:.6f}",
                    } and Name.text == g_SectorNames[g_SectorLabels[szId]],
                    f"SVG sector name mismatch: {szId}")


def SerializeSvg(NetVertices, NetFaces, fLabels=False):
    """Render black polygon outlines with optional light-gray sector letters and names."""
    dScale, dMargin = 80.0, 55.0
    Points = [Vertex["position"] for Vertex in NetVertices.values()]
    dMinX, dMaxX = min(Point[0] for Point in Points), max(Point[0] for Point in Points)
    dMinY, dMaxY = min(Point[1] for Point in Points), max(Point[1] for Point in Points)
    dWidth = (dMaxX - dMinX) * dScale + 2 * dMargin
    dHeight = (dMaxY - dMinY) * dScale + 2 * dMargin

    def Screen(Point):
        """Map a net point to scaled SVG coordinates with downward-positive y."""
        return ((Point[0] - dMinX) * dScale + dMargin, (dMaxY - Point[1]) * dScale + dMargin)

    Polygons = {
        szId: [Screen(NetVertices[szVertex]["position"]) for szVertex in Face["vertices"]]
        for szId, Face in NetFaces.items()
    }
    Lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{dWidth:.6f}" height="{dHeight:.6f}" '
        f'viewBox="0 0 {dWidth:.6f} {dHeight:.6f}">',
        '  <g id="faces" fill="none" stroke="black" stroke-width="1">',
    ]
    for szId, Points in Polygons.items():
        szPoints = " ".join(f"{dX:.6f},{dY:.6f}" for dX, dY in Points)
        Lines.append(f'    <polygon id="{szId}" points="{szPoints}"/>')
    Lines.append('  </g>')
    if fLabels:
        Lines.append(
            '  <g id="labels" fill="lightgray" font-family="sans-serif" '
            f'font-size="{dScale / 3.0:.6f}" text-anchor="middle" dominant-baseline="central">'
        )
        for szId, Points in Polygons.items():
            dX, dY = Center(Points)
            Lines.append(
                f'    <text x="{dX:.6f}" y="{dY:.6f}" data-face="{szId}">'
                f'{g_SectorLabels[szId]}'
                f'<tspan x="{dX:.6f}" y="{dY + dScale / 4.0:.6f}" '
                f'font-size="{dScale / 8.0:.6f}">'
                f'{g_SectorNames[g_SectorLabels[szId]]}</tspan></text>'
            )
        Lines.append('  </g>')
    Lines.append('</svg>')
    szSvg = "\n".join(Lines) + "\n"
    ValidateSvg(szSvg, Polygons, fLabels)
    return szSvg


def Main():
    """Generate validated exports, or verify their exact existing bytes."""
    Parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    Parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "doc")
    Parser.add_argument("--check", action="store_true", help="Validate and compare existing exports without writing.")
    Parser.add_argument("--labels", action="store_true",
                        help="Label panels with light-gray Greek sector letters and names.")
    Args = Parser.parse_args()
    Vertices, Faces, Edges = BuildSolid()
    NetVertices, NetFaces, NetEdges, Strip = BuildNet(Vertices, Faces, Edges)
    Validation = Validate(Vertices, Faces, Edges, NetVertices, NetFaces, NetEdges, Strip)
    Outputs = {
        "json": SerializeJson(Vertices, Faces, Edges, NetVertices, NetFaces, NetEdges, Strip, Validation),
        "svg": SerializeSvg(NetVertices, NetFaces, Args.labels),
    }
    Data = json.loads(Outputs["json"])
    # Check the rounded, exported geometry too, not just the in-memory model.
    Validate(
        {Vertex["id"]: Vertex["position"] for Vertex in Data["solid"]["vertices"]},
        {Face["id"]: Face for Face in Data["solid"]["faces"]},
        {
            EdgeKey(*Edge["vertices"]): {**Edge, "vertices": tuple(Edge["vertices"])}
            for Edge in Data["solid"]["edges"]
        },
        {Vertex["id"]: Vertex for Vertex in Data["net"]["vertices"]},
        {Face["id"]: Face for Face in Data["net"]["faces"]},
        {EdgeKey(*Edge["vertices"]): Edge for Edge in Data["net"]["edges"]},
        Data["net"]["strip_left_to_right"],
    )
    if not Args.check:
        Args.output_dir.mkdir(parents=True, exist_ok=True)
    for szExtension, szContent in Outputs.items():
        Output = Args.output_dir / f"{g_szStem}.{szExtension}"
        if Args.check:
            Require(Output.is_file() and Output.read_bytes() == szContent.encode("utf-8"),
                    f"Missing or stale export: {Output}")
        else:
            Output.write_bytes(szContent.encode("utf-8"))
        print(f"{'Checked' if Args.check else 'Wrote'} {Output}")
    print("Validated: 18 faces, 32 solid vertices, 48 solid edges, 17 hinges, 31 cut pairs; no overlaps.")


if __name__ == "__main__":
    Main()
```

Starting at the north pole, going clockwise around the north polar vertex as see from above (the north) are 3 hexagonal panels, eta, theta, and iota.  The prime meridian bisects eta from the pole to the vertex opposite the polar vertex 

equatorial sectors going clockwise around the equator front m the perspective of the north pole starting at the prime meridian are α - alpha, β - beta, γ - gamma, δ - delta, ε - epsilon and ζ - zeta, so that ζ - zeta and α - alpha are south of eta on either side of the prime meridian, β - beta and γ - gamma are south of theta, and delta and epsilon are south of iota.

The three sectors going around the south pole starting at the prime meridian and going clockwise are kappa, lambda, and mu.    Kappa is south of α - alpha and β - beta, lambda is south of γ - gamma and δ - delta, and mu is south of ε - epsilon and ζ - zeta.

The 6 truncated sectors, which are square, in the north are nu, xi and omicron, and in the south are pi, rho and sigma.   Nu is between eta, theta, alpha and beta.   Xi is between theta, iota, gamma and delta.  omicron is between iota, eta, epsilon and zeta.   In the south, pi is between kappa, lambda, beta and gamma, rho is between lambda, mu, delta and epsilon, and sigma is between kappa, mu, zeta and alpha 

The hexagonal map panels are always drawn with hexagons oriented with the flat edges horizontal, so that a straight column of hexes will run north to south.  The other columnar location would run northeasterly to southwesterly and northwesterly to southeasterly, so that to travers hexes directly form east to west would require a zigzagging path to traverse up and to the right then down and to the right, alternating up and down to proceed in an approximately horizontal path.

To preserve uniform scaling across map resolutions, the panel size will be defined by the number of hexagons at a regional XL scale to traverse one of the equatorial panels  (alpha, beta, gamma, delta, epsilon or zeta) diagonally from the west edge to the east edge.  The default will be 24, but this can be configured when creating a new global map, but must always be an even integer number, and is always defined by the number of hexes at an XL scale.  Since the XL scale uses a 216 mile hex, this would be 5184 miles diagonally across the panel, corresponding to a panel width of 4489 miles and an equatorial circumference of the globe of about 26900 miles. 

Hexagons must always be arranged so a hex column will run directly north and south, which means for the equatorial panels alpha, beta, gamma, delta, epsilon and zeta, the hexagons run directly north/south in columns. Moving from east to west, every other column is offset ½ a hex north or south because of the geometry of the hex.  Because the number of columns is always an even integer at the XL scale, the last column of hexes on the east side of the panel will be ½ hex above the hexes in the first column, which will exactly align with the first column in the NEXT panel to the east.  This is intentional so that the hexes between all 6 equatorial panels always align perfectly.  This is a special case for the equatorial panels, because there will be no overlap or partial hexes when transitioning from one panel to the next panel.  Other panels can not align in this way because of the orientation and geometry of the panels.

The hexagonal panels to the north and south, eta, theta, and iota in the north and kappa, lambda, and mu in the south, are oriented with a primary column of hexes running north south bisecting the panel from the north vertex to the south vertex, centered along a line between the two vertices.  Similarly, the 6 square panels nu, xi, omicron, pi, rho and sigma are also bisected by a primary hexagonal column running north south and centered on the line bisecting the panel through the two opposite north south vertices.  Because the hexagonal tiles will never align exactly with the boundaries of each panel, there will be a line of partial tiles along each of the edges which are transected by the edge of the panel.  There will also be a line of partial hex tiles along the north and south edges of the equatorial panels alpha, beta, gamma, delta, epsilon and zeta.  The map editor must represent the terrain types of these partial tiles just like any other tiles, but for each of the partial tiles the terrain will span only the area entirely WITHIN the panel boundary.  Areas outside the panel boundary will be represented by tiles from those adjacent panels.  This is important because this is NOT the way the panel boundaries are handled for the east/west boundaries of the equatorial panels alpha, beta, gamma, delta, epsilon and zeta.  Because those panels have been carefully aligned so that the hexagonal tiles align perfectly along the east/west edges, each of those tiles are considered wholly within the panel to which they be long.  In effect, for each one of the tiles along each edge, a tiny corner of each hex actually exists within the adjacent panel’s boundary, but is not considered to be part of the next panel for the purpose of defining the terrain within that boundary hex.  This works out because the overlapping ares are very small, and alternat east/west all along the panel boundaries so the cancel out.

# Scale

Map scales use a fixed scaling constant so that different maps will all align with larger scale maps using the same scales.  There are 2 scales, local and regional.  Each scale is defined by the distance between the center point of two adjacent hexagons.  The scales are fixed so that a larger scale hex can be uniformly subdivided into a fixed number of smaller hexes that will always align with the larger map scale and can be scaled out indefinitely without introducing misalignment in the hex tiles.  To do this, the ratio of one scale factor to the larger scale must be an even integer ratio, such as 6:1 or 10:1.  Because the two scale systems do not align, they can not be mixed, but smaller and larger scale factors in the same scale can be mapped directly onto eachother.

Local scale:

S: 1 yard
M: 10 yards
L: 100 yards
XL: 600 yards

Regional scale

S: 1 mile
M: 6 miles
L: 36 miles
XL: 216 miles

 

 

# Universal Coordinate system

 

The location of each map hex tile shall be uniquely defined by its position within each panel.  This universal coordinate system shall be used in favor of traditional lat and lon coordinates, and is measured based on distance north, south, east or west of a reference point in each panelas measured in the plane of the panel, not following the curvature of the underlying spherical globe.  So, the measurement north or south will always be by measuring the linear distance north along the planar map within the panel, and then the distance east or west.  In other words, within a panel strict cartesian coordinates are used with now curvature corrections.  This will result in measurements that deviate from true north if spherical curvature were taken into account.

 

## Cardinal directions

Cardinal directions north, south, east, and west have two interpretations.  In all cases, panel relative directions are used for simplicity, unless otherwise specified.

Panel north/south runs along the plane of the map hex tiles in each panel.  Because the hex tiles are always aligned north and south along the centerline of each panel, panel north south always follows the hexagonal tiles, so panel north and south run along the direction of the hex columns.  Panel east/west are of course strictly orthogonal to panel north/south at all points.  In other words, panel north, south, east, and west are fixed within a panel and do not vary.  However, when two panels touch, there will be an abrupt discontinuity in the panel cardinal directions, as they transition from the coordina

Cardinal directions north, south, east, and west have two interpretations, panel directions and true directions.   Panel coordinates are effectively simple cartesian coordinates in the plane of each panel in the chamfered cube, while true coordinates are the locations and directions relative to the underlying spherical globe being projected onto the chamfered cube.  In all cases, panel relative directions are used for simplicity, unless otherwise specified

Anel north/south runs along the plane of the map hex tiles in each panel.  Because the hex tiles are always aligned north and south along the centerline of each panel, panel north south always follows the hexagonal tiles, so panel north and south run along the direction of the hex columns.  Panel east/west are of course strictly orthogonal to panel north/south at all points.  In other words, panel north, south, east, and west are fixed within a panel and do not vary.  However, when two panels touch, there will be an abrupt discontinuity in the panel cardinal directions, as they transition from the coordinate system of one panel to the next.   Transitioning east to west from one equatorial panel to another by design has negligible change in panel coordinates .   Panel north south for other panels are relative to the north south centerline of each panel along which the primary hex column is aligned.

For true headings, you must project the location of each map tile back onto the spherical globe and then determine the direction to the north ir south pole on the globe from that point.   East west directions are orthogonal to north south 

## coordinates 

Each hex map tile has a location measured by the distance north, south, east or west of a fixed reference point for each panel in miles.   For simplicity this ditance is stored as a positive or negative value along the north south and east west axes.

For equatorial panels, location coordinates are measured in miles north or south of the equatorial line, which is an imaginary line transecting all 6 equatorial panels along the equator.   Because of the chirality of each panel, the exact spot where this line enters and leaves the panel is different for alternating panels, but it is always strictly orthogonal to the north south centerline of each panel and orthogonal to the primary north south axis defining the orientation of the hexagon columns in each panel.    East west measurements are relative to the centerline of each panel.   Because the number of hexagonal columns in each panel is always even, the centerline will lie between the two middle columns.   The result is the is no hex with and east west coordinate of 0.   Each column is either slightly to the west or east of the centerline .

For all other panels, the reference point is the exact center of each panel along the line bisecting each panel from the north vertex to the south vertex.   Because this centerline is also the location of the primary hex column fir each non equatorial panel, then all the hex tiles in that column have an east/west coordinate of 0.

For true coordinates, these are simply the lat lon coordinates derived by projecting the map tile location back onto the spherical globe and computing the normal lat lon coordinates on the globe.   But the true coordinates, aka polar coordinates, are rarely used, at all times use panel coordinates unless otherwise specified 
 

#Terrain types

The map shall support the following terrain types for each hexagon map tile:

```
water
islands
lakes
firth
plain
hills
mountains
mountains peak
desert 
sand dunes 
forest
marsh
mangrove
tundra 
canyon
badlands 
farmland
```

**Addditional layer types**

Each layer shall be represented as a connected sequence of coordinates indicating a contiguous connected feature.  Each hex map tile may simultaneous have multiple features in addition to the underlying terrain, for example a road crossing a river in a plane.

Each of the following layer types are supported:

- road
- trail 
- river


**landmarks**

In addition to the underlying terrain, each hex map tile may contain a unique landmark type.  Only one landmark is allowed in each map tile.

- village
- town
- city
- castle 
- fortress
- tower
- ruins 
- mine
- temple
- cave
- dungeon 

# SVG Export

For the SVG export, if this is a global map, the SVG will be exported one panel at a time.  A popup will allow selecting options for the export, including which layers will be visible, if a hex overlay is included, and other options.

Each terrain type will have an optional hex coloring, in addition to custom rendered embellishments representing each type of terrain.  Most terrain types will be represented by a repeating patterns of some graphical element indicative of the particular type of terrain, and if adjacent map tiles have the same terrain type, the pattern will be contiguous across all contiguous map tiles of the same type, but when the terrain type changes from tile to tile the pattern will not overlap.

- plains and open water are always shown with no embelishments
- hills are represented by small overlaping curves representing the outline of small hills.
- mountains are indicated by a collection of steep angular peaks 
- a mountains peak is a single, larger angular peak filling the ntire hex tile.
- desert is a dot and a dash
- sand dunes are similar to hills but more in a dune shape, the left side is a straight slop and the right side is a gently curving slope. 
- forests are overlapping tree foliage, showing only the crowns and foliage, but along the south edge of the forest the tree trunks are visbile as small, short vertical lines 
- marsh is a series of horizontal dashes indicating water and collections of 3 shrt vertical lines indicating marsh grass
mangrove
- tundra will be shown as a dot and short horizontal dash 



 

