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
import sys
import xml.etree.ElementTree as et


TOLERANCE = 1e-9
ACUTE_ANGLE = math.degrees(math.acos(-1.0 / 3.0))
OBTUSE_ANGLE = (360.0 - ACUTE_ANGLE) / 2.0
STEM = "equilateral-chamfered-cube"

# SVG layout: 80 SVG units per unit edge, with a margin around the net.
SVG_SCALE = 80.0
SVG_MARGIN = 20.0
SVG_DECIMALS = 6
SVG_LETTER_SIZE = SVG_SCALE / 3.0
SVG_NAME_SIZE = SVG_LETTER_SIZE / 2.5
SVG_LABEL_COLOR = "#c0c0c0"
SVG_NAMESPACE = "http://www.w3.org/2000/svg"

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


def net_polygons(net_vertices, net_faces):
    """Return each net face's ordered boundary positions keyed by face ID."""
    return {
        identifier: [net_vertices[vertex_id]["position"] for vertex_id in face["vertices"]]
        for identifier, face in net_faces.items()
    }


def svg_frame(polygons):
    """Return the SVG canvas size and a net-to-SVG mapping that reverses y."""
    points = [point for polygon in polygons.values() for point in polygon]
    min_x = min(point[0] for point in points)
    max_x = max(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_y = max(point[1] for point in points)
    width = (max_x - min_x) * SVG_SCALE + 2.0 * SVG_MARGIN
    height = (max_y - min_y) * SVG_SCALE + 2.0 * SVG_MARGIN

    def to_svg(point):
        """Map a net point in edge units to SVG user units."""
        return (
            (point[0] - min_x) * SVG_SCALE + SVG_MARGIN,
            (max_y - point[1]) * SVG_SCALE + SVG_MARGIN,
        )

    return width, height, to_svg


def format_number(value):
    """Format an SVG number with fixed precision, no trailing zeros or signed zero."""
    text = f"{value:.{SVG_DECIMALS}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def serialize_svg(net_vertices, net_faces, labels=False):
    """Render the net as unfilled outlined polygons with optional sector labels."""
    polygons = net_polygons(net_vertices, net_faces)
    width, height, to_svg = svg_frame(polygons)
    width_text, height_text = format_number(width), format_number(height)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="{SVG_NAMESPACE}" width="{width_text}" height="{height_text}" '
        f'viewBox="0 0 {width_text} {height_text}">',
        '  <g id="faces" fill="none" stroke="#000000" stroke-width="1" stroke-linejoin="round">',
    ]
    for identifier, polygon in polygons.items():
        point_coordinates = " ".join(
            f"{format_number(svg_point[0])},{format_number(svg_point[1])}"
            for svg_point in map(to_svg, polygon)
        )
        lines.append(f'    <polygon id="{identifier}" points="{point_coordinates}"/>')
    lines.append("  </g>")
    if labels:
        lines.append(
            f'  <g id="labels" fill="{SVG_LABEL_COLOR}" font-family="serif" '
            'text-anchor="middle" dominant-baseline="central">'
        )
        for identifier, polygon in polygons.items():
            letter_text = SECTOR_LABELS[identifier]
            x, y = to_svg(center(polygon))
            name_y = y + 0.5 * SVG_LETTER_SIZE + 0.75 * SVG_NAME_SIZE
            lines.append(
                f'    <text class="sector" data-face="{identifier}" x="{format_number(x)}" '
                f'y="{format_number(y)}" font-size="{format_number(SVG_LETTER_SIZE)}">'
                f"{letter_text}</text>"
            )
            lines.append(
                f'    <text class="sector-name" data-face="{identifier}" x="{format_number(x)}" '
                f'y="{format_number(name_y)}" font-size="{format_number(SVG_NAME_SIZE)}">'
                f"{SECTOR_NAMES[letter_text]}</text>"
            )
        lines.append("  </g>")
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def validate_svg(svg, polygons, labels=False):
    """Verify ordered, unfilled face polygons and optional centered sector labels."""
    root = et.fromstring(svg)
    namespace = f"{{{SVG_NAMESPACE}}}"
    require(root.tag == f"{namespace}svg", "SVG root element")
    width, height, to_svg = svg_frame(polygons)
    slack = 10.0 ** -SVG_DECIMALS
    require(abs(float(root.get("width")) - width) <= slack
            and abs(float(root.get("height")) - height) <= slack, "SVG canvas size")
    require(not root.findall(f".//{namespace}circle"), "SVG must not contain vertex markers")
    groups = {group.get("id"): group for group in root.findall(f"{namespace}g")}
    face_group = groups.get("faces")
    require(face_group is not None, "SVG face group missing")
    require(face_group.get("fill") == "none" and face_group.get("stroke") == "#000000",
            "SVG faces must be unfilled with black outlines")
    elements = face_group.findall(f"{namespace}polygon")
    require([element.get("id") for element in elements] == list(polygons),
            "SVG polygons must follow the JSON face order")
    for element in elements:
        require(element.get("fill") is None, f"SVG polygon must inherit no fill: {element.get('id')}")
        actual = [
            tuple(float(value_text) for value_text in pair.split(","))
            for pair in element.get("points").split()
        ]
        expected = [to_svg(point) for point in polygons[element.get("id")]]
        require(len(actual) == len(expected) and all(
            math.dist(actual_point, expected_point) <= slack
            for actual_point, expected_point in zip(actual, expected)
        ), f"SVG polygon geometry: {element.get('id')}")
    texts = root.findall(f".//{namespace}text")
    if not labels:
        require("labels" not in groups and not texts, "Unlabeled SVG must not contain text")
        return
    label_group = groups.get("labels")
    require(label_group is not None, "SVG label group missing")
    require(label_group.get("text-anchor") == "middle"
            and label_group.get("dominant-baseline") == "central", "SVG labels must be centered")
    letters = [text for text in texts if text.get("class") == "sector"]
    names = [text for text in texts if text.get("class") == "sector-name"]
    require([text.get("data-face") for text in letters] == list(polygons)
            and [text.get("data-face") for text in names] == list(polygons),
            "SVG labels must follow the JSON face order")
    for letter, name in zip(letters, names):
        identifier = letter.get("data-face")
        x, y = to_svg(center(polygons[identifier]))
        require(letter.text == SECTOR_LABELS[identifier] and name.text == SECTOR_NAMES[letter.text],
                f"SVG label text: {identifier}")
        require(abs(float(letter.get("x")) - x) <= slack
                and abs(float(letter.get("y")) - y) <= slack, f"SVG label position: {identifier}")
        require(abs(float(letter.get("font-size")) - SVG_SCALE / 3.0) <= slack,
                f"SVG label size: {identifier}")
        require(abs(float(name.get("x")) - x) <= slack and float(name.get("y")) > y
                and float(name.get("font-size")) < float(letter.get("font-size")),
                f"SVG sector name placement: {identifier}")


