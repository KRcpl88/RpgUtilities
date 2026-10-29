"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { geometry: g, documents: d, editor: local, globalEditor: global, layers, svg } = require("./load-core.cjs");
const projection = { id: "equilateral-chamfered-cube", version: 1, columns: 2 };
const create = options => d.create({ id: "svg-map", kind: "local", scaleFamily: "regional", scale: "S",
  extent: { width: 3, height: 3, origin: [0, 0] }, ...options });
const only = (...names) => Object.fromEntries(Object.keys(svg.defaults).map(key => [key, names.includes(key)]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function paths(source) { return [...source.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(match => match[1]); }
function polygons(data) {
  return [...data.matchAll(/M([^MZ]+)Z/g)].map(match => match[1].split("L").map(pair => {
    const [x, y] = pair.split(",").map(Number); return [x, -y];
  }));
}
function layer(source, name) {
  return source.match(new RegExp(`<g data-layer="${name}"[^>]*>([\\s\\S]*?)<\\/g>`))?.[1] || "";
}
function segments(data) {
  return [...data.matchAll(/M([^MZ]+)(Z?)/g)].flatMap(match => {
    const points = match[1].split("L").map(pair => { const [x, y] = pair.split(",").map(Number); return [x, -y]; });
    if (match[2]) points.push(points[0]);
    return points.slice(1).map((p, i) => [points[i], p]);
  });
}
function covers(data, point) {
  return segments(data).some(([a, b]) => {
    const delta = b.map((v, i) => v - a[i]), size = Math.hypot(...delta), p = point.map((v, i) => v - a[i]);
    const along = (delta[0] * p[0] + delta[1] * p[1]) / size;
    return Math.abs(delta[0] * p[1] - delta[1] * p[0]) / size < 1e-7 && along > -1e-7 && along < size + 1e-7;
  });
}

test("merged terrain rings retain holes, omit internal edges, and export deterministic independent bytes", () => {
  const map = create({ defaultTerrain: "forest" }), before = d.serialize(map);
  const solid = svg.render(map, only("colors", "embellishments", "shorelines"));
  const forest = solid.match(/data-terrain="forest" d="([^"]*)" fill="#/)[1];
  assert.equal(polygons(forest).length, 1);
  near(g.area(polygons(forest)[0]), 9 * Math.sqrt(3) / 2);
  assert.equal(paths(layer(solid, "shorelines")).length, 0, "A local export cut is not an ocean coast");
  assert.doesNotMatch(solid, /data-forest-trunks/);
  assert.equal(svg.render(map, only("colors", "embellishments", "shorelines")), solid);
  assert.equal(d.serialize(map), before);
  map.setTerrain("local", 1, -1, "lakes");
  const hole = svg.render(map, only("colors", "shorelines"));
  const rings = polygons(hole.match(/data-terrain="forest" d="([^"]*)" fill="#/)[1]);
  assert.equal(rings.length, 2);
  near(rings.reduce((sum, ring) => sum + g.area(ring), 0), 8 * Math.sqrt(3) / 2);
  const coast = polygons(paths(layer(hole, "shorelines"))[0]);
  assert.equal(coast.length, 1);
  near(Math.abs(g.area(coast[0])), Math.sqrt(3) / 2);
});

test("global exports retain every owned fragment, including protrusions, on all eighteen panels", () => {
  for (const columns of [2, 4, 24]) {
    const map = d.create({ id: "world-svg", projection: { ...projection, columns } }), world = global.world(map);
    for (const panelId of Object.keys(world.panels)) {
      const source = svg.render(map, { ...only("colors", "shorelines", "grid"), panelId });
      const rings = polygons(source.match(/data-terrain="water" d="([^"]*)" fill="#/)[1]);
      const shapes = [...g.tiles(world, panelId)];
      const expected = shapes.flatMap(shape => shape.fragments).reduce((sum, f) => sum + g.area(f.polygon) / world.spacing ** 2, 0);
      near(rings.reduce((sum, ring) => sum + g.area(ring), 0), expected);
      assert.equal(paths(layer(source, "shorelines")).length, 0);
      const viewBox = source.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
      for (const shape of shapes) for (const fragment of shape.fragments) for (const point of fragment.polygon) {
        assert.ok(point[0] / world.spacing >= viewBox[0] && point[0] / world.spacing <= viewBox[0] + viewBox[2]);
        assert.ok(-point[1] / world.spacing >= viewBox[1] && -point[1] / world.spacing <= viewBox[1] + viewBox[3]);
      }
      if (world.panels[panelId].stripIndex >= 0)
        assert.ok(rings.flat().some(p => Math.abs(p[0]) > world.width / world.spacing / 2), "Owned protrusions must not be cropped to nominal faces");
    }
  }
});

test("shorelines query opposite seam intervals and disappear where land continues across every irregular seam", () => {
  const map = d.create({ id: "coasts", projection }), world = global.world(map);
  let tested = 0;
  for (const edge of g.projection.solid.edges) {
    const [first, second] = edge.faces;
    const cuts = [...new Set([first, second].flatMap(face => g.edgeIntervals(world, edge.id, face).flatMap(part => [part.start, part.end])))].sort((a, b) => a - b);
    const [u, v] = edge.vertices.map(id => g.solidToPanel(world, first, g.projection.solid.vertices.find(vertex => vertex.id === id).position));
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-5) continue;
      const p = u.map((value, axis) => value + (v[axis] - value) * (cuts[i] + cuts[i - 1]) / 2);
      const q = g.seamTransform(world, edge.id, first, p).point;
      const a = g.locateTile(world, first, p), b = g.locateTile(world, second, q);
      if (a.id === b.id) continue;
      const fragment = a.fragments.find(part => part.faceId === first);
      const point = p.map((value, axis) => (value + fragment.offset[axis]) / world.spacing);
      map.setTerrain(a.panelId, a.q, a.r, "forest");
      const options = { ...only("shorelines"), panelId: a.panelId };
      assert.ok(covers(paths(layer(svg.render(map, options), "shorelines")).join(""), point), edge.id + " water side must make a real coast");
      map.setTerrain(b.panelId, b.q, b.r, "plain");
      assert.equal(covers(paths(layer(svg.render(map, options), "shorelines")).join(""), point), false, edge.id + " land continuation is not a coast");
      map.setTerrain(a.panelId, a.q, a.r, "water"); map.setTerrain(b.panelId, b.q, b.r, "water");
      tested++; break;
    }
  }
  assert.equal(tested, 42, "Only the six aligned equatorial seams share canonical tiles on both sides");
});

