"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Worker } = require("node:worker_threads");
const { documents: d, editor, globalEditor, layers, operations, scales, svg, workerSource } = require("./load-core.cjs");
const fixture = kind => readFileSync(path.join(__dirname, "fixtures", `${kind}.hexmap`), "utf8");
const restore = snapshot => d.restoreValidated(structuredClone(snapshot));
const run = (map, operation, extra = {}) => operations.execute({ operation, snapshot: structuredClone(map.snapshot()), ...extra });

test("internal snapshots preserve validated records, sparse chunks and detached ownership", () => {
  for (const kind of ["local", "global"]) {
    const map = d.parse(fixture(kind)), copy = restore(map.snapshot());
    assert.equal(d.serialize(copy), d.serialize(map));
    assert.ok(Object.isFrozen(copy.paths[0].points[0]));
    assert.ok(Object.isFrozen(copy.labels[0].tile));
    const landmark = copy.landmarks[0];
    assert.throws(() => copy.putLandmark({ id: "duplicate", type: "city", tile: landmark.tile }), /landmark/i);
    copy.removeLandmark(landmark.id);
    copy.putLandmark({ id: "replacement", type: "city", tile: landmark.tile });
    const tile = copy.labels[0].tile;
    const before = map.terrainAt(tile.panelId, tile.q, tile.r);
    copy.setTerrain(tile.panelId, tile.q, tile.r, before === "plain" ? "water" : "plain");
    assert.equal(map.terrainAt(tile.panelId, tile.q, tile.r), before);
    assert.equal(map.landmarks[0].id, landmark.id);
  }
});

test("immutable layer lists are cached and invalidated only by their own edits", () => {
  const map = d.parse(fixture("local")), paths = map.paths, labels = map.labels, landmarks = map.landmarks;
  map.setTerrain("local", 0, 0, "forest");
  assert.equal(map.paths, paths); assert.equal(map.labels, labels); assert.equal(map.landmarks, landmarks);
  const { position, ...label } = labels[0];
  map.putLabel({ ...label, text: "Revised" });
  assert.notEqual(map.labels, labels); assert.equal(map.paths, paths); assert.equal(map.landmarks, landmarks);
  map.removeLabel(label.id); assert.equal(map.labels.length, 0);
});

test("background save, SVG and derivation agree with synchronous cores", async () => {
  const map = d.parse(fixture("local"));
  assert.equal(await run(map, "save"), d.serialize(map));
  assert.equal(await run(map, "svg"), svg.render(map));
  const options = { id: "derived", name: "Derived", scale: "M" };
  assert.equal(d.serialize(restore(await run(map, "derive", { options }))), d.serialize(scales.derive(map, options)));
  assert.equal(d.serialize(map), fixture("local"));
  await assert.rejects(run(map, "unknown"), /Unknown background operation/);
});

test("background import retains strict external validation and line errors", async () => {
  assert.equal(d.serialize(restore(await operations.execute({ operation: "open", file: new Blob([fixture("local")]) }))), fixture("local"));
  await assert.rejects(operations.execute({ operation: "open", file: new Blob([fixture("local").replace('"size":12', '"size":0')]) }),
    /Line \d+: Label size must be positive/);
  await assert.rejects(operations.execute({ operation: "open", file: { size: d.MAX_FILE_SIZE + 1, text() { throw new Error("Must not read oversized input"); } } }),
    /16 MiB/);
});

test("prepared local fill commits once, preserves identity, and supports background history", async () => {
  const map = d.create({ id: "fill", kind: "local", extent: { width: 30, height: 20, origin: [0, 0] } });
  const session = editor.createSession(map, { saved: true }), labels = map.labels;
  const result = await run(map, "fill", { start: { panelId: "local", q: 0, r: 0 }, terrain: "forest" });
  assert.equal(map.terrainAt("local", 0, 0), "plain");
  assert.equal(session.revision, 0);
  const candidate = restore(result.snapshot);
  session.acceptFill(candidate, result.changes, 0);
  candidate.setTerrain("local", 0, 0, "water");
  assert.equal(map.terrainAt("local", 0, 0), "forest");
  assert.equal(session.document, map); assert.equal(map.labels, labels);
  assert.equal(session.revision, 1); assert.equal(session.undoLabel, "Fill");
  assert.equal([...map.terrainEntries()].length, 600);
  const filled = d.serialize(map);
  for (const direction of ["undo", "redo"]) {
    const step = session.historyStep(direction), candidate = restore(await run(map, "history", { step }));
    session.acceptHistory(candidate, step);
    assert.equal(session.document, map); assert.equal(map.labels, labels);
    assert.equal(session.dirty, direction === "redo");
  }
  assert.equal(d.serialize(map), filled);
  const noop = await run(map, "fill", { start: { panelId: "local", q: 0, r: 0 }, terrain: "forest" });
  assert.equal(session.acceptFill(restore(noop.snapshot), noop.changes, session.revision), false);
  assert.equal(session.revision, 1);
});

