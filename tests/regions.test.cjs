'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Lattice: lattice, Coordinates: coordinates, Model: model, Terrain: terrain, View: view, Regions: regions } = loadModules();

function localMap(width = 9, height = 9) {
  return model.createLocalMap({ width, height, systemName: 'regional', scaleName: 'M', anchor: coordinates.parseUniversal('Eta 0E 0N') });
}

function area(region) {
  return region.loops.reduce((sum, loop) => sum + util.polygonArea(loop), 0);
}

test('one local hex yields one closed six-edge region and no exterior shoreline', () => {
  const doc = localMap(1, 1);
  model.setTerrain(doc, 0, 4);
  const result = regions.build(doc);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].loops.length, 1);
  const loop = result.regions[0].loops[0];
  assert.equal(loop.length, 7);
  assert.deepEqual(loop[0], loop.at(-1));
  assert.ok(Math.abs(area(result.regions[0]) - lattice.hexArea(1)) < 1e-12);
  assert.equal(result.edges.length, 6);
  assert.deepEqual(result.shorelines, []);
});

test('a same-terrain ring retains its hole; disconnected equal terrain stays separate', () => {
  const doc = localMap();
  const center = model.localTileIndex(doc, 4, 4);
  const ring = model.neighbors(doc, center);
  ring.forEach((tileIndex) => model.setTerrain(doc, tileIndex, 10));
  const result = regions.build(doc);
  const forest = result.regions.find((region) => region.terrainId === 10);
  assert.equal(result.regions.length, 3);
  assert.equal(forest.tileIndices.length, 6);
  assert.equal(forest.loops.length, 2);
  assert.ok(forest.loops.some((loop) => util.polygonArea(loop) > 0));
  assert.ok(forest.loops.some((loop) => util.polygonArea(loop) < 0));
  assert.ok(Math.abs(area(forest) - 6 * lattice.hexArea(1)) < 1e-10);
  assert.equal(result.shorelines.length, 2);
  assert.ok(result.shorelines.every((path) => path.isClosed));
  assert.equal(result.shorelines.reduce((sum, path) => sum + path.points.length - 1, 0), 24);
  model.setTerrain(doc, 0, 10);
  assert.equal(regions.build(doc).regions.filter((region) => region.terrainId === 10).length, 2);
});

test('coasts separate land from any water terrain, never colour changes or the export border', () => {
  const doc = localMap(10, 8);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    const [columnIndex, rowIndex] = model.localTileXY(doc, tileIndex);
    model.setTerrain(doc, tileIndex, columnIndex < 5 ? rowIndex % 4 : 4 + rowIndex % 3);
  }
  const result = regions.build(doc);
  assert.equal(result.shorelines.length, 1);
  assert.equal(result.shorelines[0].isClosed, false);
  const expected = result.edges.filter((edge) => edge.cellIndices.length === 2
    && terrain.isWater(result.cells[edge.cellIndices[0]].terrainId) !== terrain.isWater(result.cells[edge.cellIndices[1]].terrainId));
  assert.equal(result.shorelines[0].points.length - 1, expected.length);
  const smoothed = regions.smoothPath(result.shorelines[0]);
  assert.deepEqual(smoothed.points[0], result.shorelines[0].points[0]);
  assert.deepEqual(smoothed.points.at(-1), result.shorelines[0].points.at(-1));
});

test('Chaikin smoothing preserves closure, endpoints and convex panel containment', () => {
  const closed = { isClosed: true, points: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] };
  const smooth = regions.smoothPath(closed);
  assert.equal(smooth.points.length, 17);
  assert.deepEqual(smooth.points[0], smooth.points.at(-1));
  assert.ok(smooth.points.every((point) => util.pointInConvex(point, closed.points.slice(0, -1))));
  assert.deepEqual(regions.smoothPath(closed, 0), closed);
  assert.notEqual(regions.smoothPath(closed, 0).points, closed.points);
  assert.throws(() => regions.smoothPath(closed, 4), /0 to 3/);
});