test("artwork is region-phased, peaks are per tile, and only exposed south forest edges have trunks", () => {
  const map = create({ defaultTerrain: "water", extent: { width: 4, height: 4, origin: [-7.25, 3.5] } });
  map.setTerrain("local", 1, -1, "forest"); map.setTerrain("local", 1, -2, "forest");
  map.setTerrain("local", 3, -1, "mountain-peak"); map.setTerrain("local", 3, -2, "mountain-peak");
  const output = svg.render(map, only("colors", "embellishments"));
  const forest = output.match(/data-terrain="forest" d="([^"]*)" fill="#/)[1];
  assert.equal((output.match(/<pattern id="pattern-forest"/g) || []).length, 1);
  assert.match(output, /patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse"/);
  assert.equal((output.match(/data-peak="true"/g) || []).length, 2);
  assert.doesNotMatch(output, /pattern-water|pattern-plain|pattern-mountain-peak/);
  const trunks = output.match(/data-forest-trunks="true"[^>]*d="([^"]*)"/)[1];
  assert.ok(segments(trunks).length);
  for (const [a, b] of segments(trunks)) {
    near(a[0], b[0]); near(a[1] - b[1], .11);
    assert.ok(covers(forest, [b[0], b[1] - .01]), "Trunks must meet an exposed forest boundary, not an internal tile edge");
  }
});

