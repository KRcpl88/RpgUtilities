"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { geometry: g, documents: d, editor: e } = require("./load-core.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
const create = (width = 12, height = 8, options = {}) => d.create({
  id: "local-edits", kind: "local", extent: { width, height, origin: [-1, 2] }, ...options
});
const paint = (session, from, to = from, terrain = "forest", radius = 0) => {
  session.beginStroke();
  session.paintLine(from, to, terrain, radius);
  return session.commitStroke();
};

test("local view bounds, hit testing, and offset rows work in every scale family", () => {
  for (const scaleFamily of ["local", "regional"]) for (const scale of ["S", "M", "L", "XL"]) {
    const document = create(5, 4, { scaleFamily, scale }), grid = e.grid(document);
    const all = [...e.tiles(document, e.bounds(document))];
    assert.equal(all.length, 20);
    for (const tile of all) assert.deepEqual(plain(e.hitTest(document, g.hexCenter(grid, tile.q, tile.r))), plain(tile));
    assert.equal(e.hitTest(document, [e.bounds(document).minX - grid.spacing, 2]), null);
    const firstHex = g.hexPolygon(grid, 0, 0);
    assert.ok(e.hitTest(document, firstHex[3]), "Boundary vertices still select an existing tile.");
    assert.equal([...e.tiles(document, { minX: -100000, maxX: -99999, minY: 0, maxY: 1 })].length, 0);
  }
  assert.throws(() => e.createSession(d.create({ id: "global" })), /requires a local map/);
  assert.throws(() => [...e.tiles(create(), { minX: 1, maxX: 0, minY: 0, maxY: 1 })], /Invalid local viewport/);
  for (const point of [new Array(2), [0, NaN], [Infinity, 0], ["0", 0]])
    assert.throws(() => e.hitTest(create(), point), /Invalid local map point/);
});

test("viewport iteration stays local even on a trillion-tile document", () => {
  const document = create(1000000, 1000000), { origin, spacing } = e.grid(document);
  const visible = [...e.tiles(document, {
    minX: origin[0], maxX: origin[0] + spacing * 3, minY: origin[1] - spacing * 3, maxY: origin[1]
  })];
  assert.ok(visible.length > 0 && visible.length < 30);
  assert.equal(document.terrainBlocks.length, 0);
});

test("an interpolated drag is one undo command, including repeated tiles and clipped brushes", () => {
  const document = create(), session = e.createSession(document, { saved: true });
  session.beginStroke();
  session.paintLine([0, 0], [0, -6], "forest");
  session.paintLine([0, -6], [0, -2], "forest");
  assert.equal(session.dirty, true);
  assert.equal(session.canUndo, false);
  assert.equal(session.commitStroke(), true);
  for (let row = 0; row <= 6; row++) assert.equal(document.terrainAt("local", 0, -row), "forest");
  assert.equal(session.undo(), true);
  assert.equal(document.terrainBlocks.length, 0);
  assert.equal(session.dirty, false);
  assert.equal(session.canUndo, false);
  session.redo();
  assert.equal(document.terrainAt("local", 0, -6), "forest");
  session.undo();
  paint(session, [0, 0], [0, 0], "hills", 1);
  const changed = [...e.tiles(document, e.bounds(document))].filter(t => document.terrainAt("local", t.q, t.r) === "hills");
  assert.equal(changed.length, 4);
  session.undo();
  assert.equal(document.terrainBlocks.length, 0);
});

