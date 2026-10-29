"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { geometry: g } = require("./load-core.cjs");

const root = path.join(__dirname, "..");
const reference = JSON.parse(readFileSync(path.join(root, "doc", "equilateral-chamfered-cube.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = a => Math.hypot(...a);
const mean = points => mul(points.reduce(add), 1 / points.length);
const vertices = Object.fromEntries(g.projection.solid.vertices.map(v => [v.id, v.position]));
const eq = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const near = (actual, expected, tolerance) => actual.forEach((v, i) => eq(v, expected[i], tolerance));
const world = g.createWorld();

test("native construction agrees with the independent supplied Python reference", () => {
  for (const section of ["solid", "net"]) {
    assert.equal(g.projection[section].vertices.length, reference[section].vertices.length);
    for (const actual of g.projection[section].vertices) {
      const expected = reference[section].vertices.find(v => v.id === actual.id);
      near(actual.position, expected.position, 2e-12);
      assert.equal(actual.solid_vertex, expected.solid_vertex);
    }
    for (const key of ["faces", "edges"]) {
      for (const actual of g.projection[section][key]) {
        const expected = reference[section][key].find(item => item.id === actual.id);
        for (const field of Object.keys(actual)) {
          if (field === "normal") near(actual[field], expected[field], 2e-12);
          else assert.deepEqual(plain(actual[field]), expected[field], `${section}.${key}.${actual.id}.${field}`);
        }
      }
    }
  }
  assert.deepEqual(plain(g.projection.net.strip_left_to_right), reference.net.strip_left_to_right);
});

test("solid and net have the required manifold topology, lengths, angles, and winding", () => {
  const { solid, net } = g.projection;
  assert.equal(solid.vertices.length - solid.edges.length + solid.faces.length, 2);
  assert.equal(net.vertices.length - net.edges.length + net.faces.length, 1);
  assert.equal(net.edges.filter(e => e.kind === "fold").length, 17);
  assert.equal(net.edges.filter(e => e.kind === "cut").length, 62);
  for (const edge of solid.edges) {
    assert.equal(edge.faces.length, 2);
    eq(norm(sub(vertices[edge.vertices[0]], vertices[edge.vertices[1]])), 1);
  }
  const flat = Object.fromEntries(net.vertices.map(v => [v.id, v.position]));
  for (const face of solid.faces) {
    const netFace = net.faces.find(f => f.id === face.id);
    assert.ok(g.area(netFace.vertices.map(v => flat[v])) > 0);
    face.vertices.forEach((vertex, i) => {
      const p = vertices[vertex];
      const a = sub(vertices[face.vertices[(i + face.vertices.length - 1) % face.vertices.length]], p);
      const b = sub(vertices[face.vertices[(i + 1) % face.vertices.length]], p);
      const angle = Math.acos(dot(a, b) / norm(a) / norm(b)) * 180 / Math.PI;
      const expected = face.kind === "square" ? 90 : Number(vertex.slice(1)) <= 8 ?
        Math.acos(-1 / 3) * 180 / Math.PI : (360 - Math.acos(-1 / 3) * 180 / Math.PI) / 2;
      eq(angle, expected);
    });
  }
  for (const edge of net.edges.filter(e => e.kind === "cut")) {
    const mate = net.edges.find(e => e.id === edge.mate);
    assert.equal(mate.mate, edge.id);
    assert.equal(mate.solid_edge, edge.solid_edge);
  }
  for (let i = 0; i < net.faces.length; i++) for (let j = i + 1; j < net.faces.length; j++) {
    const overlap = g.clip(net.faces[i].vertices.map(v => flat[v]), net.faces[j].vertices.map(v => flat[v]));
    eq(g.area(overlap), 0);
  }
});

test("all named sectors retain the specified neighbors", () => {
  const expected = {
    Nu: ["Eta", "Theta", "Alpha", "Beta"], Xi: ["Theta", "Iota", "Gamma", "Delta"],
    Omicron: ["Iota", "Eta", "Epsilon", "Zeta"], Pi: ["Kappa", "Lambda", "Beta", "Gamma"],
    Rho: ["Lambda", "Mu", "Delta", "Epsilon"], Sigma: ["Kappa", "Mu", "Zeta", "Alpha"]
  };
  for (const [name, names] of Object.entries(expected)) {
    const face = Object.values(world.panels).find(f => f.name === name);
    const neighbors = g.projection.solid.edges.filter(e => e.faces.includes(face.id))
      .map(e => world.panels[e.faces.find(f => f !== face.id)].name);
    assert.deepEqual(plain(neighbors.sort()), names.sort());
  }
});

test("panel frames reproduce every solid/net vertex and preserve round-trips", () => {
  const flat = Object.fromEntries(g.projection.net.vertices.map(v => [v.id, v.position]));
  for (const face of Object.values(world.panels)) {
    eq(norm(face.north), 1); eq(norm(face.east), 1); eq(dot(face.north, face.east), 0);
    const netFace = g.projection.net.faces.find(f => f.id === face.id);
    face.vertices.forEach((vertex, i) => {
      const local = face.polygon[i];
      near(g.panelToSolid(world, face.id, local), vertices[vertex]);
      near(g.solidToPanel(world, face.id, vertices[vertex]), local);
      near(g.panelToNet(world, face.id, local), flat[netFace.vertices[i]]);
      near(g.netToPanel(world, face.id, flat[netFace.vertices[i]]), local);
    });
    for (const p of [[0, 0], [317, -123], [-0.125, 64]]) {
      near(g.solidToPanel(world, face.id, g.panelToSolid(world, face.id, p)), p);
      near(g.netToPanel(world, face.id, g.panelToNet(world, face.id, p)), p);
    }
    if (face.stripIndex < 0) {
      const northVertex = face.polygon.reduce((a, b) => a[1] > b[1] ? a : b);
      eq(northVertex[0], 0);
      eq(g.hexCenter(g.gridFor(world, face.id), 0, 2)[0], 0);
    }
  }
});

test("all 48 seam transforms match endpoints and round-trip off-edge coordinates", () => {
  for (const edge of g.projection.solid.edges) {
    for (const from of edge.faces) {
      for (const vertex of edge.vertices) {
        const p = g.solidToPanel(world, from, vertices[vertex]);
        const other = g.seamTransform(world, edge.id, from, p);
        near(g.panelToSolid(world, other.faceId, other.point), vertices[vertex]);
      }
      const p = [125.25, -373.5];
      const other = g.seamTransform(world, edge.id, from, p);
      near(g.seamTransform(world, edge.id, other.faceId, other.point).point, p);
    }
  }
});

test("hex coordinates round-trip at negative positions and all requested spacings", () => {
  for (const spacing of [...Object.values(g.REGIONAL), ...Object.values(g.LOCAL)]) {
    const grid = { spacing, origin: [-13.25, 7.5] };
    for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) {
      const center = g.hexCenter(grid, q, r);
      assert.deepEqual(plain(g.hexAt(grid, center)), [q, r]);
      eq(g.area(g.hexPolygon(grid, q, r)), Math.sqrt(3) / 2 * spacing ** 2, 1e-7);
    }
    const first = g.hexCenter(grid, -2, 3), next = g.hexCenter(grid, -1, 3);
    eq(norm(sub(first, next)), spacing);
    const midpoint = mul(add(first, next), .5);
    assert.deepEqual(plain(g.hexAt(grid, midpoint)), [-2, 3]);
  }
});

test("convex clipping retains partial cells and excludes outside or zero-area cells", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  eq(g.area(g.clip([[-5, 2], [5, 2], [5, 8], [-5, 8]], square)), 30);
  assert.equal(g.clip([[-5, 2], [-1, 2], [-1, 8], [-5, 8]], square).length, 0);
  assert.equal(g.clip([[-5, 2], [0, 2], [0, 8], [-5, 8]], square).length, 0);
  eq(g.area(g.clip(square, square)), 100);
});

for (const columns of [2, 4, 24]) {
  test(`owned fragments partition every nominal face at N=${columns}, including seam corners`, () => {
    const map = g.createWorld({ columns });
    const coverage = Object.fromEntries(Object.keys(map.panels).map(id => [id, 0]));
    const seen = new Set();
    let partial = 0, outsideCenters = 0, crossing = 0;
    for (const face of Object.values(map.panels)) {
      for (const tile of g.tiles(map, face.id)) {
        assert.ok(!seen.has(tile.id)); seen.add(tile.id);
        const tileArea = tile.fragments.reduce((sum, fragment) => sum + g.area(fragment.polygon), 0);
        assert.ok(tileArea <= g.area(tile.hex) + 1e-6);
        if (tileArea < g.area(tile.hex) - 1e-6) partial++;
        if (!g.inside(face.polygon, tile.center)) outsideCenters++;
        if (tile.fragments.length > 1) crossing++;
        for (const fragment of tile.fragments) {
          coverage[fragment.faceId] += g.area(fragment.polygon);
          const geometric = fragment.polygon.map(p => sub(p, fragment.offset));
          assert.ok(geometric.every(p => g.inside(map.panels[fragment.faceId].polygon, p)));
          const middle = mean(geometric);
          if (g.area(geometric) > 1e-6) {
            const found = g.locateTile(map, fragment.faceId, middle);
            assert.equal(found.id, tile.id, `${tile.id} fragment in ${fragment.faceId}`);
          }
        }
      }
    }
    for (const face of Object.values(map.panels))
      eq(coverage[face.id], g.area(face.polygon), 1e-5);
    assert.ok(partial > 0 && outsideCenters > 0 && crossing > 0);
  });
}

test("equatorial seam hexes keep full area, have one owner, and close the periodic lattice", () => {
  eq(world.width, 4489.47569321853);
  for (const faceId of world.strip) {
    const face = world.panels[faceId], grid = g.gridFor(world, faceId);
    assert.equal(world.count % 2, 0);
    for (let q = 0; q < world.count; q++) assert.notEqual(g.hexCenter(grid, q, 0)[0], 0);
    const tile = g.tileGeometry(world, faceId, 0, 0);
    assert.equal(tile.fragments.length, 2);
    eq(tile.fragments.reduce((sum, f) => sum + g.area(f.polygon), 0), g.area(tile.hex), 1e-6);
    const west = world.strip[(face.stripIndex + 5) % 6];
    for (const y of [-500, -123, 0, 55, 500]) {
      const fromEast = g.locateTile(world, faceId, [-world.width / 2, y]);
      const fromWest = g.locateTile(world, west, [world.width / 2, y]);
      assert.equal(fromEast.id, fromWest.id);
    }
  }
});

test("all seam intervals cover their edge and support one-to-many partial-tile neighbors", () => {
  let multiNeighbor = false, equatorialSeams = 0;
  for (const edge of g.projection.solid.edges) {
    const sides = edge.faces.map(face => g.edgeIntervals(world, edge.id, face));
    for (const side of sides) {
      eq(side[0].start, 0); eq(side.at(-1).end, 1);
      side.forEach((interval, i) => {
        assert.ok(interval.end > interval.start);
        assert.ok(interval.tile.fragments.length > 0);
        if (i) eq(interval.start, side[i - 1].end);
      });
    }
    const neighbors = g.seamNeighbors(world, edge.id);
    if (edge.faces.every(face => world.panels[face].stripIndex >= 0)) {
      equatorialSeams++;
      assert.equal(neighbors.length, 0, "A shared owned hex is not its own neighbor.");
      assert.deepEqual(sides[0].map(i => i.tile.id), sides[1].map(i => i.tile.id));
    } else {
      eq(neighbors.reduce((sum, item) => sum + item.end - item.start, 0), 1);
      const byFrom = new Map();
      for (const neighbor of neighbors) {
        if (!byFrom.has(neighbor.from)) byFrom.set(neighbor.from, new Set());
        byFrom.get(neighbor.from).add(neighbor.to);
      }
      if ([...byFrom.values()].some(set => set.size > 1)) multiNeighbor = true;
    }
  }
  assert.equal(equatorialSeams, 6);
  assert.ok(multiNeighbor);
});

test("tile neighbors cross the periodic ownership boundary and remain reciprocal", () => {
  for (const faceId of world.strip) {
    const tile = g.tileGeometry(world, faceId, 0, 0);
    const neighbors = g.neighbors(world, tile);
    assert.equal(neighbors.length, 6);
    assert.ok(neighbors.some(other => other.panelId !== faceId));
    for (const other of neighbors)
      assert.ok(g.neighbors(world, other).some(back => back.id === tile.id));
  }
  for (const edge of g.projection.solid.edges) {
    for (const pair of g.seamNeighbors(world, edge.id).slice(0, 2)) {
      const readTile = id => {
        const [faceId, , q, r] = id.split(":");
        return g.tileGeometry(world, faceId, Number(q), Number(r));
      };
      assert.ok(g.neighbors(world, readTile(pair.from)).some(tile => tile.id === pair.to));
      assert.ok(g.neighbors(world, readTile(pair.to)).some(tile => tile.id === pair.from));
    }
  }
});

test("fine-scale grids can enumerate only a viewport without allocating a globe", () => {
  for (const scale of ["S", "M", "L", "XL"]) {
    const map = g.createWorld({ scale });
    assert.equal(map.count, 24 * 216 / g.REGIONAL[scale]);
    const d = map.spacing, face = "Hxz+-";
    const selected = [...g.tiles(map, face, { minX: -d, maxX: d, minY: -d, maxY: d })];
    assert.ok(selected.length > 0 && selected.length < 30);
    for (const tile of selected) assert.equal(g.locateTile(map, face, tile.center).id, tile.id);
  }
  assert.equal([...g.tiles(world, "Hxz+-", { minX: 1e8, maxX: 1e9, minY: 0, maxY: 1 })].length, 0);
});

test("radial spherical transforms preserve panel points and the specified poles/meridian", () => {
  for (const face of Object.values(world.panels)) {
    const local = mul(face.polygon[0], .37);
    const coordinates = g.toLatLon(world, face.id, local);
    const inverse = g.fromLatLon(world, coordinates.latitude, coordinates.longitude);
    assert.equal(inverse.faceId, face.id);
    near(inverse.point, local);
    assert.ok(Number.isFinite(g.trueNorthHeading(world, face.id, local)));
  }
  for (const latitude of [-90, 90]) {
    const location = g.fromLatLon(world, latitude, 0);
    const back = g.toLatLon(world, location.faceId, location.point);
    eq(back.latitude, latitude, 2e-6);
    assert.equal(back.longitude, null);
    assert.equal(g.trueNorthHeading(world, location.faceId, location.point), null);
    assert.ok(g.locateTile(world, location.faceId, location.point).fragments.length);
  }
  const eta = world.panels["Hxz+-"];
  const opposite = eta.polygon.reduce((a, b) => a[1] < b[1] ? a : b);
  eq(g.toLatLon(world, eta.id, mul(opposite, .5)).longitude, 0);
});

test("three-face vertices have deterministic spherical face ownership", () => {
  for (const vertex of g.projection.solid.vertices) {
    const faces = g.projection.solid.faces.filter(face => face.vertices.includes(vertex.id));
    assert.equal(faces.length, 3);
    const answers = faces.map(face => {
      const p = g.solidToPanel(world, face.id, vertex.position);
      const ll = g.toLatLon(world, face.id, p);
      const location = g.fromLatLon(world, ll.latitude, ll.longitude ?? 0);
      return g.locateTile(world, location.faceId, location.point).id;
    });
    assert.ok(answers.every(answer => answer === answers[0]));
  }
});

test("invalid geometry input fails explicitly", () => {
  for (const columns of [0, -2, 1, 3, 2.5, Infinity, NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => g.createWorld({ columns }), /width/);
  for (const scale of ["bogus", "__proto__", "toString"]) assert.throws(() => g.createWorld({ scale }), /scale/);
  assert.throws(() => g.gridFor(world, "__proto__"), /panel/);
  assert.throws(() => g.locateTile(world, "Hxz+-", [1e9, 0]), /outside/);
  assert.throws(() => g.hexCenter({ spacing: 0, origin: [0, 0] }, 0, 0), /spacing/);
  assert.throws(() => g.hexAt({ spacing: 1, origin: [0, 0] }, [NaN, 0]), /finite/);
  assert.throws(() => g.tileGeometry(world, world.strip[0], -1, 0), /column/);
  assert.throws(() => g.seamTransform(world, "missing", "Hxz+-", [0, 0]), /incident/);
  assert.throws(() => g.edgeIntervals(world, "missing", "Hxz+-"), /incident/);
  assert.throws(() => g.fromLatLon(world, 91, 0), /latitude/);
});
