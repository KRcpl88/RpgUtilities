"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { geometry: g, documents: d, editor: local, globalEditor: global, layers } = require("./load-core.cjs");
const create = () => d.create({ id: "layers", kind: "local", scaleFamily: "regional", scale: "S" });
const tile = (q = 0, r = 0) => ({ panelId: "local", q, r });
const label = (id = "label") => ({ id, text: "Caf\u00e9 <&>\n\u03b1 \ud83c\udff0", tile: tile(), size: 15, rotation: 37, offset: [0.2, -0.3] });
const input = record => { const { position, ...value } = record; return value; };

test("terrain and every independent layer share atomic undo, redo, and save checkpoints", () => {
  const document = create(), session = local.createSession(document, { saved: true }), initial = d.serialize(document);
  session.beginStroke(); session.paintLine([0, 0], [1, 0], "forest"); session.commitStroke();
  const terrain = d.serialize(document);
  session.putPath({ id: "road", type: "road", points: layers.pathPoints(document, [document.tilePosition(tile()), document.tilePosition(tile(2, -1))]) });
  session.putLandmark({ id: "city", type: "city", tile: tile() });
  session.putLabel(label());
  const complete = d.serialize(document), saved = session.revision;
  assert.equal(d.serialize(d.parse(complete)), complete);
  session.markSaved(saved);
  session.removeLabel("label"); session.removeLandmark("city"); session.removePath("road");
  assert.equal(d.serialize(document), terrain);
  for (let i = 0; i < 3; i++) session.undo();
  assert.equal(d.serialize(document), complete);
  assert.equal(session.dirty, false);
  for (let i = 0; i < 4; i++) session.undo();
  assert.equal(d.serialize(document), initial);
  for (let i = 0; i < 4; i++) session.redo();
  assert.equal(d.serialize(document), complete);
});

test("landmark uniqueness, rejected layer edits, and no-ops preserve data and redo", () => {
  const document = create(), session = local.createSession(document, { saved: true });
  session.putLandmark({ id: "one", type: "town", tile: tile() });
  session.putLandmark({ id: "two", type: "mine", tile: tile(1) });
  session.putLabel(label());
  session.markSaved();
  const snapshot = d.serialize(document), revision = session.revision;
  assert.throws(() => session.putLandmark({ id: "two", type: "city", tile: tile() }), /one landmark/);
  assert.throws(() => session.putLabel({ ...label(), size: 0 }), /positive/);
  assert.throws(() => session.removePath("missing"), /Unknown path/);
  assert.equal(d.serialize(document), snapshot);
  assert.equal(session.revision, revision);
  assert.equal(session.dirty, false);
  session.putLandmark({ id: "one", type: "castle", tile: tile() });
  session.undo();
  assert.equal(session.putLabel({ ...label(), tile: { r: 0, q: 0, panelId: "local" } }), false);
  assert.equal(session.putLandmark(input(document.landmarks[0])), false);
  assert.equal(session.canRedo, true);
  session.redo();
  assert.equal(document.landmarks[0].type, "castle");
  assert.equal(document.landmarks.length, 2);
  session.beginStroke();
  assert.throws(() => session.putLabel(label("other")), /Finish or cancel/);
  session.cancelStroke();
});

test("path waypoints produce paired physical crossings across all 48 seams", () => {
  const document = d.create({ id: "seams" }), world = global.world(document), session = global.createSession(document);
  for (const edge of g.projection.solid.edges) {
    const [a, b] = edge.faces;
    const endpoints = edge.vertices.map(id => g.solidToPanel(world, a, g.projection.solid.vertices.find(vertex => vertex.id === id).position));
    const middle = [0, 1].map(axis => (endpoints[0][axis] + endpoints[1][axis]) / 2);
    const first = middle.map(v => v * .98), last = g.seamTransform(world, edge.id, a, middle.map(v => v * 1.02)).point;
    const waypoints = [{ panelId: a, east: first[0], north: first[1] }, { panelId: b, east: last[0], north: last[1] }];
    for (const route of [waypoints, [...waypoints].reverse()]) {
      const points = layers.pathPoints(document, route);
      assert.equal(points.length, 4, edge.id);
      session.putPath({ id: edge.id, type: "river", points });
      assert.equal(layers.segments(document.paths[0], a).length, 1);
      assert.equal(layers.segments(document.paths[0], b).length, 1);
      assert.equal(JSON.stringify(layers.pathPoints(document, points)), JSON.stringify(points));
      session.undo();
      assert.equal(document.paths.length, 0);
    }
  }
  assert.throws(() => layers.pathPoints(document, [
    { panelId: "Sx-", east: 0, north: 0 }, { panelId: "Sx+", east: 0, north: 0 }
  ]), /intermediate point/);
});

test("path vertex insertion, replacement, deletion, and invalid coordinates are validated before commit", () => {
  const document = create(), session = local.createSession(document);
  const points = [tile(), tile(1), tile(2, -1)].map(t => document.tilePosition(t));
  session.putPath({ id: "trail", type: "trail", points: layers.pathPoints(document, points) });
  const before = d.serialize(document);
  assert.throws(() => layers.pathPoints(document, [points[0], { panelId: "local", east: -100, north: 0 }]), /outside/);
  assert.equal(d.serialize(document), before);
  const moved = [...points]; moved[1] = document.tilePosition(tile(1, -1));
  session.putPath({ id: "trail", type: "road", points: layers.pathPoints(document, moved) });
  session.undo(); assert.equal(d.serialize(document), before);
  const short = layers.pathPoints(document, [points[0], points[0], points[2]]);
  assert.equal(short.length, 2);
  session.putPath({ id: "trail", type: "trail", points: short });
  assert.equal(document.paths[0].points.length, 2);
  assert.throws(() => session.putPath({ id: "trail", type: "trail", points: [points[0]] }), /2-100000/);
  assert.equal(document.paths[0].points.length, 2);
});

test("anchored layers display on their canonical tile even when its center is outside the face", () => {
  const document = d.create({ id: "partial", projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 } });
  const world = global.world(document);
  for (const faceId of Object.keys(world.panels)) for (const shape of g.tiles(world, faceId)) {
    const tile = { panelId: faceId, q: shape.q, r: shape.r }, before = document.tilePosition(tile);
    const anchor = layers.anchor(document, tile), found = g.locateTile(world, anchor.panelId, [anchor.east, anchor.north]);
    assert.equal(found.id, shape.id);
    assert.deepEqual(document.tilePosition(tile), before);
  }
  const map = create();
  assert.deepEqual(layers.anchor(map, tile()), map.tilePosition(tile()));
});

test("layer history budgets account for path vertices rather than only path count", () => {
  const document = create(), session = local.createSession(document);
  const a = document.tilePosition(tile()), b = document.tilePosition(tile(1));
  const points = Array.from({ length: 40000 }, (_, i) => i % 2 ? a : b);
  for (const type of ["road", "trail", "river"]) session.putPath({ id: "long", type, points });
  assert.equal(session.undo(), true);
  assert.equal(session.undo(), true);
  assert.equal(session.undo(), false);
  assert.equal(document.paths[0].type, "road");
  session.redo(); session.redo();
  assert.equal(document.paths[0].type, "river");
});
