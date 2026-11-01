'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Topology: topology, Coordinates: coordinates, Terrain: terrain, Model: model, History: history } = loadModules();

// The plan §5 table: char → terrain key, water flag.
const EXPECTED_TERRAINS = [
  ['~', 'water', true], ['i', 'islands', true], ['o', 'lakes', true], ['v', 'firth', true],
  ['.', 'plain', false], ['h', 'hills', false], ['M', 'mountains', false], ['A', 'mountainPeak', false],
  ['d', 'desert', false], ['D', 'sandDunes', false], ['f', 'forest', false], ['m', 'marsh', false],
  ['g', 'mangrove', false], ['t', 'tundra', false], ['c', 'canyon', false], ['b', 'badlands', false],
  ['=', 'farmland', false],
];

function smallGlobal() {
  return model.createGlobalMap({ panelHexes: 4, tileScale: 'XL', name: 'Test' });
}

function snapshot(doc) {
  return {
    terrainIds: Array.from(doc.terrainIds),
    landmarks: [...doc.landmarks.entries()].sort((a, b) => a[0] - b[0]),
    overlays: doc.overlays.map((overlay) => ({ ...overlay, tileIndices: [...overlay.tileIndices] })),
    labels: doc.labels.map((label) => ({ ...label })),
  };
}

// A non-adjacent tile and a three-tile path of adjacent tiles starting at start.
function path(doc, start, length) {
  const path = [start];
  while (path.length < length) {
    const next = model.neighbors(doc, path.at(-1)).find((tileIndex) => !path.includes(tileIndex));
    path.push(next);
  }
  return path;
}

function farTile(doc, tileIndex) {
  const near = new Set([tileIndex, ...model.neighbors(doc, tileIndex)]);
  for (let otherIndex = 0; otherIndex < doc.tileCount; otherIndex++) {
    if (!near.has(otherIndex)) {
      return otherIndex;
    }
  }
  throw new Error('no far tile');
}

test('terrain table matches plan §5 with unique chars and IDs', () => {
  assert.equal(terrain.TERRAINS.length, 17);
  assert.deepEqual(terrain.TERRAINS.map((item) => [item.char, item.key, item.isWater]), EXPECTED_TERRAINS);
  const chars = terrain.TERRAINS.map((item) => item.char);
  assert.equal(new Set(chars).size, 17);
  assert.equal(new Set(terrain.TERRAINS.map((item) => item.name)).size, 17);
  terrain.TERRAINS.forEach((item, index) => {
    assert.equal(item.id, index);
    assert.match(item.char, /^[!-~]$/, 'printable ASCII');
    assert.match(item.color, /^#[0-9a-f]{6}$/);
    assert.equal(terrain.byId(index), item);
    assert.equal(terrain.byChar(item.char), item);
    assert.equal(terrain.byKey(item.key), item);
    assert.ok('embellish' in item);
    assert.ok(Object.isFrozen(item));
  });
  assert.ok(!chars.includes(terrain.RESERVED_CHAR));
  assert.equal(terrain.RESERVED_CHAR, '_');
  assert.equal(terrain.byChar('_'), null);
  assert.equal(terrain.byId(17), null);
  assert.equal(terrain.byId(1.5), null);
  assert.equal(terrain.byId(terrain.WATER_ID).key, 'water');
  assert.ok(terrain.isWater(terrain.byChar('i').id));
  assert.ok(!terrain.isWater(terrain.byChar('.').id));
});

test('landmark types follow prompt.md', () => {
  assert.deepEqual(terrain.LANDMARK_TYPES.map((item) => item.key),
    ['village', 'town', 'city', 'castle', 'fortress', 'tower', 'ruins', 'mine', 'temple', 'cave', 'dungeon']);
  assert.ok(terrain.isLandmarkType('castle'));
  assert.ok(!terrain.isLandmarkType('volcano'));
  assert.equal(terrain.landmarkType('city').name, 'City');
});

test('CreateGlobalMap sizes the terrain to the topology and defaults to water', () => {
  const doc = smallGlobal();
  const topo = topology.build(4, 'XL');
  assert.equal(doc.kind, 'global');
  assert.equal(doc.name, 'Test');
  assert.deepEqual({ ...doc.global }, { panelHexes: 4, tileScale: 'XL' });
  assert.equal(doc.topo, topo);
  assert.equal(doc.tileCount, topo.tileCount);
  assert.ok(doc.terrainIds instanceof Uint8Array);
  assert.equal(doc.terrainIds.length, topo.tileCount);
  assert.ok(doc.terrainIds.every((id) => id === terrain.WATER_ID));
  assert.equal(doc.landmarks.size, 0);
  assert.deepEqual(doc.overlays, []);
  assert.deepEqual(doc.labels, []);
  assert.equal(model.createGlobalMap().global.panelHexes, 24);
  assert.throws(() => model.createGlobalMap({ tileScale: 'M' }), /tile scale/);
  assert.throws(() => model.createGlobalMap({ panelHexes: 5 }), /even/);
});

test('CreateLocalMap uses the local rectangle and local adjacency', () => {
  const anchor = coordinates.parseUniversal('Eta 187.1W 324.0N');
  const doc = model.createLocalMap({ width: 5, height: 4, systemName: 'regional', scaleName: 'M', anchor, name: 'Vale' });
  assert.equal(doc.kind, 'local');
  assert.equal(doc.tileCount, 20);
  assert.equal(doc.topo, null);
  assert.equal(doc.local.width, 5);
  assert.equal(model.localTileIndex(doc, 2, 3), 17);
  assert.deepEqual(model.localTileXY(doc, 17), [2, 3]);
  assert.equal(model.localTileIndex(doc, 5, 0), -1);
  // Adjacent tiles are exactly one hex spacing apart in universal coordinates.
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    const center = coordinates.localTileToUniversal(doc.local, ...model.localTileXY(doc, tileIndex));
    for (let otherIndex = 0; otherIndex < doc.tileCount; otherIndex++) {
      const other = coordinates.localTileToUniversal(doc.local, ...model.localTileXY(doc, otherIndex));
      const distance = Math.hypot(center.east - other.east, center.north - other.north);
      const expected = otherIndex !== tileIndex && Math.abs(distance - doc.local.hexMiles) < 1e-6;
      assert.equal(model.areAdjacent(doc, tileIndex, otherIndex), expected, `${tileIndex}–${otherIndex}`);
    }
  }
  const interior = model.localTileIndex(doc, 2, 1);
  assert.equal(model.neighbors(doc, interior).length, 6);
});

