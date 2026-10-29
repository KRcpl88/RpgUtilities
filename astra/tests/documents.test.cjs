"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { geometry: g, documents: d } = require("./load-core.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const projection = { id: "equilateral-chamfered-cube", version: 1, columns: 2 };
const local = options => d.create({ id: "local-test", kind: "local", ...options });
const global = options => d.create({ id: "world-test", projection, ...options });
const tile = (q = 0, r = 0, panelId = "local") => ({ panelId, q, r });
const label = (id = "label-1", anchor = tile()) => ({
  id, tile: anchor, text: "Port \u03b1 \ud83c\udff0\n<&>\"\\\u0001", size: 12.5, rotation: -35, offset: [0.001, -0.002]
});
const roundTrip = document => {
  const encoded = d.serialize(document), decoded = d.parse(encoded);
  assert.ok(/^[\x00-\x7f]*$/.test(encoded), "Output must be ASCII.");
  assert.equal(d.serialize(decoded), encoded);
  assert.deepEqual(plain(decoded.metadata), plain(document.metadata));
  for (const layer of ["paths", "landmarks", "labels"]) assert.deepEqual(plain(decoded[layer]), plain(document[layer]));
  return decoded;
};
const fixture = name => readFileSync(path.join(__dirname, "fixtures", `${name}.hexmap`), "utf8");
function replaceRecord(source, section, transform) {
  const lines = source.split("\n"), index = lines.indexOf(`[${section}]`) + 1;
  assert.ok(index > 0);
  lines[index] = JSON.stringify(transform(JSON.parse(lines[index]))).replace(/[\u007f-\uffff]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  return lines.join("\n");
}
function assertFormatError(source, pattern, line) {
  assert.throws(() => d.parse(source), failure => {
    assert.ok(failure instanceof d.MapFormatError, failure);
    assert.match(failure.message, pattern);
    assert.equal(failure.line, line);
    return true;
  });
}

test("terrain catalog round-trips all 17 distinct codes without mixing layers", () => {
  const document = local({ extent: { width: 6, height: 3, origin: [-0.25, 0.75] }, scale: "M" });
  assert.equal(d.TERRAINS.length, 17);
  assert.equal(new Set(d.TERRAINS.map(t => t.id)).size, 17);
  assert.equal(new Set(d.TERRAINS.map(t => t.code)).size, 17);
  d.TERRAINS.forEach((terrain, index) => {
    assert.match(terrain.code, /^[\x21-\x7e]$/);
    assert.notEqual(terrain.code, "_");
    const q = index % 6, r = -Math.floor(index / 6) - Math.floor(q / 2);
    document.setTerrain("local", q, r, terrain.id);
  });
  document.putLandmark({ id: "city-1", type: "city", tile: tile() });
  document.putLabel(label());
  document.setTerrain("local", 0, 0, "forest");
  assert.equal(document.landmarks.length, 1);
  assert.equal(document.labels.length, 1);
  const loaded = roundTrip(document);
  assert.equal(loaded.terrainAt("local", 0, 0), "forest");
  d.TERRAINS.slice(1).forEach((terrain, index) => {
    const n = index + 1, q = n % 6, r = -Math.floor(n / 6) - Math.floor(q / 2);
    assert.equal(loaded.terrainAt("local", q, r), terrain.id);
  });
});

test("all local and regional resolutions have explicit units and immutable metadata", () => {
  for (const family of ["local", "regional"]) for (const scale of ["S", "M", "L", "XL"]) {
    const options = { scaleFamily: family, scale, extent: { width: 3, height: 4, origin: [-12, 8] } };
    const document = local(options), spacing = family === "local" ? g.LOCAL[scale] / 1760 : g.REGIONAL[scale];
    options.extent.origin[0] = 999;
    assert.deepEqual(plain(document.tilePosition(tile(0, -1))), { panelId: "local", east: -12, north: 8 - spacing });
    assert.ok(Math.abs(document.tilePosition(tile(1, 0)).east - (-12 + spacing * Math.sqrt(3) / 2)) < 1e-12);
    assert.equal(document.hasTile("local", 2, -4), true);
    assert.equal(document.hasTile("local", 2, -5), false);
    assert.equal(document.hasTile("local", -1, 0), false);
    assert.throws(() => { document.metadata.extent.origin[0] = 1; }, TypeError);
    roundTrip(document);
    if (family === "regional") {
      const world = global({ scale });
      world.setTerrain("Sz-", 0, 0, "plain");
      assert.equal(roundTrip(world).terrainAt("Sz-", 0, 0), "plain");
    }
  }
});

test("huge local and fine global maps allocate only changed terrain chunks", () => {
  const document = local({ extent: { width: 1000000, height: 1000000, origin: [0, 0] } });
  assert.equal(document.terrainBlocks.length, 0);
  assert.equal(document.terrainAt("local", 999999, -1499998), "plain");
  document.setTerrain("local", 999999, -1499998, "hills");
  assert.equal(document.terrainBlocks.length, 1);
  assert.ok(d.serialize(document).length < 1000);
  assert.equal(roundTrip(document).terrainAt("local", 999999, -1499998), "hills");
  document.setTerrain("local", 999999, -1499998, "plain");
  assert.equal(document.terrainBlocks.length, 0);
  const globe = global({ projection: { ...projection, columns: 24 }, scale: "S" });
  assert.equal(globe.terrainBlocks.length, 0);
  globe.setTerrain("Hyz+-", 0, 0, "mountain-peak");
  assert.equal(roundTrip(globe).terrainAt("Hyz+-", 0, 0), "mountain-peak");
  assert.equal(globe.terrainBlocks.length, 1);
});

test("global partial tiles, negative columns, and equatorial protrusions preserve canonical owners", () => {
  const document = global(), world = g.createWorld({ columns: 2 });
  const partial = [...g.tiles(world, "Sz-")].find(t => !g.inside(world.panels["Sz-"].polygon, t.center));
  assert.ok(partial && partial.q < 0);
  document.setTerrain("Sz-", partial.q, partial.r, "lakes");
  document.putLandmark({ id: "ruins-1", type: "ruins", tile: tile(partial.q, partial.r, "Sz-") });
  document.putLabel(label("partial-label", tile(partial.q, partial.r, "Sz-")));
  const owner = g.locateTile(world, "Hxz--", [world.width / 2 - world.spacing * 0.05, 0]);
  assert.equal(owner.panelId, "Hyz+-");
  assert.equal(owner.q, 0);
  document.setTerrain(owner.panelId, owner.q, owner.r, "islands");
  assert.equal(document.hasTile("Hyz+-", -1, 0), false);
  assert.equal(document.hasTile("Hyz+-", world.count, 0), false);
  const loaded = roundTrip(document);
  assert.equal(loaded.terrainAt("Sz-", partial.q, partial.r), "lakes");
  assert.equal(loaded.terrainAt(owner.panelId, owner.q, owner.r), "islands");
  assert.equal(loaded.terrainAt("Hxz--", world.count - 1, -(world.count - 1) / 2 - 0.5), "water");
});

test("paths cross every solid seam using paired physical points, not net-space jumps", () => {
  const document = global(), world = g.createWorld({ columns: 2 });
  const vertices = Object.fromEntries(g.projection.solid.vertices.map(v => [v.id, v.position]));
  for (const [index, edge] of g.projection.solid.edges.entries()) {
    const midpoint = vertices[edge.vertices[0]].map((v, axis) => (v + vertices[edge.vertices[1]][axis]) / 2);
    const [a, b] = edge.faces;
    const toPoint = panelId => {
      const [east, north] = g.solidToPanel(world, panelId, midpoint);
      return { panelId, east, north };
    };
    document.putPath({ id: edge.id, type: d.PATH_TYPES[index % 3], points: [
      { panelId: a, east: 0, north: 0 }, toPoint(a), toPoint(b), { panelId: b, east: 0, north: 0 }
    ] });
  }
  assert.equal(roundTrip(document).paths.length, 48);
  const before = d.serialize(document);
  const bad = plain(document.paths[0]);
  bad.points.splice(1, 2);
  assert.throws(() => document.putPath(bad), /same seam point/);
  assert.equal(d.serialize(document), before);
  assert.throws(() => document.putPath({ id: "disconnected", type: "river", points: [
    { panelId: "Sz-", east: 0, north: 0 }, { panelId: "Sz+", east: 0, north: 0 }
  ] }), /nonadjacent/);
});

test("independent layer edits are atomic, unique per landmark tile, and reject stale IDs", () => {
  const document = local();
  for (const [index, type] of d.LANDMARK_TYPES.entries()) {
    document.putLandmark({ id: type, type, tile: tile(0, -index) });
  }
  document.putLabel(label("first")); document.putLabel({ ...label("second"), offset: [0, 0] });
  const editable = label("third");
  delete editable.offset;
  document.putLabel(editable);
  assert.deepEqual(plain(document.labels.find(l => l.id === "third").offset), [0, 0]);
  const before = d.serialize(document);
  assert.throws(() => document.putLandmark({ id: "village", type: "fortress", tile: tile(0, -1) }), /one landmark/);
  assert.equal(d.serialize(document), before);
  document.putLandmark({ id: "village", type: "fortress", tile: tile(1, 0) });
  document.putLandmark({ id: "replacement", type: "village", tile: tile() });
  assert.equal(document.landmarks.length, 12);
  assert.throws(() => { document.labels[0].tile.q = 5; }, TypeError);
  const input = label("copied");
  document.putLabel(input);
  input.text = "changed"; input.tile.q = 12;
  assert.notEqual(document.labels.find(l => l.id === "copied").text, "changed");
  document.removeLandmark("replacement");
  document.removeLabel("copied");
  assert.throws(() => document.removeLandmark("missing"), /Unknown landmark/);
  assert.throws(() => document.removeLabel("missing"), /Unknown label/);
  const p = document.tilePosition(tile()), next = document.tilePosition(tile(0, -1));
  document.putPath({ id: "road", type: "road", points: [p, next] });
  document.putPath({ id: "river", type: "river", points: [p, next] });
  document.removePath("road");
  assert.throws(() => document.removePath("road"), /Unknown path/);
  assert.equal(roundTrip(document).paths.length, 1);
});

test("local anchors retain their projection, universal location, and orientation", () => {
  const anchor = { mapId: "parent-world", projection, panelId: "Sz-", east: 0, north: 0, rotation: 72.5 };
  const document = local({ anchor });
  assert.deepEqual(plain(roundTrip(document).metadata.anchor), anchor);
  assert.throws(() => local({ anchor: { ...anchor, mapId: "local-test" } }), /anchor to itself/);
  assert.throws(() => local({ anchor: { ...anchor, panelId: "bad" } }), /outside its geometric panel/);
  assert.throws(() => local({ anchor: { ...anchor, east: 1e10 } }), /outside its geometric panel/);
  assert.throws(() => local({ anchor: { ...anchor, projection: { ...projection, version: 2 } } }), /Unsupported projection/);
});

test("serialization is independent of property and edit insertion order", () => {
  const a = local({ extent: { width: 40, height: 40, origin: [0, 0] } });
  const b = local({ extent: { origin: [0, 0], height: 40, width: 40 } });
  const edits = [[0, 0, "water"], [20, -35, "mountains"], [39, -19, "forest"]];
  for (const [q, r, terrain] of edits) a.setTerrain("local", q, r, terrain);
  for (const [q, r, terrain] of [...edits].reverse()) b.setTerrain("local", q, r, terrain);
  a.putLabel(label("z")); a.putLabel(label("a"));
  const reverseFields = Object.fromEntries(Object.entries(label("a")).reverse());
  b.putLabel(reverseFields); b.putLabel(label("z"));
  assert.equal(d.serialize(a), d.serialize(b));
  const ga = global(), gb = global({ projection: { columns: 2, version: 1, id: projection.id } });
  assert.equal(d.serialize(ga), d.serialize(gb));
});

test("checked-in local and global ASCII fixtures remain canonical and lossless", () => {
  for (const name of ["local", "global"]) {
    const source = fixture(name), document = d.parse(source);
    assert.equal(d.serialize(document), source);
    assert.equal(d.serialize(d.parse(source.replace(/\n/g, "\r\n"))), source);
    assert.equal(document.labels[0].text, "Caf\u00e9 \u03b1 \ud83c\udff0");
    assert.equal(document.paths.length, 1);
    assert.equal(document.landmarks.length, 1);
  }
  assert.equal(d.parse(fixture("local")).terrainAt("local", 0, 0), "water");
  assert.equal(d.parse(fixture("global")).terrainAt("Sz-", -1, 0), "lakes");
});

test("malformed terrain rows, codes, masks, duplicate sections, and versions identify the input line", () => {
  const source = fixture("local"), rows = source.split("\n");
  assertFormatError(source.replace("FANTASY-MAP 1", "FANTASY-MAP 2"), /Unsupported format/, 1);
  assertFormatError(source.replace(rows[4], rows[4].slice(1)), /exactly 16/, 5);
  assertFormatError(source.replace(rows[4], "?" + rows[4].slice(1)), /Column 1: unknown terrain code/, 5);
  assertFormatError(source.replace(rows[4], "_" + rows[4].slice(1)), /unknown terrain code/, 5);
  assertFormatError(source.replace(rows[4], rows[4].slice(0, -1) + "."), /outside-map positions/, 5);
  assertFormatError(source.replace("[paths]", rows.slice(3, 20).join("\n") + "\n[paths]"), /Duplicate or overlapping/, 21);
  assertFormatError(source.replace('"column":0', '"column":1'), /aligned 16-by-16/, 4);
  assertFormatError(source.replace('"width":16', '"width":15'), /aligned 16-by-16/, 4);
  assertFormatError(source.replace('"panelId":"local","row":0', '"panelId":"wrong","row":0'), /panelId 'local'/, 5);
  assertFormatError(source.replace('"row":0', '"row":160'), /outside-map positions/, 5);
  assertFormatError(source.replace("[end]", "[unexpected]"), /Expected \[end\]/, rows.indexOf("[end]") + 1);
  assertFormatError(source + "{}\n", /Unexpected content/, rows.length);
  assertFormatError(source.replace("\\u03b1", "\u03b1"), /must be ASCII/, rows.indexOf("[labels]") + 2);
  assertFormatError(source.replace("\n", "\r"), /line endings/, 1);
  assertFormatError(" ".repeat(d.MAX_FILE_SIZE + 1), /16 MiB/, 1);
});

test("malformed layer imports reject duplicates, broken references, extra fields, and inconsistent positions atomically", () => {
  const source = fixture("local"), lines = source.split("\n");
  const labelLine = lines.indexOf("[labels]") + 2, landmarkLine = lines.indexOf("[landmarks]") + 2;
  assertFormatError(replaceRecord(source, "labels", r => ({ ...r, size: -1 })), /positive/, labelLine);
  assertFormatError(replaceRecord(source, "labels", r => ({ ...r, tile: { ...r.tile, q: 999 } })), /outside the map/, labelLine);
  assertFormatError(replaceRecord(source, "labels", r => ({ ...r, position: { ...r.position, east: 0 } })), /does not match/, labelLine);
  assertFormatError(replaceRecord(source, "landmarks", r => ({ ...r, type: "palace" })), /Unknown landmark type/, landmarkLine);
  const landmarkRecord = lines[landmarkLine - 1];
  assertFormatError(source.replace("[labels]", landmarkRecord + "\n[labels]"), /Duplicate landmarks ID/, landmarkLine + 1);
  assertFormatError(source.replace("[labels]", landmarkRecord.replace("city-1", "city-2") + "\n[labels]"), /one landmark/, landmarkLine + 1);
  const pathLine = lines.indexOf("[paths]") + 2;
  assertFormatError(replaceRecord(source, "paths", r => ({ ...r, points: [r.points[0], r.points[0]] })), /must be distinct/, pathLine);
  assertFormatError(replaceRecord(source, "paths", r => ({ ...r, points: [r.points[0], { ...r.points[1], east: 1e10 }] })), /outside the local map/, pathLine);
  assertFormatError(replaceRecord(source, "metadata", r => ({ ...r, unknown: true })), /exactly these fields/, 3);
  assertFormatError(source.replace('"defaultTerrain":"plain"', '"defaultTerrain":"water","defaultTerrain":"plain"'), /Duplicate JSON field/, 3);
  assertFormatError(source.replace('"width":6', '"width":4,"\\u0077idth":6'), /Duplicate JSON field/, 3);
  assertFormatError(source.replace('"height":3', '"height":1e999'), /safe integer/, 3);
  let active = d.parse(source);
  const original = active, before = d.serialize(active);
  assert.throws(() => { active = d.parse(replaceRecord(source, "labels", r => ({ ...r, size: 0 }))); }, /positive/);
  assert.equal(active, original);
  assert.equal(d.serialize(active), before);
});

test("invalid metadata and mutations fail explicitly without accepting coercions or unsafe coordinates", () => {
  for (const options of [
    { id: "" }, { kind: "planet" }, { scaleFamily: "yards" }, { scale: "XS" }, { scale: ["S"] },
    { defaultTerrain: "unknown" }, { defaultTerrain: ["plain"] }, { extra: 1 },
    { extent: { width: 0, height: 1, origin: [0, 0] } }, { extent: { width: 1, height: 1, origin: [Infinity, 0] } },
    { extent: { width: Number.MAX_SAFE_INTEGER, height: 2, origin: [0, 0] } },
    { extent: { width: 1, height: 1, origin: [1e300, 0] } }
  ]) assert.throws(() => local(options));
  assert.throws(() => global({ scaleFamily: "local" }), /regional/);
  assert.throws(() => global({ projection: { ...projection, columns: 3 } }), /positive even integer/);
  const document = local();
  assert.throws(() => document.setTerrain("local", 0.5, 0, "water"), /safe integer/);
  assert.throws(() => document.setTerrain("local", 0, 0, "toString"), /Unknown terrain/);
  assert.throws(() => document.setTerrain("local", 0, 1, "water"), /outside/);
  assert.throws(() => global().setTerrain(["Sz-"], 0, 0, "plain"), /Panel ID must be a string/);
  assert.throws(() => document.putLabel({ ...label(), text: "" }), /Label text/);
  assert.throws(() => document.putLabel({ ...label(), rotation: Infinity }), /finite/);
  assert.throws(() => document.putLabel({ ...label(), offset: [0, NaN] }), /finite/);
  assert.throws(() => document.putLabel({ ...label(), offset: Array(2) }), /finite/);
  assert.throws(() => document.putPath({ id: "short", type: "road", points: [document.tilePosition(tile())] }), /2-100000/);
  assert.throws(() => document.putPath({ id: "holes", type: "road", points: Array(2) }), /Path coordinate must be an object/);
  assert.equal(document.terrainBlocks.length, 0);
  assert.equal(document.labels.length, 0);
});
