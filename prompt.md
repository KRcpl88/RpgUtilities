
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

```python
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
import xml.etree.ElementTree as et


TOLERANCE = 1e-9
ACUTE_ANGLE = math.degrees(math.acos(-1.0 / 3.0))
OBTUSE_ANGLE = (360.0 - ACUTE_ANGLE) / 2.0
STEM = "equilateral-chamfered-cube"

# North is (+1, -1, -1); eta's opposite vertex (+1, +1, -1)
# sets the prime meridian. Equatorial labels run clockwise viewed from north.
SECTOR_LABELS = {
    "Hyz+-": "\u03b1", "Hxz--": "\u03b2", "Hxy--": "\u03b3",
    "Hyz-+": "\u03b4", "Hxz++": "\u03b5", "Hxy++": "\u03b6",
    "Hxz+-": "\u03b7", "Hyz--": "\u03b8", "Hxy+-": "\u03b9",
    "Hxy-+": "\u03ba", "Hxz-+": "\u03bb", "Hyz++": "\u03bc",
    "Sz-": "\u03bd", "Sy-": "\u03be", "Sx+": "\u03bf",
    "Sx-": "\u03c0", "Sz+": "\u03c1", "Sy+": "\u03c3",
}
SECTOR_NAMES = {
    "\u03b1": "Alpha", "\u03b2": "Beta", "\u03b3": "Gamma",
    "\u03b4": "Delta", "\u03b5": "Epsilon", "\u03b6": "Zeta",
    "\u03b7": "Eta", "\u03b8": "Theta", "\u03b9": "Iota",
    "\u03ba": "Kappa", "\u03bb": "Lambda", "\u03bc": "Mu",
    "\u03bd": "Nu", "\u03be": "Xi", "\u03bf": "Omicron",
    "\u03c0": "Pi", "\u03c1": "Rho", "\u03c3": "Sigma",
}


def require(condition, message):
    """Reject a failed geometry invariant with its diagnostic."""
    if not condition:
        raise ValueError(message)


def subtract(left, right):
    """Subtract corresponding vector coordinates."""
    return tuple(left_coordinate - right_coordinate for left_coordinate, right_coordinate in zip(left, right))


def dot(left, right):
    """Compute a vector dot product in coordinate order."""
    return sum(left_coordinate * right_coordinate for left_coordinate, right_coordinate in zip(left, right))


def unit(vector):
    """Normalize a nonzero vector to unit length."""
    length = math.sqrt(dot(vector, vector))
    return tuple(value / length for value in vector)


def cross(left, right):
    """Compute the three-dimensional cross product."""
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def center(points):
    """Average the coordinates of a collection of points."""
    return tuple(sum(axis) / len(points) for axis in zip(*points))


def boundary(items):
    """Iterate consecutive boundary pairs, including the closing edge."""
    return zip(items, items[1:] + items[:1])


def edge_key(first_id, second_id):
    """Return an order-independent pair of endpoint identifiers."""
    return tuple(sorted((first_id, second_id)))


def interior_angle(previous, vertex, following):
    """Measure an interior angle in degrees, clamping rounding error."""
    cosine = dot(unit(subtract(previous, vertex)), unit(subtract(following, vertex)))
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def build_solid_vertices():
    """Construct the radical-coordinate vertices in stable identifier order."""
    small = 0.5
    corner = small + 1.0 / math.sqrt(3.0)
    large = small + 2.0 / math.sqrt(3.0)
    points = [
        tuple(sign * corner for sign in signs)
        for signs in product((-1, 1), repeat=3)
    ]
    for axis_index in range(3):
        for signs in product((-1, 1), repeat=3):
            points.append(tuple(
                sign * (large if coordinate == axis_index else small)
                for coordinate, sign in enumerate(signs)
            ))
    vertices = {f"V{index + 1:02}": point for index, point in enumerate(points)}
    return vertices, large, corner


def build_solid():
    """Build ordered solid faces and their shared edges from exact vertices."""
    vertices, large, corner = build_solid_vertices()
    faces = {}
    for count, prefix, offset in ((1, "S", large), (2, "H", 2.0 * corner)):
        for axes in combinations(range(3), count):
            for signs in product((-1, 1), repeat=count):
                normal = tuple(
                    signs[axes.index(axis_index)] if axis_index in axes else 0
                    for axis_index in range(3)
                )
                name_text = prefix + "".join("xyz"[axis_index] for axis_index in axes)
                name_text += "".join("+" if sign > 0 else "-" for sign in signs)
                ids = [
                    identifier for identifier, point in vertices.items()
                    if abs(dot(point, normal) - offset) < TOLERANCE
                ]
                origin = center([vertices[identifier] for identifier in ids])
                axis_x = unit(subtract(vertices[ids[0]], origin))
                axis_y = cross(unit(normal), axis_x)
                ids.sort(key=lambda identifier: math.atan2(
                    dot(subtract(vertices[identifier], origin), axis_y),
                    dot(subtract(vertices[identifier], origin), axis_x),
                ))
                faces[name_text] = {
                    "id": name_text,
                    "kind": "square" if count == 1 else "hexagon",
                    "vertices": ids,
                    "normal": unit(normal),
                }
    edge_faces = {}
    for identifier, face in faces.items():
        for first_id, second_id in boundary(face["vertices"]):
            edge_faces.setdefault(edge_key(first_id, second_id), []).append(identifier)
    edges = {
        key: {"id": f"E{index + 1:02}", "vertices": key, "faces": edge_faces[key]}
        for index, key in enumerate(sorted(edge_faces))
    }
    return vertices, faces, edges


def initialize_net(vertices, faces, strip):
    """Place the first strip face and establish its solid-to-net mapping."""
    root_three = math.sqrt(3.0)
    small, corner, large = 0.5, 0.5 + 1.0 / root_three, 0.5 + 2.0 / root_three
    a, b, c = math.sqrt(2.0 / 3.0), 1.0 / root_three, 2.0 * math.sqrt(2.0) / 3.0
    root_solid = [
        (large, small, small), (large, small, -small),
        (corner, corner, -corner), (small, large, -small),
        (small, large, small), (corner, corner, corner),
    ]
    root_flat = [
        (0.0, 0.5), (a, 0.5 + b), (a + c, 0.5 + b - 1.0 / 3.0),
        (a + c, -0.5 + b - 1.0 / 3.0), (c, -5.0 / 6.0), (0.0, -0.5),
    ]
    point_ids = {point: identifier for identifier, point in vertices.items()}
    net_vertices, net_faces, face_maps = {}, {}, {}

    # Reflect the seed face so its outward winding is preserved in the net.
    root_map = {
        point_ids[solid_point]: add_net_vertex(
            net_vertices, point_ids[solid_point], (-flat_point[0], flat_point[1])
        )
        for solid_point, flat_point in zip(root_solid, root_flat)
    }
    face_maps[strip[0]] = root_map
    net_faces[strip[0]] = {
        "id": strip[0], "kind": "hexagon", "placement": "strip",
        "vertices": [root_map[identifier] for identifier in faces[strip[0]]["vertices"]],
        "parent": None, "hinge": None,
    }

    return net_vertices, net_faces, face_maps


def add_net_vertex(net_vertices, solid_id, point):
    """Append a net vertex with its stable identifier and solid correspondence."""
    identifier = f"N{len(net_vertices) + 1:02}"
    net_vertices[identifier] = {"id": identifier, "position": point, "solid_vertex": solid_id}
    return identifier


def attach_net_face(vertices, faces, edges, net_vertices, net_faces, face_maps,
                  parent, child, placement):
    """Unfold one child across its parent's shared edge, reusing hinge vertices."""
    require(child not in net_faces, f"Repeated face: {child}")
    shared = sorted(set(faces[parent]["vertices"]) & set(faces[child]["vertices"]))
    require(len(shared) == 2, f"Faces do not share an edge: {parent}, {child}")
    first_id, second_id = shared
    solid_start, solid_end = vertices[first_id], vertices[second_id]
    flat_start = net_vertices[face_maps[parent][first_id]]["position"]
    flat_end = net_vertices[face_maps[parent][second_id]]["position"]
    axis3_d = unit(subtract(solid_end, solid_start))
    child_center = center([vertices[identifier] for identifier in faces[child]["vertices"]])
    toward_center = subtract(child_center, solid_start)
    inward3_d = unit(tuple(
        value - dot(toward_center, axis3_d) * along_axis
        for value, along_axis in zip(toward_center, axis3_d)
    ))
    axis2_d = unit(subtract(flat_end, flat_start))
    perpendicular = (-axis2_d[1], axis2_d[0])
    parent_center = center([
        net_vertices[identifier]["position"] for identifier in net_faces[parent]["vertices"]
    ])
    sign = -math.copysign(1.0, dot(subtract(parent_center, flat_start), perpendicular))
    child_map = {}
    for solid_id in faces[child]["vertices"]:
        if solid_id in shared:
            child_map[solid_id] = face_maps[parent][solid_id]
        else:
            relative = subtract(vertices[solid_id], solid_start)
            along, across = dot(relative, axis3_d), dot(relative, inward3_d)
            point = tuple(
                start + along * along_axis + sign * across * across_axis
                for start, along_axis, across_axis in zip(flat_start, axis2_d, perpendicular)
            )
            child_map[solid_id] = add_net_vertex(net_vertices, solid_id, point)
    face_maps[child] = child_map
    net_faces[child] = {
        "id": child, "kind": faces[child]["kind"], "placement": placement,
        "vertices": [child_map[identifier] for identifier in faces[child]["vertices"]],
        "parent": parent, "hinge": edges[edge_key(*shared)]["id"],
    }


def build_net_edges(net_vertices, net_faces, edges):
    """Collect net edge incidences and pair copies of cut solid edges."""
    net_edges = {}
    for identifier, face in net_faces.items():
        for first_id, second_id in boundary(face["vertices"]):
            key = edge_key(first_id, second_id)
            if key not in net_edges:
                solid_key = edge_key(
                    net_vertices[first_id]["solid_vertex"], net_vertices[second_id]["solid_vertex"]
                )
                net_edges[key] = {
                    "id": f"NE{len(net_edges) + 1:02}", "vertices": key,
                    "solid_edge": edges[solid_key]["id"], "faces": [],
                }
            net_edges[key]["faces"].append(identifier)
    copies = {}
    for edge in net_edges.values():
        edge["kind"] = "fold" if len(edge["faces"]) == 2 else "cut"
        copies.setdefault(edge["solid_edge"], []).append(edge)
    for pair in copies.values():
        for edge in pair:
            edge["mate"] = next(
                (other["id"] for other in pair if other is not edge), None
            )
    return net_edges


def build_net(vertices, faces, edges):
    """Unfold the fixed strip and attachments, then identify folds and cut seams."""
    strip = ["Hxy++", "Hyz+-", "Hxz--", "Hxy--", "Hyz-+", "Hxz++"]
    attachments = [
        ("Hxy++", ["Sx+", "Hxz+-"], ["Hyz++", "Sy+"]),
        ("Hxz--", ["Sz-", "Hyz--"], ["Hxy-+", "Sx-"]),
        ("Hyz-+", ["Sy-", "Hxy+-"], ["Hxz-+", "Sz+"]),
    ]
    net_vertices, net_faces, face_maps = initialize_net(vertices, faces, strip)
    for index in range(1, len(strip)):
        attach_net_face(vertices, faces, edges, net_vertices, net_faces, face_maps,
                      strip[index - 1], strip[index], "strip")
    for parent, top, bottom in attachments:
        for child in top:
            attach_net_face(vertices, faces, edges, net_vertices, net_faces, face_maps,
                          parent, child, "top")
        for child in bottom:
            attach_net_face(vertices, faces, edges, net_vertices, net_faces, face_maps,
                          parent, child, "bottom")
    net_edges = build_net_edges(net_vertices, net_faces, edges)
    return net_vertices, net_faces, net_edges, list(reversed(strip))


def interiors_overlap(first, second):
    """Test convex polygon interior overlap while allowing touching boundaries."""
    # Separating-axis theorem for the convex faces; touching edges are allowed.
    for polygon in (first, second):
        for start, end in boundary(polygon):
            direction = subtract(end, start)
            axis = unit((-direction[1], direction[0]))
            left = [dot(point, axis) for point in first]
            right = [dot(point, axis) for point in second]
            if min(max(left), max(right)) - max(min(left), min(right)) <= TOLERANCE:
                return False
    return True


def validate_face_angles(identifier, face, solid_polygon, flat_polygon, incidences,
                       expected_count, max_length_error, max_angle_error):
    """Check face angles, side lengths, planarity, and acute-vertex positions."""
    acute_indices = []
    for index, vertex_id in enumerate(face["vertices"]):
        incidences[vertex_id].append(identifier)
        expected_angle = 90.0
        if expected_count == 6:
            corner = int(vertex_id[1:]) <= 8
            expected_angle = ACUTE_ANGLE if corner else OBTUSE_ANGLE
            if corner:
                acute_indices.append(index)
        for polygon in (solid_polygon, flat_polygon):
            angle = interior_angle(polygon[index - 1], polygon[index], polygon[(index + 1) % expected_count])
            max_angle_error = max(max_angle_error, abs(angle - expected_angle))
            max_length_error = max(
                max_length_error, abs(math.dist(polygon[index - 1], polygon[index]) - 1.0)
            )
        require(abs(dot(subtract(solid_polygon[index], solid_polygon[0]), face["normal"])) < TOLERANCE,
                f"Nonplanar face: {identifier}")
    return acute_indices, max_length_error, max_angle_error


def validate_hexagon_edges(identifier, face, faces, edges, acute_indices):
    """Require opposite acute corners and opposite square-adjacent hexagon edges."""
    require(len(acute_indices) == 2 and acute_indices[1] - acute_indices[0] == 3,
            f"Acute vertices must be opposite: {identifier}")
    square_edges = []
    for index, (first_id, second_id) in enumerate(boundary(face["vertices"])):
        adjacent = edges[edge_key(first_id, second_id)]["faces"]
        if any(faces[other_id]["kind"] == "square" for other_id in adjacent):
            square_edges.append(index)
            require(index not in acute_indices and (index + 1) % 6 not in acute_indices,
                    f"Square at an acute vertex: {identifier}")
    require(len(square_edges) == 2 and square_edges[1] - square_edges[0] == 3,
            f"Square edges must be opposite: {identifier}")


def validate_faces(vertices, faces, edges, net_vertices, net_faces):
    """Validate each unfolded face and accumulate geometry errors and incidences."""
    max_length_error, max_angle_error, max_distance_error = 0.0, 0.0, 0.0
    incidences = {identifier: [] for identifier in vertices}
    polygons = {}
    for identifier, face in faces.items():
        solid_polygon = [vertices[vertex_id] for vertex_id in face["vertices"]]
        net_face = net_faces[identifier]
        flat_polygon = [net_vertices[vertex_id]["position"] for vertex_id in net_face["vertices"]]
        require(sum(
            first[0] * second[1] - second[0] * first[1]
            for first, second in boundary(flat_polygon)
        ) > 0.0, f"Net face must be viewed from outside: {identifier}")
        polygons[identifier] = flat_polygon
        require([
            net_vertices[vertex_id]["solid_vertex"] for vertex_id in net_face["vertices"]
        ] == face["vertices"], f"Vertex correspondence: {identifier}")
        expected_count = 6 if face["kind"] == "hexagon" else 4
        require(len(solid_polygon) == expected_count, f"Polygon size: {identifier}")
        acute_indices, max_length_error, max_angle_error = validate_face_angles(
            identifier, face, solid_polygon, flat_polygon, incidences,
            expected_count, max_length_error, max_angle_error
        )
        if expected_count == 6:
            validate_hexagon_edges(identifier, face, faces, edges, acute_indices)
        for first_index, second_index in combinations(range(expected_count), 2):
            max_distance_error = max(max_distance_error, abs(
                math.dist(solid_polygon[first_index], solid_polygon[second_index])
                - math.dist(flat_polygon[first_index], flat_polygon[second_index])
            ))
    return incidences, polygons, max_length_error, max_angle_error, max_distance_error


def validate_solid_incidences(faces, edges, incidences):
    """Check the solid's vertex face types and manifold edge incidences."""
    for vertex_id, incident_faces in incidences.items():
        expected = {"hexagon": 3} if int(vertex_id[1:]) <= 8 else {"hexagon": 2, "square": 1}
        require(Counter(faces[identifier]["kind"] for identifier in incident_faces) == expected,
                f"Vertex incidence: {vertex_id}")
    for edge in edges.values():
        require(len(edge["faces"]) == 2, f"Nonmanifold edge: {edge['id']}")

def validate_seams(edges, net_vertices, net_edges):
    """Check fold counts and paired cut endpoints against the closed solid."""
    copies = {}
    net_edge_ids = {edge["id"]: edge for edge in net_edges.values()}
    folds = 0
    for edge in net_edges.values():
        copies.setdefault(edge["solid_edge"], []).append(edge)
        if edge["kind"] == "fold":
            folds += 1
            require(len(edge["faces"]) == 2 and edge["mate"] is None, "Invalid fold")
        else:
            require(len(edge["faces"]) == 1 and edge["mate"] in net_edge_ids, "Unpaired cut")
            mate = net_edge_ids[edge["mate"]]
            require(mate["mate"] == edge["id"] and mate["solid_edge"] == edge["solid_edge"],
                    "Cut seam mismatch")
    require(folds == 17, "The 18-face tree must have 17 hinges")
    for edge in edges.values():
        pair = copies[edge["id"]]
        require(len(pair) in (1, 2), "Wrong number of edge copies")
        require(sorted(identifier for copy in pair for identifier in copy["faces"]) == sorted(edge["faces"]),
                "Folded edge incidence does not close")
        for copy in pair:
            require(edge_key(*(net_vertices[identifier]["solid_vertex"] for identifier in copy["vertices"]))
                    == edge["vertices"], "Folded endpoints do not close")


def validate_hinge_tree(net_faces, net_edges):
    """Ensure face insertion order describes a connected, acyclic hinge tree."""
    visited = set()
    for identifier, face in net_faces.items():
        require(face["parent"] in visited or (not visited and face["parent"] is None),
                "Disconnected or cyclic hinge tree")
        if face["parent"] is not None:
            require(any(
                edge["kind"] == "fold" and edge["solid_edge"] == face["hinge"]
                and set(edge["faces"]) == {identifier, face["parent"]}
                for edge in net_edges.values()
            ), "Parent hinge missing")
        visited.add(identifier)


def validate_strip(faces, net_vertices, net_edges, strip, polygons):
    """Check strip alignment and the prescribed alternating attachment pattern."""
    centers = [center(polygons[identifier]) for identifier in strip]
    require(max(point[1] for point in centers) - min(point[1] for point in centers) < TOLERANCE,
            "Strip centers are not horizontal")
    require(all(first[0] < second[0] for first, second in zip(centers, centers[1:])),
            "Strip must be ordered left to right")
    for index, identifier in enumerate(strip):
        for side in ("top", "bottom"):
            center_y = centers[index][1]
            side_edges = [
                edge for edge in net_edges.values() if identifier in edge["faces"]
                and abs(
                    net_vertices[edge["vertices"][0]]["position"][0]
                    - net_vertices[edge["vertices"][1]]["position"][0]
                ) > TOLERANCE
                and (center([net_vertices[vertex_id]["position"] for vertex_id in edge["vertices"]])[1]
                     > center_y) == (side == "top")
            ]
            side_edges.sort(key=lambda edge: center([
                net_vertices[vertex_id]["position"] for vertex_id in edge["vertices"]
            ])[0])
            pattern = [
                next((faces[other_id]["kind"] for other_id in edge["faces"] if other_id != identifier), "-")
                for edge in side_edges
            ]
            expected = ["hexagon", "square"] if side == "top" else ["square", "hexagon"]
            require(pattern == (expected if index % 2 == 1 else ["-", "-"]),
                    f"Incorrect {side} attachment pattern: {identifier}")


def validate(vertices, faces, edges, net_vertices, net_faces, net_edges, strip):
    """Validate solid topology, unfolded geometry, seams, and strip placement."""
    require((len(vertices), len(edges), len(faces)) == (32, 48, 18), "Solid counts")
    require(Counter(face["kind"] for face in faces.values()) == {
        "hexagon": 12, "square": 6,
    }, "Face types")
    require(set(faces) == set(net_faces), "Every solid face must appear exactly once")
    require((len(net_vertices), len(net_edges)) == (62, 79), "Net counts")
    require(len(vertices) - len(edges) + len(faces) == 2, "Solid Euler characteristic")
    require(len(net_vertices) - len(net_edges) + len(net_faces) == 1, "Net Euler characteristic")
    incidences, polygons, max_length_error, max_angle_error, max_distance_error = validate_faces(
        vertices, faces, edges, net_vertices, net_faces
    )
    validate_solid_incidences(faces, edges, incidences)
    require(max_length_error < TOLERANCE, "Unequal side lengths")
    require(max_angle_error < TOLERANCE, "Incorrect interior angles")
    require(max_distance_error < TOLERANCE, "Unfolding changed a face's geometry")
    for first_id, second_id in combinations(polygons, 2):
        require(not interiors_overlap(polygons[first_id], polygons[second_id]),
                f"Overlapping faces: {first_id}, {second_id}")
    validate_seams(edges, net_vertices, net_edges)
    validate_hinge_tree(net_faces, net_edges)
    validate_strip(faces, net_vertices, net_edges, strip, polygons)
    return {
        "solid_counts": {"vertices": 32, "edges": 48, "faces": 18},
        "net_counts": {"vertices": 62, "edges": 79, "faces": 18, "hinges": 17, "cut_pairs": 31},
        "edge_length_tolerance": TOLERANCE,
        "angle_tolerance_degrees": TOLERANCE,
        "face_distance_tolerance": TOLERANCE,
        "overlapping_face_pairs": 0,
        "folded_seams_match": True,
    }


def serialize_json(vertices, faces, edges, net_vertices, net_faces, net_edges, strip, validation):
    """Serialize the solid, net, and validation with reproducible rounded coordinates."""
    def canonicalize(value):
        """Recursively round floats and normalize signed zero for JSON."""
        if isinstance(value, float):
            rounded = round(value, 12)
            return rounded if rounded != 0.0 else 0.0
        if isinstance(value, dict):
            return {key: canonicalize(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [canonicalize(item) for item in value]
        return value

    data = {
        "schema_version": 1,
        "name": "Equilateral chamfered cube",
        "edge_length": 1,
        "construction": {
            "method": "Exact radical coordinates and a fixed hinge tree; no iterative layout.",
            "s": "1/2", "u": "1/2 + 1/sqrt(3)", "t": "1/2 + 2/sqrt(3)",
            "hexagon_angles_degrees": [ACUTE_ANGLE, OBTUSE_ANGLE, OBTUSE_ANGLE] * 2,
            "square_angle_degrees": 90,
        },
        "solid": {
            "coordinate_system": "right-handed xyz, centered at the origin",
            "vertices": [{"id": identifier, "position": point} for identifier, point in vertices.items()],
            "edges": list(edges.values()), "faces": list(faces.values()),
        },
        "net": {
            "coordinate_system": "xy, x right, y up; outside view; unit edge length",
            "coordinate_decimal_places": 12,
            "strip_left_to_right": strip,
            "top_left_to_right": "--HS--HS--HS",
            "bottom_left_to_right": "--SH--SH--SH",
            "pattern_key": {"S": "square", "H": "hexagon", "-": "unattached strip edge"},
            "bottom_order_note": "Pairs reverse locally, keeping squares opposite on strip faces 2, 4, 6.",
            "assembly": "Fold dashed edges; join equal solid_edge cut labels, matching solid_vertex endpoints.",
            "vertices": list(net_vertices.values()), "edges": list(net_edges.values()),
            "faces": list(net_faces.values()),
        },
        "validation": validation,
    }
    return json.dumps(canonicalize(data), indent=2, allow_nan=False) + "\n"


def validate_svg(svg, polygons, labels=False):
    """Verify ordered, unfilled face polygons and optional centered sector labels."""
    root = et.fromstring(svg)
    namespace = "{http://www.w3.org/2000/svg}"
    require(root.tag == namespace + "svg" and len(root) == (2 if labels else 1),
            "SVG must contain faces and only the requested labels")
    group = root[0]
    require(group.tag == namespace + "g" and group.attrib == {
        "id": "faces", "fill": "none", "stroke": "black", "stroke-width": "1",
    }, "SVG faces must have unfilled black outlines")
    require(Counter(len(points) for points in polygons.values()) == {6: 12, 4: 6},
            "SVG must contain 12 hexagons and 6 squares")
    require(len(group) == 18 and [polygon.get("id") for polygon in group] == list(polygons),
            "SVG face IDs or order do not match the net")
    for polygon in group:
        identifier = polygon.get("id")
        require(polygon.tag == namespace + "polygon" and len(polygon) == 0
                and set(polygon.attrib) == {"id", "points"}, f"SVG face must be a polygon: {identifier}")
        expected_text = " ".join(f"{x:.6f},{y:.6f}" for x, y in polygons[identifier])
        require(polygon.get("points") == expected_text, f"SVG face boundary mismatch: {identifier}")
    if labels:
        labels_by_face = root[1]
        require(labels_by_face.tag == namespace + "g" and labels_by_face.attrib == {
            "id": "labels", "fill": "lightgray", "font-family": "sans-serif",
            "font-size": f"{80.0 / 3.0:.6f}", "text-anchor": "middle",
            "dominant-baseline": "central",
        }, "SVG labels must be centered, light gray, and one third of a square side")
        require(len(labels_by_face) == len(polygons), "SVG must label every face once")
        for label, (identifier, points) in zip(labels_by_face, polygons.items()):
            x, y = center(points)
            require(label.tag == namespace + "text" and len(label) == 1
                    and label.attrib == {
                        "x": f"{x:.6f}", "y": f"{y:.6f}", "data-face": identifier,
                    } and label.text == SECTOR_LABELS[identifier],
                    f"SVG sector label mismatch: {identifier}")
            name = label[0]
            require(name.tag == namespace + "tspan" and len(name) == 0
                    and name.attrib == {
                        "x": f"{x:.6f}", "y": f"{y + 80.0 / 4.0:.6f}",
                        "font-size": f"{80.0 / 8.0:.6f}",
                    } and name.text == SECTOR_NAMES[SECTOR_LABELS[identifier]],
                    f"SVG sector name mismatch: {identifier}")


def serialize_svg(net_vertices, net_faces, labels=False):
    """Render black polygon outlines with optional light-gray sector letters and names."""
    scale, margin = 80.0, 55.0
    points = [vertex["position"] for vertex in net_vertices.values()]
    min_x, max_x = min(point[0] for point in points), max(point[0] for point in points)
    min_y, max_y = min(point[1] for point in points), max(point[1] for point in points)
    width = (max_x - min_x) * scale + 2 * margin
    height = (max_y - min_y) * scale + 2 * margin

    def screen(point):
        """Map a net point to scaled SVG coordinates with downward-positive y."""
        return ((point[0] - min_x) * scale + margin, (max_y - point[1]) * scale + margin)

    polygons = {
        identifier: [screen(net_vertices[vertex_id]["position"]) for vertex_id in face["vertices"]]
        for identifier, face in net_faces.items()
    }
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.6f}" height="{height:.6f}" '
        f'viewBox="0 0 {width:.6f} {height:.6f}">',
        '  <g id="faces" fill="none" stroke="black" stroke-width="1">',
    ]
    for identifier, points in polygons.items():
        point_coordinates = " ".join(f"{x:.6f},{y:.6f}" for x, y in points)
        lines.append(f'    <polygon id="{identifier}" points="{point_coordinates}"/>')
    lines.append('  </g>')
    if labels:
        lines.append(
            '  <g id="labels" fill="lightgray" font-family="sans-serif" '
            f'font-size="{scale / 3.0:.6f}" text-anchor="middle" dominant-baseline="central">'
        )
        for identifier, points in polygons.items():
            x, y = center(points)
            lines.append(
                f'    <text x="{x:.6f}" y="{y:.6f}" data-face="{identifier}">'
                f'{SECTOR_LABELS[identifier]}'
                f'<tspan x="{x:.6f}" y="{y + scale / 4.0:.6f}" '
                f'font-size="{scale / 8.0:.6f}">'
                f'{SECTOR_NAMES[SECTOR_LABELS[identifier]]}</tspan></text>'
            )
        lines.append('  </g>')
    lines.append('</svg>')
    svg = "\n".join(lines) + "\n"
    validate_svg(svg, polygons, labels)
    return svg


def main():
    """Generate validated exports, or verify their exact existing bytes."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "doc")
    parser.add_argument("--check", action="store_true", help="Validate and compare existing exports without writing.")
    parser.add_argument("--labels", action="store_true",
                        help="Label panels with light-gray Greek sector letters and names.")
    args = parser.parse_args()
    vertices, faces, edges = build_solid()
    net_vertices, net_faces, net_edges, strip = build_net(vertices, faces, edges)
    validation = validate(vertices, faces, edges, net_vertices, net_faces, net_edges, strip)
    outputs = {
        "json": serialize_json(vertices, faces, edges, net_vertices, net_faces, net_edges, strip, validation),
        "svg": serialize_svg(net_vertices, net_faces, args.labels),
    }
    data = json.loads(outputs["json"])
    # Check the rounded, exported geometry too, not just the in-memory model.
    validate(
        {vertex["id"]: vertex["position"] for vertex in data["solid"]["vertices"]},
        {face["id"]: face for face in data["solid"]["faces"]},
        {
            edge_key(*edge["vertices"]): {**edge, "vertices": tuple(edge["vertices"])}
            for edge in data["solid"]["edges"]
        },
        {vertex["id"]: vertex for vertex in data["net"]["vertices"]},
        {face["id"]: face for face in data["net"]["faces"]},
        {edge_key(*edge["vertices"]): edge for edge in data["net"]["edges"]},
        data["net"]["strip_left_to_right"],
    )
    if not args.check:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    for extension, content in outputs.items():
        output = args.output_dir / f"{STEM}.{extension}"
        if args.check:
            require(output.is_file() and output.read_bytes() == content.encode("utf-8"),
                    f"Missing or stale export: {output}")
        else:
            output.write_bytes(content.encode("utf-8"))
        print(f"{'Checked' if args.check else 'Wrote'} {output}")
    print("Validated: 18 faces, 32 solid vertices, 48 solid edges, 17 hinges, 31 cut pairs; no overlaps.")


if __name__ == "__main__":
    main()
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



 

