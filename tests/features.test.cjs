'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection, Terrain: terrain, Model: model, History: history, View: view, Edit: edit, FileFormat: fileFormat } = loadModules();
const mapFixture = model.createGlobalMap({ panelHexes: 4 });

function localMap(width = 9, height = 7) {
  return model.createLocalMap({
    width, height, systemName: 'regional', scaleName: 'M',
    anchor: { panelId: Object.keys(projection.build().panels)[0], east: 0, north: 0 },
  });
}

function distances(doc, start, excluded = new Set()) {
  const steps = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const tileIndex = queue[head];
    for (const otherIndex of model.neighbors(doc, tileIndex)) {
      if (!steps.has(otherIndex) && !excluded.has(otherIndex)) {
        steps.set(otherIndex, steps.get(tileIndex) + 1);
        queue.push(otherIndex);
      }
    }
  }
  return steps;
}

function assertPath(doc, path, fromIndex, toIndex) {
  assert.equal(path[0], fromIndex);
  assert.equal(path.at(-1), toIndex);
  path.forEach((tileIndex) => assert.ok(model.isTile(doc, tileIndex)));
  for (let index = 1; index < path.length; index++) {
    assert.ok(model.areAdjacent(doc, path[index - 1], path[index]), `connected at ${index}`);
  }
}

function assertUndoable(hist, action) {
  const before = fileFormat.write(hist.doc);
  const undo = hist.undoStack.length;
  const command = action();
  assert.ok(command);
  assert.equal(hist.undoStack.length, undo + 1, 'one command');
  const after = fileFormat.write(hist.doc);
  assert.notEqual(after, before);
  assert.equal(history.undo(hist), command);
  assert.equal(fileFormat.write(hist.doc), before, 'undo restores exact document');
  assert.equal(history.redo(hist), command);
  assert.equal(fileFormat.write(hist.doc), after, 'redo restores exact document');
  assert.equal(fileFormat.write(fileFormat.parse(after)), after, 'edited document remains canonical');
  return command;
}

test('A* is deterministic and shortest against BFS for global and local tiles', () => {
  for (const doc of [mapFixture, localMap()]) {
    for (let start = 0; start < doc.tileCount; start += 17) {
      const steps = distances(doc, start);
      for (let end = 0; end < doc.tileCount; end += 13) {
        const path = edit.findPath(doc, start, end);
        assertPath(doc, path, start, end);
        assert.equal(path.length - 1, steps.get(end));
        assert.deepEqual(edit.findPath(doc, start, end), path);
      }
    }
  }
});

test('A* crosses every seam, including wraparound and tiny partial tiles, in one step', () => {
  const seen = new Set();
  for (const tile of mapFixture.topo.tiles) {
    for (const otherIndex of model.neighbors(mapFixture, tile.index)) {
      const other = mapFixture.topo.tiles[otherIndex];
      if (tile.panelId !== other.panelId) {
        assert.deepEqual(edit.findPath(mapFixture, tile.index, otherIndex), [tile.index, otherIndex]);
        seen.add([tile.panelId, other.panelId].sort().join('|'));
      }
    }
  }
  assert.equal(seen.size, projection.build().seams.length);
});

test('A* handles exclusions, equal endpoints, invalid inputs and unreachable targets', () => {
  const doc = localMap(5, 5);
  const excluded = new Set([11, 12, 13]);
  const path = edit.findPath(doc, 0, 24, excluded);
  assertPath(doc, path, 0, 24);
  assert.equal(path.length - 1, distances(doc, 0, excluded).get(24));
  assert.ok(path.every((tileIndex) => !excluded.has(tileIndex)));
  assert.deepEqual(edit.findPath(doc, 4, 4), [4]);
  assert.throws(() => edit.findPath(doc, -1, 0), /endpoints/);
  assert.throws(() => edit.findPath(doc, 0, doc.tileCount), /endpoints/);
  assert.throws(() => edit.findPath(doc, 12, 24, excluded), /excluded/);
  assert.throws(() => edit.findPath(doc, 0, 24, new Set(model.neighbors(doc, 0))), /No path/);
});

