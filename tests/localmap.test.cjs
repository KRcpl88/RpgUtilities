'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Lattice: lattice, Topology: topology, Coordinates: coordinates, Model: model, View: view, Edit: edit, History: history, FileFormat: fileFormat } = loadModules();

function localMap(systemName = 'regional', scaleName = 'M', parity = 0, width = 8, height = 6) {
  const miles = lattice.scaleMiles(systemName, scaleName);
  return model.createLocalMap({
    width, height, systemName, scaleName,
    anchor: coordinates.makeLocation('Hxz+-', parity * lattice.columnSpacing(miles), parity * miles / 2),
  });
}

test('all eight local scales use normalized geometry and preserve their universal distances', () => {
  for (const systemName of ['regional', 'local']) {
    for (const scaleName of lattice.SIZES) {
      for (const parity of systemName === 'regional' ? [0, 1] : [0]) {
        const doc = localMap(systemName, scaleName, parity);
        const geometry = view.mapGeometry(doc);
        assert.equal(doc.topo, null);
        assert.equal(doc.local.parity, parity);
        assert.equal(geometry.d, 1);
        assert.equal(geometry, view.mapGeometry(doc), 'geometry is cached by local configuration');
        assert.equal(view.mapLayout(doc), geometry.layout);
        assert.equal(geometry.layout.placements.length, 1);
        assert.equal(view.panelTileGroups(geometry, 'local').length, 1);
        assert.deepEqual([...view.panelTileGroups(geometry, 'local')[0].tileIndices], geometry.tiles.map((tile) => tile.index));
        for (const tile of geometry.tiles) {
          const location = model.tileToUniversal(doc, tile.index);
          const [columnIndex, rowIndex] = model.localTileXY(doc, tile.index);
          assert.ok(Math.abs((location.east - doc.local.anchor.east) / model.hexMiles(doc) - tile.center[0]) < 1e-10);
          assert.ok(Math.abs((location.north - doc.local.anchor.north) / model.hexMiles(doc) - tile.center[1]) < 1e-10);
          assert.deepEqual(coordinates.universalToLocalTile(doc.local, location), [columnIndex, rowIndex]);
          assert.equal(view.hitTest(geometry, geometry.layout, tile.center).tileIndex, tile.index);
          assert.equal(tile.isPartial, false);
          for (const neighbor of model.neighbors(doc, tile.index)) {
            assert.ok(Math.abs(util.pointDistance(tile.center, geometry.tiles[neighbor].center) - 1) < 1e-12);
          }
        }
      }
    }
  }
});

test('regional S through XL anchors of either parity align with each panel lattice', () => {
  for (const scaleName of lattice.SIZES) {
    for (const panelId of ['Hxz+-', 'Hyz+-', 'Sy+']) {
      const grid = topology.panelLattice(panelId, 24, lattice.scaleRatio('regional', 'XL', scaleName));
      for (const q of [-3, -2, 0, 1]) {
        const anchorPoint = topology.latticeCenter(grid, q, 2).map((d) => d * grid.milesPerEdge);
        const doc = model.createLocalMap({
          width: 5, height: 4, systemName: 'regional', scaleName, isFlat: true,
          anchor: coordinates.makeLocation(panelId, anchorPoint[0] + grid.d * grid.milesPerEdge / 10, anchorPoint[1]),
        });
        assert.equal(doc.local.parity, lattice.isOdd(q) ? 1 : 0);
        for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
          const [columnIndex, rowIndex] = model.localTileXY(doc, tileIndex);
          const location = model.tileToUniversal(doc, tileIndex);
          const expected = topology.latticeCenter(grid, q + columnIndex, 2 - rowIndex).map((d) => d * grid.milesPerEdge);
          assert.ok(util.pointDistance(expected, [location.east, location.north]) < 1e-8);
        }
      }
    }
  }
});