test('set terrain, undo and redo round trip', () => {
  const doc = smallGlobal();
  const hist = history.create(doc);
  const forestId = terrain.byChar('f').id;
  assert.equal(history.canUndo(hist), false);
  const command = history.perform(hist, 'Paint', (_Doc, record) => record(model.setTerrain(doc, 7, forestId)));
  assert.deepEqual(command.changes.map((change) => [change.layer, change.key, change.before, change.after]),
    [['terrain', 7, terrain.WATER_ID, forestId]]);
  assert.equal(model.getTerrain(doc, 7), forestId);
  assert.ok(history.canUndo(hist));
  assert.equal(history.undo(hist), command);
  assert.equal(model.getTerrain(doc, 7), terrain.WATER_ID);
  assert.ok(history.canRedo(hist));
  history.redo(hist);
  assert.equal(model.getTerrain(doc, 7), forestId);
  assert.equal(history.redo(hist), null);
  // A no-op does not create a command or clear redo.
  history.undo(hist);
  assert.equal(history.perform(hist, 'Noop', (_Doc, record) => record(model.setTerrain(doc, 7, terrain.WATER_ID))), null);
  assert.ok(history.canRedo(hist));
  // A new command clears redo.
  history.perform(hist, 'Paint', (_Doc, record) => record(model.setTerrain(doc, 8, forestId)));
  assert.equal(history.canRedo(hist), false);
  assert.throws(() => model.setTerrain(doc, doc.tileCount, forestId), /Unknown tile/);
  assert.throws(() => model.setTerrain(doc, 0, 99), /Unknown terrain/);
});

test('a grouped brush stroke undoes as one command', () => {
  const doc = smallGlobal();
  const hist = history.create(doc);
  const before = snapshot(doc);
  const hills = terrain.byChar('h').id;
  const mountains = terrain.byChar('M').id;
  history.begin(hist, 'Brush');
  assert.equal(history.canUndo(hist), false, 'no undo while a stroke is open');
  for (const tileIndex of [1, 2, 3, 2, 1]) {
    history.record(hist, model.setTerrain(doc, tileIndex, tileIndex === 2 ? mountains : hills));
  }
  history.record(hist, [model.setTerrain(doc, 4, hills), model.setTerrain(doc, 4, terrain.WATER_ID)]);
  const command = history.commit(hist);
  // Repeats coalesce; tile 4 ends where it started and is dropped.
  assert.deepEqual(command.changes.map((change) => [change.key, change.before, change.after]),
    [[1, 0, hills], [2, 0, mountains], [3, 0, hills]]);
  assert.equal(hist.undoStack.length, 1);
  const after = snapshot(doc);
  history.undo(hist);
  assert.deepEqual(snapshot(doc), before);
  history.redo(hist);
  assert.deepEqual(snapshot(doc), after);
  assert.throws(() => history.record(hist, null), /Begin/);
  history.begin(hist, 'x');
  assert.throws(() => history.begin(hist, 'y'), /already open/);
  history.record(hist, model.setTerrain(doc, 9, hills));
  history.cancel(hist);
  assert.deepEqual(snapshot(doc), after, 'Cancel reverts the open group');
});