test('overlay create, extend and insert are connected single undo steps', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const hist = history.create(doc);
  assertUndoable(hist, () => edit.setFeature(hist, 'overlay', null, { type: 'river', name: 'Silverrun', tileIndices: [0] }));
  assertUndoable(hist, () => edit.extendOverlay(hist, 'river1', doc.tileCount - 1));
  const before = model.getOverlay(doc, 'river1');
  assertPath(doc, before.tileIndices, 0, doc.tileCount - 1);
  const insert = 2;
  const tileIndex = 50;
  assertUndoable(hist, () => edit.insertOverlayPoint(hist, 'river1', insert, tileIndex));
  const after = model.getOverlay(doc, 'river1');
  assert.deepEqual(after.tileIndices.slice(0, insert + 1), before.tileIndices.slice(0, insert + 1));
  assert.ok(after.tileIndices.includes(tileIndex));
  assertPath(doc, after.tileIndices, 0, doc.tileCount - 1);
  assert.equal(edit.extendOverlay(hist, 'river1', after.tileIndices.at(-1)), null);
});

test('removing overlay points reconnects around the removed tile, including loops', () => {
  const doc = localMap();
  const hist = history.create(doc);
  edit.setFeature(hist, 'overlay', null, { type: 'road', tileIndices: edit.findPath(doc, 0, doc.tileCount - 1) });
  const before = model.getOverlay(doc, 'road1');
  const removed = before.tileIndices[2];
  assertUndoable(hist, () => edit.removeOverlayPoint(hist, 'road1', 2));
  const after = model.getOverlay(doc, 'road1');
  assert.ok(!after.tileIndices.includes(removed));
  assertPath(doc, after.tileIndices, before.tileIndices[0], before.tileIndices.at(-1));
  assertUndoable(hist, () => edit.removeOverlayPoint(hist, 'road1', 0));
  assertUndoable(hist, () => edit.removeOverlayPoint(hist, 'road1', model.getOverlay(doc, 'road1').tileIndices.length - 1));
  const next = model.neighbors(doc, 0)[0];
  edit.setFeature(hist, 'overlay', null, { type: 'trail', tileIndices: [0, next, 0] });
  assertUndoable(hist, () => edit.removeOverlayPoint(hist, 'trail1', 1));
  assert.deepEqual(model.getOverlay(doc, 'trail1').tileIndices, [0]);
  assertUndoable(hist, () => edit.removeOverlayPoint(hist, 'trail1', 0));
  assert.equal(model.getOverlay(doc, 'trail1'), null);
});

test('split shares its junction; join supports all endpoint orientations and preserves properties', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const hist = history.create(doc);
  const original = edit.findPath(doc, 0, doc.tileCount - 1);
  edit.setFeature(hist, 'overlay', null, { type: 'road', name: 'Main Road', style: 'highway', tileIndices: original });
  assertUndoable(hist, () => edit.splitOverlay(hist, 'road1', 3));
  assert.deepEqual(doc.overlays[0].tileIndices, original.slice(0, 4));
  assert.deepEqual(doc.overlays[1].tileIndices, original.slice(3));
  assert.equal(doc.overlays[1].name, 'Main Road');
  assert.equal(doc.overlays[1].style, 'highway');
  assertUndoable(hist, () => edit.joinOverlays(hist, 'road1', 'road2'));
  assert.deepEqual(doc.overlays[0].tileIndices, original);
  assert.equal(doc.overlays.length, 1);
  for (const reverseFirst of [false, true]) {
    for (const reverseSecond of [false, true]) {
      edit.setFeature(hist, 'overlay', null, { type: 'road', name: 'Side road', tileIndices: edit.findPath(doc, 20, 45) });
      const first = model.getOverlay(doc, 'road1'), second = model.getOverlay(doc, 'road2');
      assertUndoable(hist, () => edit.joinOverlays(hist, 'road1', 'road2', reverseFirst, reverseSecond));
      const joined = model.getOverlay(doc, 'road1');
      assertPath(doc, joined.tileIndices, reverseFirst ? first.tileIndices.at(-1) : first.tileIndices[0], reverseSecond ? second.tileIndices[0] : second.tileIndices.at(-1));
      assert.equal(joined.name, first.name);
      assert.equal(joined.style, first.style);
    }
  }
});