test('local hit testing includes full hex tips, rejects gaps, and fits one-row/column maps', () => {
  for (const parity of [0, 1]) {
    for (const [width, height] of [[1, 1], [1, 7], [7, 1], [8, 6]]) {
      const doc = localMap('regional', 'L', parity, width, height);
      const geometry = view.mapGeometry(doc);
      const layout = view.mapLayout(doc);
      const outlineShape = view.getFrameOutline(geometry, 'local');
      for (const tile of geometry.tiles) {
        for (const vertex of lattice.hexPolygon(tile.center, 1)) {
          assert.ok(util.pointInConvex(vertex, outlineShape));
          const interior = util.add(tile.center, util.scale(util.subtract(vertex, tile.center), 0.999));
          assert.equal(view.hitTest(geometry, layout, interior).tileIndex, tile.index);
        }
      }
      for (const [columnIndex, rowIndex] of [[-1, 0], [0, -1], [width, 0], [0, height], [width, height]]) {
        assert.equal(view.hitTest(geometry, layout, coordinates.localTilePoint(doc.local, columnIndex, rowIndex)), null);
      }
      assert.equal(view.hitTest(geometry, layout, [layout.bounds[0] + 1e-5, layout.bounds[1] + 1e-5]), null);
      const camera = view.createCamera();
      view.resizeCamera(camera, 600, 400);
      view.fitBounds(camera, layout.bounds);
      for (const vertex of outlineShape) {
        const [x, y] = view.worldToScreen(camera, vertex);
        assert.ok(x >= 0 && x <= 600 && y >= 0 && y <= 400);
      }
    }
  }
});

test('local pointer hit testing is not restricted to the file-coordinate snap radius', () => {
  const doc = localMap();
  assert.deepEqual(coordinates.localPointToTile(doc.local, [0.4, 0]), [0, 0]);
  const location = model.tileToUniversal(doc, 0);
  assert.equal(coordinates.universalToLocalTile(doc.local, { ...location, east: location.east + 0.4 * model.hexMiles(doc) }), null);
});

test('large local rectangles fit below the global zoom floor and still zoom about the cursor', () => {
  const doc = localMap('local', 'S', 0, 300, 260);
  const layout = view.mapLayout(doc);
  const camera = view.createCamera();
  view.resizeCamera(camera, 600, 400);
  view.fitBounds(camera, layout.bounds);
  assert.ok(camera.scale < view.MIN_SCALE);
  const fitScale = camera.scale;
  const cursor = [80, 110];
  const before = view.screenToWorld(camera, cursor);
  view.zoomAt(camera, cursor, 0.5);
  assert.ok(util.pointDistance(view.screenToWorld(camera, cursor), before) < 1e-10);
  view.zoomAt(camera, cursor, 1e-10);
  assert.equal(camera.scale, fitScale / 4);
  view.fitBounds(camera, view.buildNetLayout().bounds);
  assert.equal(camera.minScale, view.MIN_SCALE, 'global fit restores its usual minimum');
});

test('local edge strokes, brush and flood-fill are bounded and undoable for both parities', () => {
  for (const parity of [0, 1]) {
    const doc = localMap('regional', 'M', parity, 20, 12);
    const geometry = view.mapGeometry(doc);
    const hist = history.create(doc);
    const stroke = edit.beginStroke(hist, 4, 1);
    const from = [-3, -4.25], to = [21, -4.25];
    edit.strokeTo(stroke, geometry.layout, from);
    edit.strokeTo(stroke, geometry.layout, to);
    const command = edit.endStroke(stroke);
    assert.ok(command.changes.length > 30);
    for (let sample = 0; sample <= 1000; sample++) {
      const point = util.add(from, util.scale(util.subtract(to, from), sample / 1000));
      const hit = view.hitTest(geometry, geometry.layout, point);
      if (hit) assert.equal(model.getTerrain(doc, hit.tileIndex), 4);
    }
    assert.ok(edit.brushTiles(doc, 0, 5).every((tileIndex) => model.isTile(doc, tileIndex)));
    const painted = doc.terrainIds.slice();
    history.undo(hist);
    assert.ok(doc.terrainIds.every((id) => id === 0));
    history.redo(hist);
    assert.deepEqual(doc.terrainIds, painted);
    history.undo(hist);
    assert.equal(edit.fill(hist, 0, 5).tileIndices.length, doc.tileCount);
    history.undo(hist);
    assert.ok(doc.terrainIds.every((id) => id === 0));
  }
});