test('clipped regions cover every global panel with closed loops at XL and L', () => {
  for (const [panelHexes, tileScale] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const doc = model.createGlobalMap({ panelHexes, tileScale });
    doc.terrainIds.set(view.demoTerrain(doc.topo, 1));
    for (const panelId of Object.keys(projection.build().panels)) {
      const result = regions.build(doc, panelId);
      assert.ok(Math.abs(result.regions.reduce((sum, region) => sum + area(region), 0)
        - util.polygonArea(result.outline)) < 1e-5, `${panelHexes} ${tileScale} ${panelId}`);
      for (const region of result.regions) {
        assert.ok(region.loops.every((loop) => loop.length >= 4 && util.pointDistance(loop[0], loop.at(-1)) === 0));
        assert.ok(region.tileIndices.every((tileIndex) => model.getTerrain(doc, tileIndex) === region.terrainId));
      }
      assert.ok(result.points.every((point) => util.pointInConvex(point, result.outline, 1e-7)));
      for (const path of result.shorelines) {
        assert.ok(regions.smoothPath(path).points.every((point) => util.pointInConvex(point, result.outline, 1e-7)));
      }
    }
  }
});

test('n=24 L export cancels interior edges rather than retaining individual tile rings', () => {
  const doc = model.createGlobalMap({ panelHexes: 24, tileScale: 'L' });
  const result = regions.build(doc, coordinates.panelIdByName('Alpha'));
  assert.ok(result.cells.length > 10000);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].loops.length, 1);
  assert.ok(result.regions[0].loops[0].length < 1000);
  assert.deepEqual(result.shorelines, []);
});

test('equatorial export includes the neighbouring owner of each overhanging hex tip', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const owner = coordinates.panelIdByName('Gamma'), draw = coordinates.panelIdByName('Beta');
  const tile = doc.topo.tiles.find((item) => item.panelId === owner
    && item.column === doc.topo.panels[owner].columnCount - 1 && !item.isPartial);
  model.setTerrain(doc, tile.index, 10);
  const result = regions.build(doc, draw);
  const cell = result.cells.find((item) => item.tileIndex === tile.index);
  assert.ok(cell, 'the Beta export includes the Gamma-owned tip');
  assert.equal(cell.terrainId, 10);
  const area = util.polygonArea(cell.vertexIndices.map((index) => result.points[index]));
  assert.ok(area > 0 && area < lattice.hexArea(1) / 4);
  const tipRegion = result.regions.find((region) => region.terrainId === 10);
  assert.deepEqual(tipRegion.tileIndices, [tile.index]);
  assert.ok(result.shorelines.every((path) => !path.isClosed), 'no coastline is invented along the panel cut');
});

test('random local terrain partitions preserve area and topology without modifying the model', () => {
  const random = util.createRng(140);
  for (let trial = 0; trial < 20; trial++) {
    const doc = localMap(12, 12);
    for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
      model.setTerrain(doc, tileIndex, Math.floor(random() * 17));
    }
    const before = doc.terrainIds.slice(), revision = doc.revision;
    const result = regions.build(doc);
    assert.equal(result.cells.length, doc.tileCount);
    assert.ok(Math.abs(result.regions.reduce((sum, region) => sum + area(region), 0) - doc.tileCount * lattice.hexArea(1)) < 1e-8);
    assert.deepEqual(doc.terrainIds, before);
    assert.equal(doc.revision, revision);
  }
});

test('region export rejects invalid scope and ambiguous boundaries explicitly', () => {
  assert.throws(() => regions.build(localMap(), 'Alpha'), /panel/);
  assert.throws(() => regions.build(model.createGlobalMap({ panelHexes: 4 })), /panel/);
  assert.throws(() => regions.build(model.createGlobalMap({ panelHexes: 4 }), 'constructor'), /panel/);
  assert.throws(() => regions.tracePaths([{ indexA: 0, indexB: 1 }, { indexA: 0, indexB: 2 }], [[0, 0], [1, 0], [0, 1]]), /Ambiguous/);
});
