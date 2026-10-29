"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { geometry: g, documents: d, globalEditor: e } = require("./load-core.cjs");
const create = (columns = 2, scale = "XL") => d.create({
  id: "global-edits", kind: "global", scale, projection: { id: "equilateral-chamfered-cube", version: 1, columns }
});
const ref = tile => ({ panelId: tile.panelId, q: tile.q, r: tile.r });
const terrain = (document, tile) => document.terrainAt(tile.panelId, tile.q, tile.r);
const mean = polygon => [0, 1].map(axis => polygon.reduce((sum, p) => sum + p[axis], 0) / polygon.length);
const fromId = id => { const [panelId, , q, r] = id.split(":"); return { panelId, q: Number(q), r: Number(r) }; };

test("global viewport iteration and owner hit testing stay bounded at every regional resolution", () => {
  for (const scale of ["S", "M", "L", "XL"]) {
    const document = create(24, scale), world = e.world(document), distance = world.spacing * 2;
    for (const faceId of Object.keys(world.panels)) {
      const tiles = [...e.tiles(document, faceId, { minX: -distance, maxX: distance, minY: -distance, maxY: distance })];
      assert.ok(tiles.length > 0 && tiles.length < 150, `${scale} ${faceId}`);
      for (const item of tiles) assert.deepEqual(e.hitTest(document, faceId, mean(item.polygon)).tile, item.tile);
    }
    assert.equal(document.terrainBlocks.length, 0);
  }
  assert.throws(() => e.world(d.create({ id: "local", kind: "local" })), /requires a global map/);
  assert.throws(() => [...e.tiles(create(), "Hyz+-", { minX: 1, maxX: 0, minY: 0, maxY: 1 })], /viewport/);
  assert.throws(() => e.hitTest(create(), "Hyz+-", new Array(2)), /Invalid global map point/);
});

test("unfolded neighbor context locates the same owner on both sides of all 48 seams", () => {
  const document = create(), world = e.world(document);
  for (const edge of g.projection.solid.edges) {
    const [a, b] = edge.faces;
    const endpoints = edge.vertices.map(id => g.solidToPanel(world, a, g.projection.solid.vertices.find(v => v.id === id).position));
    const middle = mean(endpoints), across = middle.map(v => v * 1.02);
    const transformed = g.seamTransform(world, edge.id, a, across);
    const hit = e.hitTest(document, a, across), expected = g.locateTile(world, b, transformed.point);
    assert.equal(hit.faceId, b, edge.id);
    assert.deepEqual(JSON.parse(JSON.stringify(hit.tile)), ref(expected));
  }
});

test("radius brushes cross irregular and periodic seams in one undo command", () => {
  const document = create(), world = e.world(document), session = e.createSession(document, { saved: true });
  for (const edge of g.projection.solid.edges) {
    for (const link of g.seamNeighbors(world, edge.id).slice(0, 2)) {
      session.beginStroke();
      session.paintTile(fromId(link.from), "forest", 1);
      session.commitStroke();
      assert.equal(terrain(document, fromId(link.to)), "forest", edge.id);
      session.undo();
      assert.equal(document.terrainBlocks.length, 0);
      assert.equal(session.dirty, false);
    }
  }
  for (const faceId of world.strip) {
    session.beginStroke();
    session.paintLine(faceId, [-world.width / 2 + world.spacing / 4, 0], [-world.width / 2 - world.spacing, 0], "hills");
    session.commitStroke();
    const before = e.hitTest(document, faceId, [-world.width / 2 + world.spacing / 4, 0]).tile;
    const after = e.hitTest(document, faceId, [-world.width / 2 - world.spacing, 0]).tile;
    assert.notEqual(before.panelId, after.panelId);
    assert.equal(terrain(document, before), "hills");
    assert.equal(terrain(document, after), "hills");
    session.undo();
    assert.equal(document.terrainBlocks.length, 0);
    session.redo();
    assert.equal(terrain(document, after), "hills");
    session.undo();
  }
});