test('local features remain in one flat frame beyond the anchor panel boundary', () => {
  const doc = model.createLocalMap({
    width: 12, height: 9, systemName: 'regional', scaleName: 'XL',
    anchor: coordinates.parseUniversal('Eta 10000E 10000N'),
  });
  const geometry = view.mapGeometry(doc);
  const tileIndices = edit.findPath(doc, 0, doc.tileCount - 1);
  model.addOverlay(doc, { type: 'road', tileIndices });
  model.addLabel(doc, { tileIndex: 22, category: 'region', text: 'Beyond the panel', dx: 48, dy: 24, rotation: 90 });
  const curves = view.overlayCurves(geometry, doc.overlays[0]);
  assert.equal(curves.length, tileIndices.length - 1);
  curves.forEach((curve, index) => {
    assert.equal(curve.panelId, 'local');
    assert.deepEqual(curve.control[0], geometry.tiles[tileIndices[index]].center);
    assert.deepEqual(curve.control[3], geometry.tiles[tileIndices[index + 1]].center);
  });
  assert.equal(view.featureCopies(geometry, geometry.layout, 22).length, 1);
  const transform = view.labelTransform(geometry, doc.labels[0]);
  const center = geometry.tiles[22].center;
  assert.deepEqual(transform.slice(4), [center[0] + 1, center[1] - 0.5]);
  assert.ok(Math.abs(transform[1] + 1 / 48) < 1e-12);
  assert.equal(model.tileToUniversal(doc, doc.tileCount - 1).panelId, doc.local.anchor.panelId);
});

test('arbitrary free anchors produce canonical files after terrain and feature edits at every yard scale', () => {
  for (const scaleName of lattice.SIZES) {
    const anchor = coordinates.parseUniversal('Eta 123.456789E 98.765432N');
    const doc = model.createLocalMap({ width: 8, height: 6, systemName: 'local', scaleName, anchor });
    const hist = history.create(doc);
    edit.fill(hist, 0, 4);
    edit.setFeature(hist, 'landmark', 1, { type: 'village', name: 'Village' });
    edit.setFeature(hist, 'label', null, { tileIndex: 2, category: 'location', text: 'Label', rotation: 37, dx: 4 });
    edit.setFeature(hist, 'overlay', null, { type: 'river', tileIndices: edit.findPath(doc, 0, 47) });
    const text = fileFormat.write(doc);
    const parsed = fileFormat.parse(text);
    assert.equal(fileFormat.write(parsed), text);
    assert.deepEqual(parsed.terrainIds, doc.terrainIds);
    assert.deepEqual(parsed.landmarks, doc.landmarks);
    assert.deepEqual(parsed.labels, doc.labels);
    assert.deepEqual(parsed.overlays, doc.overlays);
    assert.deepEqual(doc.local.anchor, anchor, 'saving never mutates the free anchor');
    assert.ok(util.pointDistance([anchor.east, anchor.north], [parsed.local.anchor.east, parsed.local.anchor.north]) < doc.local.hexMiles / 10);
    for (let tileIndex = 0; tileIndex < parsed.tileCount; tileIndex++) {
      assert.deepEqual(coordinates.universalToLocalTile(parsed.local, model.tileToUniversal(parsed, tileIndex)), model.localTileXY(parsed, tileIndex));
    }
  }
});

test('local configuration rejects invalid dimensions, references, scales and anchors', () => {
  const options = { width: 8, height: 6, systemName: 'regional', scaleName: 'M', anchor: coordinates.parseUniversal('Eta 0E 0N') };
  for (const changes of [
    { width: 0 }, { height: -1 }, { width: 1.5 }, { width: Infinity },
    { width: Number.MAX_SAFE_INTEGER + 1 }, { width: 1e9, height: 1e9 },
    { panelHexes: 0 }, { panelHexes: 3 }, { panelHexes: Infinity },
    { systemName: 'unknown' }, { scaleName: 'XXL' }, { anchor: null },
    { anchor: { ...options.anchor, east: Infinity } }, { anchor: { ...options.anchor, north: NaN } },
    { anchor: { ...options.anchor, panelId: 'unknown' } },
  ]) {
    assert.throws(() => coordinates.createLocalMap({ ...options, ...changes }));
  }
  assert.throws(() => coordinates.parseUniversal(`Eta ${'9'.repeat(400)}E 0N`), /finite/);
  assert.throws(() => model.tileToUniversal(localMap(), -1), /tile/i);
});