test('Perform reverts partial changes when the mutation throws', () => {
  const doc = smallGlobal();
  const hist = history.create(doc);
  const before = snapshot(doc);
  assert.throws(() => history.perform(hist, 'Bad', (_Doc, record) => {
    record(model.setTerrain(doc, 3, terrain.byChar('d').id));
    record(model.setLandmark(doc, 3, { type: 'town' }));
    model.setTerrain(doc, 4, 200);
  }), /Unknown terrain/);
  assert.deepEqual(snapshot(doc), before);
  assert.equal(history.canUndo(hist), false);
  assert.equal(hist.pending, null);
});

test('at most one landmark per tile; place, replace, edit and remove undo exactly', () => {
  const doc = smallGlobal();
  const hist = history.create(doc);
  history.perform(hist, 'Place', (_Doc, record) => record(model.setLandmark(doc, 5, { type: 'village', name: 'Ash' })));
  history.perform(hist, 'Replace', (_Doc, record) => record(model.setLandmark(doc, 5, { type: 'city', name: 'Karador', notes: 'Capital' })));
  assert.equal(doc.landmarks.size, 1);
  assert.deepEqual({ ...model.getLandmark(doc, 5) }, { type: 'city', name: 'Karador', notes: 'Capital' });
  history.perform(hist, 'Other', (_Doc, record) => record(model.setLandmark(doc, 6, { type: 'cave' })));
  assert.equal(doc.landmarks.size, 2);
  history.perform(hist, 'Remove', (_Doc, record) => record(model.removeLandmark(doc, 5)));
  assert.equal(model.getLandmark(doc, 5), null);
  assert.equal(model.removeLandmark(doc, 5), null, 'removing nothing is a no-op');
  history.undo(hist);
  assert.equal(model.getLandmark(doc, 5).name, 'Karador');
  history.undo(hist);
  history.undo(hist);
  assert.equal(model.getLandmark(doc, 5).name, 'Ash');
  history.undo(hist);
  assert.equal(doc.landmarks.size, 0);
  assert.throws(() => model.setLandmark(doc, 5, { type: 'volcano' }), /landmark type/);
  assert.throws(() => model.setLandmark(doc, 5, { type: 'town', name: 'a\nb' }), /control/);
  assert.throws(() => model.setLandmark(doc, -1, { type: 'town' }), /Unknown tile/);
});

test('overlay validation rejects non-adjacent paths and accepts shared tiles', () => {
  const doc = smallGlobal();
  const roadTiles = path(doc, 10, 4);
  const road = model.addOverlay(doc, { type: 'road', name: "King's Road", style: 'highway', tileIndices: roadTiles }).after;
  assert.equal(road.id, 'road1');
  assert.deepEqual([...road.tileIndices], roadTiles);
  const riverTiles = [roadTiles[1], ...model.neighbors(doc, roadTiles[1]).filter((tileIndex) => !roadTiles.includes(tileIndex)).slice(0, 1)];
  const river = model.addOverlay(doc, { type: 'river', tileIndices: riverTiles }).after;
  assert.equal(river.id, 'river1');
  assert.deepEqual(model.overlaysAt(doc, roadTiles[1]).map((overlay) => overlay.id), ['road1', 'river1']);
  const far = farTile(doc, 10);
  assert.throws(() => model.addOverlay(doc, { type: 'trail', tileIndices: [10, far] }), /not adjacent/);
  assert.throws(() => model.addOverlay(doc, { type: 'trail', tileIndices: [10, 10] }), /not adjacent/);
  assert.throws(() => model.addOverlay(doc, { type: 'trail', tileIndices: [] }), /at least one/);
  assert.throws(() => model.addOverlay(doc, { type: 'canal', tileIndices: [10] }), /overlay type/);
  assert.throws(() => model.addOverlay(doc, { type: 'road', id: 'road1', tileIndices: [10] }), /Duplicate/);
  assert.throws(() => model.addOverlay(doc, { type: 'road', style: 'two words', tileIndices: [10] }), /style/);
  assert.throws(() => model.updateOverlay(doc, 'road1', { tileIndices: [10, far] }), /not adjacent/);
  assert.equal(doc.overlays.length, 2, 'failed mutations change nothing');
  // Seam-crossing paths are accepted when the topology says the tiles are adjacent.
  const topo = doc.topo;
  const cross = topo.tiles.findIndex((tile) => Array.from(topology.neighbors(topo, tile.index))
    .some((otherIndex) => topo.tiles[otherIndex].panelId !== tile.panelId));
  const across = Array.from(topology.neighbors(topo, cross)).find((otherIndex) => topo.tiles[otherIndex].panelId !== topo.tiles[cross].panelId);
  assert.ok(model.addOverlay(doc, { type: 'trail', tileIndices: [cross, across] }));
});