test('failed edits leave the document and history intact', () => {
  const doc = localMap(1, 3);
  const hist = history.create(doc);
  edit.setFeature(hist, 'overlay', null, { type: 'road', tileIndices: [0, 1, 2] });
  edit.setFeature(hist, 'overlay', null, { type: 'river', tileIndices: [0] });
  const before = fileFormat.write(doc);
  const undo = hist.undoStack.length;
  const revision = doc.revision;
  for (const action of [
    () => edit.removeOverlayPoint(hist, 'road1', 1),
    () => edit.splitOverlay(hist, 'road1', 0),
    () => edit.splitOverlay(hist, 'road1', 2),
    () => edit.insertOverlayPoint(hist, 'road1', -1, 1),
    () => edit.joinOverlays(hist, 'road1', 'road1'),
    () => edit.joinOverlays(hist, 'road1', 'river1'),
    () => edit.extendOverlay(hist, 'missing', 0),
    () => edit.setFeature(hist, 'overlay', 'road1', { style: 'bad style' }),
    () => edit.setFeature(hist, 'label', null, { tileIndex: 0, category: 'city', text: '' }),
  ]) {
    assert.throws(action);
    assert.equal(fileFormat.write(doc), before);
    assert.equal(hist.undoStack.length, undo);
    assert.equal(doc.revision, revision);
    assert.equal(hist.pending, null);
  }
});

test('landmark place, replace, edit and erase affect only their layer', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const hist = history.create(doc);
  edit.setFeature(hist, 'overlay', null, { type: 'road', tileIndices: [10] });
  const terrainIds = doc.terrainIds.slice();
  for (const type of terrain.LANDMARK_TYPES) {
    assert.match(type.path, /^M/);
    assertUndoable(hist, () => edit.setFeature(hist, 'landmark', 10, { type: type.key, name: type.name }));
    assert.equal(doc.landmarks.size, 1);
  }
  assertUndoable(hist, () => edit.setFeature(hist, 'landmark', 10, { notes: 'Old gate' }));
  assert.equal(edit.setFeature(hist, 'landmark', 10, { notes: 'Old gate' }), null);
  assertUndoable(hist, () => edit.setFeature(hist, 'landmark', 10, null));
  assert.equal(doc.overlays.length, 1);
  assert.deepEqual(doc.terrainIds, terrainIds);
});

test('multiple labels on one tile support every property and undoable erase', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const hist = history.create(doc);
  for (const category of model.LABEL_CATEGORIES) {
    assertUndoable(hist, () => edit.setFeature(hist, 'label', null, { tileIndex: 5, category, text: category }));
  }
  assert.equal(model.labelsAt(doc, 5).length, 3);
  assertUndoable(hist, () => edit.setFeature(hist, 'label', 'label1', { text: 'Grey Hills', category: 'city', size: 12.5, rotation: -43.2, dx: 3.4, dy: -12 }));
  const label = model.getLabel(doc, 'label1');
  assert.equal(edit.setFeature(hist, 'label', 'label1', { dx: 3.4, dy: -12 }), null);
  assert.equal(edit.getFeature(doc, { layer: 'label', key: 'label1' }), label);
  assertUndoable(hist, () => edit.setFeature(hist, 'label', 'label1', null));
  assert.equal(model.labelsAt(doc, 5).length, 2);
  assert.equal(edit.getFeature(doc, { layer: 'label', key: 'label1' }), null);
});

function assertPointClose(a, b) {
  assert.ok(util.pointDistance(a, b) < 1e-8, `${a} != ${b}`);
}

test('feature anchors lie in their tile, including clipped partial tiles', () => {
  const layout = view.buildNetLayout();
  for (const tile of mapFixture.topo.tiles) {
    const anchorPoint = view.featureAnchor(mapFixture.topo, tile.index);
    const copy = view.featureCopies(mapFixture.topo, layout, tile.index).find((item) => item.placement.panelId === tile.panelId);
    const world = projection.applyTransform(copy.frameToWorld, anchorPoint);
    assert.equal(view.hitTest(mapFixture.topo, layout, world).tileIndex, tile.index);
  }
});