test("fill follows hex adjacency, respects terrain boundaries, and preserves all other layers", () => {
  const document = d.parse(readFileSync(path.join(__dirname, "fixtures", "local.hexmap"), "utf8"));
  const layers = JSON.stringify([document.metadata, document.paths, document.landmarks, document.labels]);
  const session = e.createSession(document, { saved: true });
  session.fill(0, 0, "forest");
  paint(session, [0, 0], [0, 0], document.metadata.defaultTerrain);
  session.undo(); session.undo(); session.redo();
  assert.equal(JSON.stringify([document.metadata, document.paths, document.landmarks, document.labels]), layers);
  assert.equal(d.serialize(d.parse(d.serialize(document))), d.serialize(document));
  const split = create(6, 6), edit = e.createSession(split);
  for (let row = 0; row < 6; row++) split.setTerrain("local", 2, -row - 1, "mountains");
  assert.equal(edit.fill(0, 0, "water"), true);
  for (const t of e.tiles(split, e.bounds(split))) {
    assert.equal(split.terrainAt("local", t.q, t.r), t.q < 2 ? "water" : t.q === 2 ? "mountains" : "plain");
  }
  edit.undo();
  assert.equal(split.terrainAt("local", 0, 0), "plain");
  assert.equal(split.terrainAt("local", 2, -1), "mountains");
});

test("save checkpoints, redo branches, no-op strokes, and delayed save confirmation track dirty state", () => {
  const session = e.createSession(create(), { saved: true });
  paint(session, [0, 0]);
  const saved = session.revision;
  paint(session, [0, -1]);
  session.markSaved(saved);
  assert.equal(session.dirty, true);
  session.undo();
  assert.equal(session.dirty, false);
  assert.equal(paint(session, [0, 0]), false);
  assert.equal(session.fill(0, 0, "forest"), false);
  assert.equal(session.canRedo, true);
  session.redo(); session.undo();
  paint(session, [1, 0], [1, 0], "water");
  assert.equal(session.canRedo, false);
  assert.equal(session.dirty, true);
  session.undo();
  assert.equal(session.dirty, false);
  assert.throws(() => session.markSaved(9999), /Unknown save revision/);
  assert.equal(e.createSession(create()).dirty, true);
});

test("cancelled and failed strokes roll back all changes without consuming undo history", () => {
  const document = create(), session = e.createSession(document, { saved: true }), before = d.serialize(document);
  session.beginStroke(); session.paintLine([0, 0], [0, -3], "forest");
  session.cancelStroke();
  assert.equal(d.serialize(document), before);
  assert.equal(session.dirty, false);
  session.beginStroke(); session.paintLine([0, 0], [0, 0], "water");
  assert.throws(() => session.paintLine([0, 0], [1, 0], "not-terrain"), /Unknown brush/);
  assert.equal(session.active, false);
  assert.equal(d.serialize(document), before);
  assert.equal(session.canUndo, false);
  assert.throws(() => session.paintLine([0, 0], [1, 0], "water"), /Begin a stroke/);
});

test("oversized fills and long drags fail atomically instead of partially editing", () => {
  const large = create(201, 201), session = e.createSession(large, { saved: true });
  assert.throws(() => session.fill(0, 0, "water"), /Fill exceeds 25,000/);
  assert.equal(large.terrainBlocks.length, 0);
  assert.equal(session.canUndo, false);
  assert.equal(session.dirty, false);
  const long = create(e.MAX_EDIT_TILES + 2, 1), drag = e.createSession(long, { saved: true });
  drag.beginStroke(); drag.paintLine([0, 0], [0, 0], "water");
  assert.throws(() => drag.paintLine([0, 0], [e.MAX_EDIT_TILES, -Math.floor(e.MAX_EDIT_TILES / 2)], "water"), /too many tiles/);
  assert.equal(long.terrainBlocks.length, 0);
  assert.equal(drag.dirty, false);
});

test("undo history has a bounded command count without invalidating the current document", () => {
  const document = create(), session = e.createSession(document, { saved: true });
  for (let i = 0; i < 105; i++) paint(session, [0, 0], [0, 0], i % 2 ? "water" : "forest");
  let undos = 0;
  while (session.undo()) undos++;
  assert.equal(undos, 100);
  assert.equal(document.terrainAt("local", 0, 0), "forest");
  assert.equal(session.dirty, true);
  let redos = 0;
  while (session.redo()) redos++;
  assert.equal(redos, 100);
  assert.equal(document.terrainAt("local", 0, 0), "forest");
});