test('overlays and labels round-trip through undo and redo', () => {
  const doc = smallGlobal();
  const hist = history.create(doc);
  const snapshots = [snapshot(doc)];
  const step = (label, mutate) => {
    history.perform(hist, label, mutate);
    snapshots.push(snapshot(doc));
  };
  step('Road', (_Doc, record) => record(model.addOverlay(doc, { type: 'road', tileIndices: path(doc, 20, 3) })));
  step('Trail', (_Doc, record) => record(model.addOverlay(doc, { type: 'trail', tileIndices: path(doc, 40, 2) })));
  step('River', (_Doc, record) => record(model.addOverlay(doc, { type: 'river', name: 'Silverrun', tileIndices: path(doc, 60, 5) })));
  step('Extend', (_Doc, record) => record(model.updateOverlay(doc, 'road1', { tileIndices: path(doc, 20, 4), name: 'Old Road' })));
  step('Remove middle', (_Doc, record) => record(model.removeOverlay(doc, 'trail1')));
  step('Labels', (_Doc, record) => {
    record(model.addLabel(doc, { tileIndex: 3, text: 'The Northern Wastes', category: 'region', rotation: -15 }));
    record(model.addLabel(doc, { tileIndex: 3, text: 'Karador', category: 'city', dx: 2, dy: -1 }));
  });
  step('Edit label', (_Doc, record) => record(model.updateLabel(doc, 'label1', { size: 32, text: 'Wastes' })));
  step('Remove label', (_Doc, record) => record(model.removeLabel(doc, 'label1')));
  assert.deepEqual(doc.overlays.map((overlay) => overlay.id), ['road1', 'river1']);
  assert.deepEqual(doc.labels.map((label) => label.id), ['label2']);
  assert.equal(model.getLabel(doc, 'label2').size, model.LABEL_DEFAULT_SIZES.city);
  assert.equal(model.labelsAt(doc, 3).length, 1);
  for (let index = snapshots.length - 2; index >= 0; index--) {
    history.undo(hist);
    assert.deepEqual(snapshot(doc), snapshots[index], `after undo to step ${index}`);
  }
  assert.equal(history.undo(hist), null);
  for (let index = 1; index < snapshots.length; index++) {
    history.redo(hist);
    assert.deepEqual(snapshot(doc), snapshots[index], `after redo to step ${index}`);
  }
  // Ids come from the current contents, so a freed id is reused.
  assert.equal(model.addOverlay(doc, { type: 'trail', tileIndices: [0] }).after.id, 'trail1');
});

test('label validation', () => {
  const doc = smallGlobal();
  assert.throws(() => model.addLabel(doc, { tileIndex: 0, text: 'x', category: 'continent' }), /category/);
  assert.throws(() => model.addLabel(doc, { tileIndex: 0, text: '  ', category: 'region' }), /empty/);
  assert.throws(() => model.addLabel(doc, { tileIndex: 0, text: 'x', category: 'region', size: 0 }), /positive/);
  assert.throws(() => model.addLabel(doc, { tileIndex: 0, text: 'x', category: 'region', rotation: NaN }), /finite/);
  assert.throws(() => model.addLabel(doc, { tileIndex: doc.tileCount, text: 'x', category: 'region' }), /Unknown tile/);
  assert.throws(() => model.addLabel(doc, { tileIndex: 0, text: 'x', category: 'region', id: '1abc' }), /label id/);
  assert.throws(() => model.updateLabel(doc, 'missing', { text: 'y' }), /Unknown label/);
  assert.equal(doc.labels.length, 0);
});

test('history limit drops the oldest commands and Clear empties both stacks', () => {
  const doc = smallGlobal();
  const hist = history.create(doc, { limit: 3 });
  for (let tileIndex = 0; tileIndex < 5; tileIndex++) {
    history.perform(hist, 'Paint', (_Doc, record) => record(model.setTerrain(doc, tileIndex, terrain.byChar('.').id)));
  }
  assert.equal(hist.undoStack.length, 3);
  while (history.undo(hist)) { /* undo all that remain */ }
  assert.deepEqual(Array.from(doc.terrainIds.subarray(0, 5)), [4, 4, 0, 0, 0]);
  assert.ok(history.canRedo(hist));
  history.clear(hist);
  assert.equal(history.canUndo(hist) || history.canRedo(hist), false);
  assert.throws(() => history.create(doc, { limit: 0 }), /limit/);
});