test("islands have internal land silhouettes and shorelines rather than coasts around their water tiles", () => {
  const map = create({ defaultTerrain: "islands", extent: { width: 1, height: 1, origin: [0, 0] } });
  const output = svg.render(map, only("colors", "shorelines"));
  const islands = polygons(output.match(/data-island-land="true" d="([^"]*)"/)[1]);
  const shores = polygons(paths(layer(output, "shorelines"))[0]);
  assert.deepEqual(shores, islands);
  assert.equal(islands.length, 2);
  for (const point of islands.flat()) assert.ok(g.inside(g.hexPolygon({ origin: [0, 0], spacing: 1 }, 0, 0), point));
  assert.ok(islands.reduce((sum, polygon) => sum + g.area(polygon), 0) < .4);
  const archipelago = create({ defaultTerrain: "islands", extent: { width: 8, height: 8, origin: [0, 0] } });
  const shapes = polygons(svg.render(archipelago, only("colors")).match(/data-island-land="true" d="([^"]*)"/)[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < shapes.length; i += 2) {
    const [a, b] = shapes.slice(i, i + 2);
    for (let j = 0; j < a.length; j++) for (let k = 0; k < b.length; k++) {
      const [p, q, r, s] = [a[j], a[(j + 1) % a.length], b[k], b[(k + 1) % b.length]];
      assert.equal(cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0,
        false, "Island silhouettes must not overlap and create false internal coastlines");
    }
  }
});

test("each layer option is independent and export leaves terrain, layers, and save history unchanged", () => {
  const map = create({ defaultTerrain: "hills" }), session = local.createSession(map, { saved: true });
  const tile = { panelId: "local", q: 1, r: -1 };
  for (const type of ["road", "trail", "river"]) map.putPath({ id: type, type, points: [map.tilePosition(tile), map.tilePosition({ ...tile, q: 2 })] });
  map.putLandmark({ id: "town", type: "town", tile });
  map.putLabel({ id: "text", text: "Port", tile, size: 12, rotation: 20 });
  const before = d.serialize(map), all = Object.fromEntries(Object.keys(svg.defaults).map(key => [key, true]));
  for (const name of Object.keys(all)) {
    const output = svg.render(map, { ...all, [name]: false });
    assert.doesNotMatch(output, new RegExp(`data-layer="${name}"`));
    for (const other of Object.keys(all).filter(key => key !== name)) assert.match(output, new RegExp(`data-layer="${other}"`));
  }
  const empty = svg.render(map, only());
  assert.doesNotMatch(empty, /data-layer=|<pattern|<text /);
  assert.equal(d.serialize(map), before);
  assert.equal(session.dirty, false); assert.equal(session.canUndo, false);
});

test("SVG text is escaped literally, invalid XML characters fail explicitly, and omitted labels are not evaluated", () => {
  const map = create({ name: 'Title <&> "\u03b1"' }), tile = { panelId: "local", q: 1, r: -1 };
  map.putLabel({ id: "safe", tile, text: '<script> & "Caf\u00e9"\n\ud83c\udff0', size: 18, rotation: 33, offset: [.2, -.1] });
  const output = svg.render(map, only("labels"));
  assert.match(output, /&lt;script&gt; &amp; &quot;Caf\u00e9&quot;/);
  assert.match(output, /rotate\(33\)/);
  assert.equal((output.match(/<tspan /g) || []).length, 2);
  assert.doesNotMatch(output, /<script|<foreignObject|https?:\/\/(?!www.w3.org\/2000\/svg)/);
  map.putLabel({ id: "bad", tile, text: "Invalid \u0001", size: 12, rotation: 0 });
  const before = d.serialize(map);
  assert.throws(() => svg.render(map), /XML 1.0/);
  assert.doesNotThrow(() => svg.render(map, only("colors")));
  assert.equal(d.serialize(map), before);
});

test("all terrain and landmark styles render with bounded failures for oversized or invalid exports", () => {
  const map = create({ extent: { width: 17, height: 2, origin: [0, 0] } });
  d.TERRAINS.forEach((terrain, q) => map.setTerrain("local", q, -Math.floor(q / 2), terrain.id));
  d.LANDMARK_TYPES.forEach((type, q) => map.putLandmark({ id: type, type, tile: { panelId: "local", q, r: -1 - Math.floor(q / 2) } }));
  const output = svg.render(map);
  for (const terrain of d.TERRAINS) assert.match(output, new RegExp(`data-terrain="${terrain.id}"`));
  for (const type of d.LANDMARK_TYPES) assert.match(output, new RegExp(`data-landmark="${type}"`));
  assert.throws(() => svg.render(map, { colors: "yes" }), /must be boolean/);
  assert.throws(() => svg.render(map, { panelId: "Sz-" }), /valid SVG export panel/);
  assert.throws(() => svg.render(map, { externalFont: "url" }), /Unknown SVG/);
  const huge = create({ extent: { width: 1e6, height: 1e6, origin: [0, 0] } });
  assert.throws(() => svg.render(huge), /25,000 tiles/);
  const globe = d.create({ id: "huge", scale: "S", projection: { ...projection, columns: 24000 } });
  assert.throws(() => svg.render(globe), /tile budget/);
});