test("prepared global fill follows physical seams without mutating its source", async () => {
  const map = d.create({ id: "global-fill", projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 } });
  const session = globalEditor.createSession(map), start = { panelId: "Hyz+-", q: 0, r: 0 };
  const original = d.serialize(map), result = await run(map, "fill", { start, terrain: "forest" });
  assert.ok(new Set(result.changes.map(change => change.panelId)).size > 1);
  assert.equal(d.serialize(map), original);
  session.acceptFill(restore(result.snapshot), result.changes, 0);
  session.undo(); assert.equal(d.serialize(map), original);
});

test("stale prepared results and oversized fills leave terrain and history untouched", async () => {
  const map = d.create({ id: "stale", kind: "local", extent: { width: 2, height: 2, origin: [0, 0] } });
  const session = editor.createSession(map);
  const result = await run(map, "fill", { start: { panelId: "local", q: 0, r: 0 }, terrain: "forest" });
  session.beginStroke(); session.paintLine([0, 0], [0, 0], "water"); session.commitStroke();
  const current = d.serialize(map);
  assert.throws(() => session.acceptFill(restore(result.snapshot), result.changes, 0), /changed/);
  const step = session.historyStep("undo"), prepared = restore(await run(map, "history", { step }));
  session.undo();
  assert.throws(() => session.acceptHistory(prepared, step), /changed/);
  session.redo(); assert.equal(d.serialize(map), current);
  const large = d.create({ id: "large", kind: "local", extent: { width: 1000000, height: 1000000, origin: [0, 0] } });
  await assert.rejects(run(large, "fill", { start: { panelId: "local", q: 0, r: 0 }, terrain: "forest" }), /25,000/);
  assert.equal(large.terrainBlocks.length, 0);
});

test("background layer and anchor history invalidate the right caches and keep uniqueness indexes", async () => {
  const map = d.parse(fixture("local")), session = editor.createSession(map, { saved: true });
  const paths = map.paths, original = d.serialize(map), landmark = map.landmarks[0];
  session.putLandmark({ id: landmark.id, type: "castle", tile: landmark.tile });
  session.putLabel({ id: "new-label", tile: landmark.tile, text: "New", size: 12, rotation: 0, offset: [0, 0] });
  session.setAnchor({ mapId: "parent", projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 },
    panelId: "Hyz+-", east: 0, north: 0, rotation: 15 });
  const modified = d.serialize(map);
  for (let i = 0; i < 3; i++) {
    const step = session.historyStep("undo");
    session.acceptHistory(restore(await run(map, "history", { step })), step);
    assert.equal(map.paths, paths);
  }
  assert.equal(d.serialize(map), original);
  for (let i = 0; i < 3; i++) {
    const step = session.historyStep("redo");
    session.acceptHistory(restore(await run(map, "history", { step })), step);
  }
  assert.equal(d.serialize(map), modified);
  assert.throws(() => map.putLandmark({ id: "collision", type: "city", tile: landmark.tile }), /landmark/i);
});

test("actual worker-thread structured cloning round-trips the embedded operation source", async () => {
  const worker = new Worker(`const { parentPort } = require("node:worker_threads");\n${workerSource}
    parentPort.once("message", async request => {
      try {
        const snapshot = await MapOperations.execute(request);
        const saved = await MapOperations.execute({ operation: "save", snapshot });
        parentPort.postMessage(saved);
      } catch (error) { throw error; }
      finally { parentPort.close(); }
    });`, { eval: true });
  try {
    const response = new Promise((resolve, reject) => {
      worker.once("message", resolve); worker.once("error", reject);
    });

    worker.postMessage({ operation: "open", file: new Blob([fixture("global")]) });
    assert.equal(await response, fixture("global"));
  } finally { await worker.terminate(); }
});

test("cached segment culling retains viewport crossings and handles replaced or mutable paths", () => {
  const points = Array.from({ length: 10000 }, (_, i) => Object.freeze({ panelId: "local", east: i * 10, north: 0 }));
  const record = Object.freeze({ id: "long", type: "road", points: Object.freeze(points) });
  const viewport = { minX: 45, maxX: 46, minY: -1, maxY: 1 };
  assert.deepEqual(JSON.parse(JSON.stringify([...layers.visibleSegments(record, "local", viewport)])), [[[40, 0], [50, 0]]]);
  assert.equal([...layers.visibleSegments(record, "other", viewport)].length, 0);
  assert.equal([...layers.visibleSegments(record, "local", { ...viewport, minY: 5, maxY: 6 })].length, 0);
  const editable = { ...record, points: [{ panelId: "local", east: 0, north: 0 }, { panelId: "local", east: 10, north: 0 }] };
  assert.equal([...layers.visibleSegments(editable, "local", viewport)].length, 0);
  editable.points[1].east = 100;
  assert.equal([...layers.visibleSegments(editable, "local", viewport)].length, 1);
});