test("fast strokes include thin seam fragments without painting surrounding cells", () => {
  const document = create(24), world = e.world(document), session = e.createSession(document, { saved: true });
  const faceId = "Sx-", partial = g.tileGeometry(world, faceId, -3, -5);
  const point = mean(partial.fragments[0].polygon);
  const from = [point[0] - 2.13 * world.spacing, point[1]], to = [point[0] + 1.87 * world.spacing, point[1]];
  const id = tile => `${tile.panelId}:${tile.q}:${tile.r}`, expected = new Set();
  for (let i = 0; i <= 2000; i++) {
    const hit = e.hitTest(document, faceId, from.map((v, axis) => v + (to[axis] - v) * i / 2000));
    if (hit) expected.add(id(hit.tile));
  }
  assert.ok(expected.has(id(partial)));
  const surrounding = [...e.tiles(document, faceId, {
    minX: from[0] - world.spacing, maxX: to[0] + world.spacing,
    minY: point[1] - world.spacing, maxY: point[1] + world.spacing
  })];
  for (const [a, b] of [[from, to], [to, from]]) {
    session.beginStroke();
    session.paintLine(faceId, a, b, "forest");
    session.commitStroke();
    assert.equal(terrain(document, partial), "forest");
    for (const { tile } of surrounding)
      assert.equal(terrain(document, tile), expected.has(id(tile)) ? "forest" : "water", id(tile));
    session.undo();
    assert.equal(document.terrainBlocks.length, 0);
    assert.equal(session.dirty, false);
  }
});

test("global flood fill traverses every panel, while terrain boundaries and layers remain independent", () => {
  const document = create(), world = e.world(document), session = e.createSession(document, { saved: true });
  const start = g.locateTile(world, "Hyz+-", [0, 0]);
  session.fill(start.panelId, start.q, start.r, "forest");
  for (const faceId of Object.keys(world.panels)) for (const tile of g.tiles(world, faceId))
    assert.equal(terrain(document, tile), "forest");
  session.undo();
  assert.equal(document.terrainBlocks.length, 0);
  assert.equal(session.dirty, false);

  const fixture = d.parse(readFileSync(path.join(__dirname, "fixtures", "global.hexmap"), "utf8"));
  const snapshot = JSON.stringify([fixture.metadata, fixture.paths, fixture.landmarks, fixture.labels]);
  const edit = e.createSession(fixture, { saved: true });
  const tile = { panelId: "Sz-", q: -1, r: 0 };
  edit.fill(tile.panelId, tile.q, tile.r, "forest");
  assert.equal(terrain(fixture, tile), "forest");
  assert.equal(fixture.terrainAt("Hyz+-", 0, 0), "islands");
  assert.equal(JSON.stringify([fixture.metadata, fixture.paths, fixture.landmarks, fixture.labels]), snapshot);
});

test("partial cells, fine seam neighbors, and spherical lookup preserve canonical ownership", () => {
  const document = create(24000, "S"), world = e.world(document);
  for (const faceId of ["Hyz+-", "Sz-", "Hxz+-"]) {
    const face = world.panels[faceId], point = mean([face.polygon[0], face.polygon[1]]);
    const tile = g.locateTile(world, faceId, point);
    const neighbors = e.neighbors(document, tile);
    assert.ok(neighbors.length >= 2 && neighbors.length < 20);
    for (const other of neighbors) assert.ok(e.neighbors(document, other).some(t =>
      t.panelId === tile.panelId && t.q === tile.q && t.r === tile.r));
  }
  const small = create();
  for (const faceId of Object.keys(e.world(small).panels)) for (const tile of g.tiles(e.world(small), faceId)) {
    const place = e.location(small, tile), ll = g.toLatLon(e.world(small), place.faceId, place.point);
    const back = g.fromLatLon(e.world(small), ll.latitude, ll.longitude ?? 0);
    assert.equal(JSON.stringify(e.locate(small, back.faceId, back.point).tile), JSON.stringify(ref(tile)));
  }
});

test("failed cross-panel strokes restore all owners and preserve save/history checkpoints", () => {
  const document = create(240, "S"), world = e.world(document), session = e.createSession(document, { saved: true });
  const first = ref(g.locateTile(world, "Hyz+-", [0, 0])), second = ref(g.locateTile(world, "Hxz--", [0, 0]));
  session.beginStroke();
  session.paintTile(first, "forest"); session.paintTile(second, "hills");
  session.commitStroke();
  const saved = session.revision, snapshot = d.serialize(document);
  session.beginStroke();
  session.paintTile(first, "water");
  assert.throws(() => session.paintLine("Hyz+-", [-10000, 0], [10000, 0], "forest"), /too many tiles/);
  assert.equal(d.serialize(document), snapshot);
  assert.equal(session.active, false);
  session.markSaved(saved);
  assert.equal(session.dirty, false);
  session.undo();
  assert.equal(document.terrainBlocks.length, 0);
  session.redo();
  assert.equal(terrain(document, first), "forest");
  assert.equal(terrain(document, second), "hills");
  session.beginStroke();
  assert.throws(() => session.paintTile(first, "forest", 5), /radius/);
  assert.equal(session.dirty, false);
});