test('every cross-seam curve is identical on both panels after unfolding, not a net-spanning line', () => {
  const topo = mapFixture.topo;
  let crossings = 0;
  for (const tile of topo.tiles) {
    for (const otherIndex of model.neighbors(mapFixture, tile.index)) {
      const other = topo.tiles[otherIndex];
      if (tile.panelId === other.panelId) {
        continue;
      }
      const overlay = { tileIndices: [tile.index, otherIndex] };
      const curves = view.overlayCurves(topo, overlay);
      assert.equal(view.overlayCurves(topo, overlay), curves, 'immutable overlay geometry is cached');
      const a = curves.find((curve) => curve.panelId === tile.panelId);
      const b = curves.find((curve) => curve.panelId === other.panelId);
      assert.ok(a && b);
      const bToA = view.panelTransform(other.panelId, tile.panelId);
      for (let pointIndex = 0; pointIndex < 4; pointIndex++) {
        assertPointClose(a.control[pointIndex], projection.applyTransform(bToA, b.control[pointIndex]));
      }
      assertPointClose(a.control[0], view.featureAnchor(topo, tile.index));
      assertPointClose(b.control[3], view.featureAnchor(topo, otherIndex));
      assert.ok(util.pointDistance(a.control[0], a.control[3]) < topo.d * 3);
      const focus = view.buildFocusLayout(tile.panelId);
      const bToWorld = view.findPlacement(focus, other.panelId).frameToWorld;
      assertPointClose(projection.applyTransform(bToWorld, b.control[0]), a.control[0]);
      crossings++;
    }
  }
  assert.ok(crossings > 100);
});

test('successive smooth segments meet with equal tangents, also at panel seams', () => {
  const topo = mapFixture.topo;
  const overlay = { tileIndices: edit.findPath(mapFixture, 0, mapFixture.tileCount - 1) };
  const curves = view.overlayCurves(topo, overlay);
  for (let pointIndex = 1; pointIndex < overlay.tileIndices.length - 1; pointIndex++) {
    const panelId = topo.tiles[overlay.tileIndices[pointIndex]].panelId;
    const before = curves.find((curve) => curve.pointIndex === pointIndex - 1 && curve.panelId === panelId).control;
    const after = curves.find((curve) => curve.pointIndex === pointIndex && curve.panelId === panelId).control;
    assertPointClose(before[3], after[0]);
    assertPointClose(util.subtract(before[3], before[2]), util.subtract(after[1], after[0]));
  }
});

test('adaptive curve hits track the drawn cubic within half a screen pixel', () => {
  const controls = [[0, 0], [1000, -1800], [2000, 1300], [3000, 0]];
  const points = view.flattenCurve(controls);
  assert.deepEqual(points[0], controls[0]);
  assert.deepEqual(points.at(-1), controls[3]);
  for (let step = 0; step <= 1000; step++) {
    const point = view.cubicPoint(controls, step / 1000);
    assert.ok(points.slice(1).some((end, index) => view.distanceToSegment(point, points[index], end) <= 0.5));
  }
  assert.equal(view.distanceToSegment([3, 4], [0, 0], [0, 0]), 5);
});

test('label transforms preserve panel-relative size, clockwise rotation and offsets in every focus view', () => {
  const topo = mapFixture.topo;
  const tileIndex = topo.tiles.find((tile) => !tile.isPartial).index;
  const label = { tileIndex, size: 18, rotation: 90, dx: 12, dy: -24 };
  const t = view.labelTransform(topo, label);
  const unit = topo.d / view.LABEL_UNITS_PER_HEX;
  const center = view.featureAnchor(topo, tileIndex);
  assertPointClose(projection.applyTransform(t, [0, 0]), [center[0] + 12 * unit, center[1] + 24 * unit]);
  assertPointClose(util.subtract(projection.applyTransform(t, [1, 0]), projection.applyTransform(t, [0, 0])), [0, -unit]);
  for (const panelId of Object.keys(topo.panels)) {
    const layout = view.buildFocusLayout(panelId);
    const camera = view.createCamera(900, 600);
    for (const copy of view.featureCopies(topo, layout, tileIndex)) {
      const screen = projection.composeTransforms(t, projection.composeTransforms(copy.frameToWorld, view.worldToScreenTransform(camera)));
      const inverse = projection.invertTransform(screen);
      for (const point of [[0, 0], [12, -32], [-40, 100]]) {
        assertPointClose(projection.applyTransform(inverse, projection.applyTransform(screen, point)), point);
      }
    }
  }
});