def parse_arguments(arguments):
    """Parse command-line options for output selection and verification."""
    parser = argparse.ArgumentParser(
        description="Generate the equilateral chamfered cube net as SVG and JSON."
    )
    parser.add_argument("--labels", action="store_true",
                        help="add Greek sector letters and names to the SVG")
    parser.add_argument("--check", action="store_true",
                        help="validate and verify that existing exports are reproducible")
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parent.parent / "doc",
                        help="directory for the exports (default: the repository's doc/)")
    return parser.parse_args(arguments)


def main(arguments=None):
    """Build, validate, and either write or verify the SVG and JSON exports."""
    options = parse_arguments(arguments)
    vertices, faces, edges = build_solid()
    net_vertices, net_faces, net_edges, strip = build_net(vertices, faces, edges)
    validation = validate(vertices, faces, edges, net_vertices, net_faces, net_edges, strip)
    outputs = {
        options.output_dir / f"{STEM}.json": serialize_json(
            vertices, faces, edges, net_vertices, net_faces, net_edges, strip, validation
        ),
        options.output_dir / f"{STEM}.svg": serialize_svg(
            net_vertices, net_faces, options.labels
        ),
    }
    validate_svg(outputs[options.output_dir / f"{STEM}.svg"],
                net_polygons(net_vertices, net_faces), options.labels)
    if options.check:
        for output_path, expected_text in outputs.items():
            require(output_path.is_file(), f"Missing export: {output_path}")
            require(output_path.read_text(encoding="utf-8") == expected_text,
                    f"Export is not reproducible: {output_path}")
        print(f"Geometry valid; exports reproduce exactly in {options.output_dir}")
        return 0
    options.output_dir.mkdir(parents=True, exist_ok=True)
    for output_path, text in outputs.items():
        with open(output_path, "w", encoding="utf-8", newline="\n") as file:
            file.write(text)
        print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