test("mosaics retain exact terrain coverage and identical exports regardless of edit insertion order", () => {
  const options = { id: "mosaic", projection: { ...projection, columns: 4 } };
  const map = d.create(options), reversed = d.create(options), world = global.world(map), edits = [];
  for (const panelId of Object.keys(world.panels)) for (const shape of g.tiles(world, panelId))
    edits.push([panelId, shape.q, shape.r, d.TERRAINS[Math.abs(shape.q * 11 + shape.r * 13) % d.TERRAINS.length].id]);
  for (const edit of edits) map.setTerrain(...edit);
  for (const edit of [...edits].reverse()) reversed.setTerrain(...edit);
  for (const panelId of Object.keys(world.panels)) {
    const output = svg.render(map, { panelId });
    assert.equal(output, svg.render(reversed, { panelId }));
    const areas = new Map();
    for (const shape of g.tiles(world, panelId)) {
      const terrain = map.terrainAt(panelId, shape.q, shape.r);
      areas.set(terrain, (areas.get(terrain) || 0) + shape.fragments.reduce((sum, f) => sum + g.area(f.polygon) / world.spacing ** 2, 0));
    }
    for (const [terrain, area] of areas) {
      const data = output.match(new RegExp(`data-terrain="${terrain}" d="([^"]*)" fill="#`))[1];
      near(polygons(data).reduce((sum, polygon) => sum + g.area(polygon), 0), area);
    }
  }
});

test("uniform global forest has neither false coasts nor trunks at any panel cut", () => {
  const map = d.create({ id: "forest-world", defaultTerrain: "forest", projection });
  for (const panelId of Object.keys(g.SECTORS)) {
    const output = svg.render(map, { panelId });
    assert.equal(paths(layer(output, "shorelines")).length, 0);
    assert.doesNotMatch(output, /data-forest-trunks/);
  }
});

test("normalized geometry and text sizing are consistent across both scale families and negative origins", () => {
  let geometry;
  for (const scaleFamily of ["local", "regional"]) for (const scale of ["S", "M", "L", "XL"]) {
    const map = create({ scaleFamily, scale, extent: { width: 3, height: 3, origin: [-7.25, 3.5] } });
    const grid = local.grid(map), tile = { panelId: "local", q: 1, r: -1 };
    map.putLabel({ id: "size", text: "Text", size: 12, rotation: 30, tile, offset: [grid.spacing / 4, -grid.spacing / 5] });
    const source = svg.render(map, only("colors", "labels", "grid"));
    const outline = source.match(/data-terrain="plain" d="([^"]*)"/)[1];
    if (geometry) assert.equal(outline, geometry); else geometry = outline;
    const position = source.match(/data-id="size" transform="translate\(([^)]+)\) rotate\(30\)" font-size="([^"]*)"/);
    near(Number(position[1].split(",")[0]), Math.sqrt(3) / 2 + .25);
    near(Number(position[1].split(",")[1]), .7);
    near(Number(position[2]), .5);
  }
});

test("export processing and UTF-8 output budgets fail explicitly without changing the map", () => {
  const map = create({ extent: { width: 1, height: 1, origin: [0, 0] } }), tile = { panelId: "local", q: 0, r: 0 };
  for (let i = 0; i < 350; i++) map.putLabel({ id: "label-" + i, tile, text: "&".repeat(10000), size: 12, rotation: 0 });
  const before = d.serialize(map);
  assert.throws(() => svg.render(map, only("labels")), /16 MiB output/);
  assert.equal(d.serialize(map), before);
  const point = map.tilePosition(tile);
  for (let i = 0; i < 5; i++) map.putPath({ id: "long-" + i, type: "road", points: Array.from({ length: 100000 }, (_, i) =>
    ({ ...point, east: point.east + (i % 2 ? .1 : 0) })) });
  assert.throws(() => svg.render(map, only("roads")), /500,000-operation/);
});
