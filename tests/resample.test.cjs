'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Lattice: lattice, Topology: topology, Coordinates: coordinates, Terrain: terrain, Model: model, History: history, Resample: resample, FileFormat: fileFormat } = loadModules();

const MILES_PER_EDGE = projection.getMilesPerEdge(topology.DEFAULT_PANEL_HEXES);
const TERRAIN_COUNT = terrain.TERRAINS.length;

function localMap(systemName, scaleName, width, height, panelId = 'Hxz+-', east = 0, north = 0) {
  return model.createLocalMap({
    width, height, systemName, scaleName, anchor: coordinates.makeLocation(panelId, east, north),
  });
}

function pointDistance(a, b) {
  return Math.hypot(a.east - b.east, a.north - b.north);
}

// Index of the source tile whose centre is nearest (hex lattices are Voronoi cells).
function nearest(source, location) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    const distance = pointDistance(model.tileToUniversal(source, tileIndex), location);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = tileIndex;
    }
  }
  return { tileIndex: bestIndex, distance: bestDistance };
}

test('upscaling repeats each original tile across the smaller hexes inside it', () => {
  const source = localMap('regional', 'M', 4, 4);
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    source.terrainIds[tileIndex] = tileIndex % TERRAIN_COUNT;
  }
  const target = resample.rescale(source, 'regional', 'S');
  assert.deepEqual([target.local.width, target.local.height], [24, 24]);
  let checked = 0;
  for (let tileIndex = 0; tileIndex < target.tileCount; tileIndex++) {
    const hit = nearest(source, model.tileToUniversal(target, tileIndex));
    if (hit.distance < 2.9) {
      assert.equal(target.terrainIds[tileIndex], source.terrainIds[hit.tileIndex], `tile ${tileIndex}`);
      checked++;
    }
  }
  assert.ok(checked > 400, `${checked} tiles checked`);
});

test('downscaling takes the most common terrain of the tiles each larger hex covers', () => {
  const source = localMap('regional', 'S', 24, 18);
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    const [columnIndex, rowIndex] = model.localTileXY(source, tileIndex);
    source.terrainIds[tileIndex] = (columnIndex + 2 * rowIndex) % 7 === 0 ? 6 : columnIndex < 10 ? 2 : 4;
  }
  const target = resample.rescale(source, 'regional', 'M');
  assert.deepEqual([target.local.width, target.local.height], [4, 3]);
  // Source centres strictly inside a target hex vote for it; centres on a hex edge may
  // go either way, so only tiles whose winner beats the runner-up by more than their edge
  // count are checked.
  const inradius = target.local.hexMiles / 2;
  const normals = [[0, 1], [Math.sqrt(3) / 2, 0.5], [Math.sqrt(3) / 2, -0.5]];
  const getReach = (center, location) => Math.max(...normals.map(([x, y]) =>
    Math.abs((location.east - center.east) * x + (location.north - center.north) * y)));
  const votes = Array.from({ length: target.tileCount }, () => new Array(TERRAIN_COUNT).fill(0));
  const edge = new Array(target.tileCount).fill(0);
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    const location = model.tileToUniversal(source, tileIndex);
    for (let targetIndex = 0; targetIndex < target.tileCount; targetIndex++) {
      const reach = getReach(model.tileToUniversal(target, targetIndex), location);
      if (reach < inradius - 1e-6) {
        votes[targetIndex][source.terrainIds[tileIndex]]++;
      } else if (reach < inradius + 1e-6) {
        edge[targetIndex]++;
      }
    }
  }
  let checked = 0;
  votes.forEach((voteCounts, tileIndex) => {
    const sorted = [...voteCounts].sort((indexA, indexB) => indexB - indexA);
    if (sorted[0] - sorted[1] > edge[tileIndex]) {
      assert.equal(target.terrainIds[tileIndex], voteCounts.indexOf(sorted[0]), `tile ${tileIndex}`);
      checked++;
    }
  });
  assert.ok(checked >= 6, `${checked} tiles checked`);
});

test('global maps rescale between XL and L and back without losing terrain', () => {
  const global = model.createGlobalMap({ name: 'World' });
  for (let tileIndex = 0; tileIndex < global.tileCount; tileIndex++) {
    global.terrainIds[tileIndex] = (tileIndex * 7) % TERRAIN_COUNT;
  }
  const fine = resample.rescale(global, 'regional', 'L');
  assert.equal(fine.kind, 'global');
  assert.equal(fine.global.tileScale, 'L');
  assert.equal(fine.name, 'World');
  const back = resample.rescale(fine, 'regional', 'XL');
  // Only a few tiny clipped seam pieces hold no finer tile's anchor; they take the
  // terrain under their own anchor instead.
  const changed = [];
  for (let tileIndex = 0; tileIndex < global.tileCount; tileIndex++) {
    if (back.terrainIds[tileIndex] !== global.terrainIds[tileIndex]) {
      changed.push(tileIndex);
    }
  }
  assert.ok(changed.every((tileIndex) => global.topo.tiles[tileIndex].pieces), 'only partial tiles may change');
  assert.ok(changed.length < global.tileCount / 200, `${changed.length} tiles changed`);
  assert.throws(() => resample.rescale(global, 'regional', 'M'), /cannot use/);
  assert.deepEqual(resample.rescaleOptions(global), [['regional', 'XL'], ['regional', 'L']]);
});

test('panel maps rescale to M and local maps to any scale', () => {
  const panel = model.createPanelMap({ panelId: 'Sx+', tileScale: 'L' });
  panel.terrainIds.fill(3);
  const medium = resample.rescale(panel, 'regional', 'M');
  assert.equal(medium.global.panelId, 'Sx+');
  assert.ok(medium.terrainIds.every((terrainId) => terrainId === 3));
  const local = localMap('regional', 'S', 3, 2);
  local.terrainIds.fill(5);
  assert.equal(resample.rescaleOptions(local).length, 8);
  const yard = resample.rescale(local, 'local', 'L');
  assert.equal(yard.local.systemName, 'local');
  assert.equal(yard.topo, null);
  // Fine hexes along the old hexes' zig-zag edge may fall outside and stay water.
  assert.ok(yard.terrainIds.every((terrainId) => terrainId === 5 || terrainId === terrain.WATER_ID));
  assert.ok(yard.terrainIds.filter((terrainId) => terrainId === 5).length > 0.8 * yard.tileCount);
});

test('local rescaling keeps the north-west corner of the map', () => {
  const source = localMap('regional', 'M', 10, 8, 'Hxz+-', 300, 200);
  for (const [systemName, scaleName] of [['regional', 'S'], ['regional', 'L'], ['local', 'XL']]) {
    const target = resample.rescale(source, systemName, scaleName);
    const old = source.local.hexMiles;
    const newHexMiles = target.local.hexMiles;
    const oldCorner = [source.local.anchor.east - old / Math.sqrt(3), source.local.anchor.north + old / 2];
    const newCorner = [target.local.anchor.east - newHexMiles / Math.sqrt(3), target.local.anchor.north + newHexMiles / 2];
    // Regional anchors snap to the lattice of the new scale.
    assert.ok(Math.hypot(oldCorner[0] - newCorner[0], oldCorner[1] - newCorner[1]) <= newHexMiles, `${systemName} ${scaleName}`);
  }
});

test('features follow their tiles; overlays are bridged, split at the map edge, and labels keep their ground size', () => {
  const source = localMap('regional', 'M', 6, 4);
  const index = (columnIndex, rowIndex) => model.localTileIndex(source, columnIndex, rowIndex);
  model.setLandmark(source, index(1, 1), { type: 'town', name: 'Ford' });
  model.addLabel(source, { tileIndex: index(2, 2), text: 'Vale', category: 'region', size: 24, dx: 6, dy: -3 });
  model.addOverlay(source, { type: 'road', id: 'road1', tileIndices: [index(0, 1), index(1, 1), index(2, 1), index(3, 1), index(4, 1), index(5, 1)] });

  const fine = resample.rescale(source, 'regional', 'S');
  assert.equal(fine.landmarks.size, 1);
  const [[landmarkTile, landmark]] = [...fine.landmarks];
  assert.equal(landmark.name, 'Ford');
  assert.ok(pointDistance(model.tileToUniversal(fine, landmarkTile), model.tileToUniversal(source, index(1, 1))) < 1e-6);
  const [label] = fine.labels;
  assert.deepEqual([label.text, label.size, label.dx, label.dy], ['Vale', 144, 36, -18]);
  assert.equal(fine.overlays.length, 1);
  const road = fine.overlays[0];
  for (let index = 1; index < road.tileIndices.length; index++) {
    assert.ok(model.areAdjacent(fine, road.tileIndices[index - 1], road.tileIndices[index]));
  }
  assert.ok(road.tileIndices.length > 25, 'the upscaled road is bridged tile by tile');
  assert.equal(fine.revision, 0);
  assert.equal(fileFormat.write(fileFormat.parse(fileFormat.write(fine))), fileFormat.write(fine));

  // A crop through the middle of the road keeps the part inside; a road leaving and
  // re-entering the crop becomes two overlays with unique ids.
  model.addOverlay(source, { type: 'river', id: 'river1', tileIndices: [index(0, 2), index(0, 1), index(0, 0), index(1, 0), index(2, 0), index(2, 1), index(2, 2)] });
  const corner = model.tileToUniversal(source, index(0, 1));
  const crop = resample.crop(source, { width: 3, height: 2, systemName: 'regional', scaleName: 'M', anchor: corner });
  assert.deepEqual(crop.overlays.map((overlay) => overlay.id), ['road1', 'river1', 'river1_2']);
  assert.equal(crop.overlays[0].tileIndices.length, 3);
});

test('cropping a global map into a seam-crossing local map copies each panel\'s tiles', () => {
  const global = model.createGlobalMap({ tileScale: 'L' });
  for (let tileIndex = 0; tileIndex < global.tileCount; tileIndex++) {
    global.terrainIds[tileIndex] = global.topo.tiles[tileIndex].panelId === 'Hxy++' ? 7 : 2;
  }
  const crop = resample.crop(global, {
    name: 'Strait', width: 30, height: 10, systemName: 'regional', scaleName: 'L',
    anchor: coordinates.makeLocation('Hyz+-', 0.6 * MILES_PER_EDGE, 0.2 * MILES_PER_EDGE),
  });
  assert.equal(crop.name, 'Strait');
  assert.ok(crop.topo && crop.topo.span);
  for (const tile of crop.topo.tiles) {
    assert.equal(crop.terrainIds[tile.index], tile.panelId === 'Hxy++' ? 7 : 2);
    const globalIndex = coordinates.universalToTile(global.topo, model.tileToUniversal(crop, tile.index));
    assert.ok(globalIndex >= 0, 'crop tiles coincide with global tiles of the same scale');
  }
  assert.equal(crop.local.panelHexes, global.global.panelHexes);
});

test('whole-panel crops export the entire panel at the original, finer or coarser scale', () => {
  const source = model.createGlobalMap({ panelHexes: 2, tileScale: 'L', name: 'World' });
  source.terrainIds.fill(3);
  const feature = resample.tileAtPoint(source, 'Hxz+-', [0, 0]);
  model.setLandmark(source, feature, { type: 'town', name: 'Centre' });
  model.addLabel(source, { tileIndex: feature, category: 'region', text: 'Coast' });
  model.addOverlay(source, { type: 'trail', tileIndices: [feature] });
  const before = fileFormat.write(source);
  for (const scaleName of ['XL', 'L', 'M']) {
    const crop = resample.crop(source, { kind: 'panel', panelId: 'Hxz+-', scaleName, name: 'Panel crop' });
    assert.equal(crop.kind, 'panel');
    assert.equal(crop.name, 'Panel crop');
    assert.deepEqual(crop.global, { panelHexes: 2, tileScale: scaleName, panelId: 'Hxz+-' });
    assert.ok(crop.terrainIds.every((terrainId) => terrainId === 3));
    assert.equal(crop.landmarks.size, 1);
    assert.equal(crop.labels.length, 1);
    assert.equal(crop.overlays.length, 1, 'single-tile paths survive the panel crop');
    assert.equal(crop.revision, 0);
    assert.equal(fileFormat.write(fileFormat.parse(fileFormat.write(crop))), fileFormat.write(crop));
  }
  assert.equal(fileFormat.write(source), before);
  assert.throws(() => resample.crop(source, { kind: 'panel', panelId: 'Hxz+-', scaleName: 'S' }), /scale/i);
});

test('same-scale merges replace land and water only inside the imported rectangle', () => {
  const target = localMap('regional', 'S', 6, 5);
  target.terrainIds.fill(6);
  const anchor = model.tileToUniversal(target, model.localTileIndex(target, 2, 1));
  const source = model.createLocalMap({ width: 2, height: 2, systemName: 'regional', scaleName: 'S', anchor });
  source.terrainIds.set([0, 2, 4, 0]);
  const sourceText = fileFormat.write(source);
  const geometry = target.local;
  const result = resample.merge(source, target);
  assert.equal(result.coveredCount, 4);
  assert.equal(target.local, geometry);
  for (let tileIndex = 0; tileIndex < target.tileCount; tileIndex++) {
    const [columnIndex, rowIndex] = model.localTileXY(target, tileIndex);
    const expectedCount = columnIndex >= 2 && columnIndex < 4 && rowIndex >= 1 && rowIndex < 3 ? source.terrainIds[(rowIndex - 1) * 2 + columnIndex - 2] : 6;
    assert.equal(target.terrainIds[tileIndex], expectedCount, `tile ${tileIndex}`);
  }
  assert.equal(fileFormat.write(source), sourceText);
});

test('outside imports leave local and isolated panel maps completely unchanged', () => {
  const local = localMap('regional', 'S', 3, 3);
  const farAway = localMap('regional', 'S', 3, 3, 'Hxz+-', 1000, 1000);
  const panel = model.createPanelMap({ panelHexes: 2, panelId: 'Sx+', tileScale: 'L' });
  const otherPanel = model.createPanelMap({ panelHexes: 2, panelId: 'Sx-', tileScale: 'L' });
  for (const [target, source] of [[local, farAway], [panel, otherPanel]]) {
    target.terrainIds.fill(5);
    source.terrainIds.fill(7);
    model.setLandmark(target, 0, { type: 'village', name: 'Keep' });
    model.addLabel(target, { tileIndex: 0, category: 'region', text: 'Keep' });
    const before = fileFormat.write(target);
    const revision = target.revision;
    const h = history.create(target);
    const command = history.perform(h, 'Import', (doc, record) => {
      assert.equal(resample.merge(source, doc, record).coveredCount, 0);
    });
    assert.equal(command, null);
    assert.equal(target.revision, revision);
    assert.equal(fileFormat.write(target), before);
  }
});

test('merge rejects incompatible hex systems or world sizes without changing the map', () => {
  const regional = localMap('regional', 'S', 2, 2);
  const yard = localMap('local', 'M', 2, 2);
  for (const [source, target] of [[regional, yard], [yard, regional],
    [yard, model.createGlobalMap({ panelHexes: 2 })]]) {
    const before = fileFormat.write(target);
    const revision = target.revision;
    assert.throws(() => resample.merge(source, target), /Cannot merge local.*regional/);
    assert.equal(fileFormat.write(target), before);
    assert.equal(target.revision, revision);
  }
  assert.throws(() => resample.merge(model.createGlobalMap({ panelHexes: 2 }), regional), /same panel size/);
});

test('coarser imports repeat terrain into finer yard-scale hexes without clearing outside tiles', () => {
  const target = localMap('local', 'S', 24, 24, 'Hxz+-', -0.003, 0.003);
  target.terrainIds.fill(6);
  const source = localMap('local', 'M', 1, 1);
  source.terrainIds.fill(2);
  const result = resample.merge(source, target);
  assert.ok(result.coveredCount > 50 && result.coveredCount < target.tileCount);
  const covered = new Set(result.tileIndices);
  for (let tileIndex = 0; tileIndex < target.tileCount; tileIndex++) {
    assert.equal(target.terrainIds[tileIndex], covered.has(tileIndex) ? 2 : 6);
  }
});

test('finer imports use majority votes, including coarse tiles whose centres are outside the source', () => {
  const target = localMap('regional', 'M', 6, 6);
  target.terrainIds.fill(6);
  const anchor = model.tileToUniversal(target, model.localTileIndex(target, 2, 2));
  const source = model.createLocalMap({ width: 9, height: 9, systemName: 'regional', scaleName: 'S', anchor });
  source.terrainIds.fill(4);
  source.terrainIds[0] = 2;
  const votes = new Map();
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    const point = resample.tilePoint(source, tileIndex);
    const targetIndex = resample.tileAtPoint(target, point.panelId, point.point);
    assert.ok(targetIndex >= 0);
    if (!votes.has(targetIndex)) {
      votes.set(targetIndex, new Array(TERRAIN_COUNT).fill(0));
    }
    votes.get(targetIndex)[source.terrainIds[tileIndex]]++;
  }
  const result = resample.merge(source, target);
  assert.equal(result.coveredCount, votes.size);
  let offCentre = 0;
  for (const tileIndex of result.tileIndices) {
    const voteCounts = votes.get(tileIndex);
    assert.equal(target.terrainIds[tileIndex], voteCounts.indexOf(Math.max(...voteCounts)));
    const point = resample.tilePoint(target, tileIndex);
    if (resample.tileAtPoint(source, point.panelId, point.point) < 0) {
      offCentre++;
    }
  }
  assert.ok(offCentre > 0, 'partial coverage still replaces a coarse tile');
  for (let tileIndex = 0; tileIndex < target.tileCount; tileIndex++) {
    if (!votes.has(tileIndex)) {
      assert.equal(target.terrainIds[tileIndex], 6);
    }
  }
});

test('regional rectangles merge into globes, and globe imports clip to a panel or rectangle', () => {
  const global = model.createGlobalMap();
  global.terrainIds.fill(6);
  const source = localMap('regional', 'XL', 1, 1);
  source.terrainIds.fill(3);
  const result = resample.merge(source, global);
  assert.equal(result.coveredCount, 1);
  assert.equal(global.terrainIds[result.tileIndices[0]], 3);
  assert.equal(global.terrainIds.filter((terrainId) => terrainId === 6).length, global.tileCount - 1);
  global.terrainIds.fill(5);
  const panel = model.createPanelMap({ panelId: 'Hxz+-', tileScale: 'L' });
  const rectangle = localMap('regional', 'S', 5, 5);
  for (const target of [panel, rectangle]) {
    const tileCount = target.tileCount;
    const topo = target.topo;
    const local = target.local;
    const merged = resample.merge(global, target);
    assert.equal(merged.coveredCount, tileCount);
    assert.ok(target.terrainIds.every((terrainId) => terrainId === 5));
    assert.equal(target.tileCount, tileCount);
    assert.equal(target.topo, topo);
    assert.equal(target.local, local);
  }
});

test('panel imports replace their clipped boundary hexes on the globe, including features in a clipped tip', () => {
  const source = model.createPanelMap({ panelHexes: 2, panelId: 'Hyz+-', tileScale: 'L' });
  const target = model.createGlobalMap({ panelHexes: 2, tileScale: 'L' });
  source.terrainIds.fill(3);
  target.terrainIds.fill(6);
  const covered = new Set();
  let boundarySource = -1;
  let boundaryTarget = -1;
  for (let tileIndex = 0; tileIndex < source.tileCount; tileIndex++) {
    const point = resample.tilePoint(source, tileIndex);
    const targetIndex = resample.tileAtPoint(target, point.panelId, point.point);
    assert.ok(targetIndex >= 0);
    covered.add(targetIndex);
    const center = resample.tilePoint(target, targetIndex);
    if (resample.tileAtPoint(source, center.panelId, center.point) < 0) {
      boundarySource = tileIndex;
      boundaryTarget = targetIndex;
    }
  }
  assert.ok(boundarySource >= 0, 'isolated panels include tips owned by neighbouring globe tiles');
  model.setLandmark(source, boundarySource, { type: 'village', name: 'Edge' });
  model.addLabel(source, { tileIndex: boundarySource, category: 'region', text: 'Edge' });
  model.addOverlay(source, { type: 'trail', tileIndices: [boundarySource] });
  assert.equal(resample.merge(source, target).coveredCount, covered.size);
  for (let tileIndex = 0; tileIndex < target.tileCount; tileIndex++) {
    assert.equal(target.terrainIds[tileIndex], covered.has(tileIndex) ? 3 : 6);
  }
  assert.equal(model.getLandmark(target, boundaryTarget).name, 'Edge');
  assert.equal(target.labels[0].tileIndex, boundaryTarget);
  assert.deepEqual(target.overlays[0].tileIndices, [boundaryTarget]);
});

test('resampling never treats the clipped-away part of a boundary hex as map coverage', () => {
  const panel = model.createPanelMap({ panelHexes: 2, panelId: 'Sx+', tileScale: 'L' });
  let checked = 0;
  for (const tile of panel.topo.tiles.filter((tile) => tile.isPartial)) {
    const polygons = topology.tilePolygons(panel.topo, tile.index);
    for (const vertex of lattice.hexPolygon(tile.center, panel.topo.d)) {
      const point = vertex.map((value, axis) => 0.9 * value + 0.1 * tile.center[axis]);
      if (!polygons.some((polygon) => util.pointInConvex(point, polygon))) {
        assert.equal(resample.tileAtPoint(panel, tile.panelId, point), -1);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test('merges follow panel grids on seam-crossing rectangular maps', () => {
  const global = model.createGlobalMap({ tileScale: 'L' });
  global.terrainIds.fill(7);
  const span = model.createLocalMap({
    width: 30, height: 10, systemName: 'regional', scaleName: 'L',
    anchor: coordinates.makeLocation('Hyz+-', 0.6 * MILES_PER_EDGE, 0.2 * MILES_PER_EDGE),
  });
  assert.ok(span.topo && span.topo.span);
  assert.equal(resample.merge(global, span).coveredCount, span.tileCount);
  assert.ok(span.terrainIds.every((terrainId) => terrainId === 7));
  const coveredCount = resample.merge(span, global).coveredCount;
  assert.ok(coveredCount > 0 && coveredCount < global.tileCount);
});

test('merge replaces covered features, splits crossing paths, resolves ids and is one undo step', () => {
  const target = localMap('regional', 'S', 7, 3);
  target.terrainIds.fill(6);
  const index = (columnIndex, rowIndex) => model.localTileIndex(target, columnIndex, rowIndex);
  const source = model.createLocalMap({
    width: 3, height: 1, systemName: 'regional', scaleName: 'S', anchor: model.tileToUniversal(target, index(2, 1)),
  });
  source.terrainIds.set([0, 3, 4]);
  model.setLandmark(target, index(0, 0), { type: 'town', name: 'Outside' });
  model.setLandmark(target, index(2, 1), { type: 'town', name: 'Erase' });
  model.setLandmark(target, index(3, 1), { type: 'town', name: 'Replace' });
  model.setLandmark(source, 1, { type: 'village', name: 'Imported' });
  model.addLabel(target, { id: 'label1', tileIndex: index(0, 0), category: 'region', text: 'Outside' });
  model.addLabel(target, { id: 'erase', tileIndex: index(2, 1), category: 'region', text: 'Erase' });
  model.addLabel(source, { id: 'label1', tileIndex: 0, category: 'region', text: 'Imported' });
  model.addOverlay(target, { type: 'road', id: 'road1', name: 'Crossing', tileIndices: [0, 1, 2, 3, 4, 5, 6].map((columnIndex) => index(columnIndex, 1)) });
  model.addOverlay(target, { type: 'trail', id: 'road1_2', name: 'Outside', tileIndices: [index(0, 0), index(1, 0)] });
  model.addOverlay(target, { type: 'river', id: 'river1', name: 'Ends', tileIndices: [1, 2, 3, 4, 5].map((columnIndex) => index(columnIndex, 1)) });
  model.addOverlay(source, { type: 'road', id: 'road1', name: 'Imported', tileIndices: [0, 1, 2] });
  const before = fileFormat.write(target);
  const sourceText = fileFormat.write(source);
  const h = history.create(target);
  history.perform(h, 'Import', (doc, record) => assert.equal(resample.merge(source, doc, record).coveredCount, 3));
  assert.equal(h.undoStack.length, 1);
  assert.equal(target.landmarks.size, 2);
  assert.equal(model.getLandmark(target, index(0, 0)).name, 'Outside');
  assert.equal(model.getLandmark(target, index(2, 1)), null);
  assert.equal(model.getLandmark(target, index(3, 1)).name, 'Imported');
  assert.deepEqual(target.labels.map((label) => [label.id, label.text]), [['label1', 'Outside'], ['label1_2', 'Imported']]);
  assert.deepEqual(target.overlays.filter((overlay) => overlay.name === 'Crossing').map((overlay) => overlay.tileIndices),
    [[index(0, 1), index(1, 1)], [index(5, 1), index(6, 1)]]);
  assert.deepEqual(target.overlays.filter((overlay) => overlay.name === 'Ends').map((overlay) => overlay.tileIndices),
    [[index(1, 1)], [index(5, 1)]]);
  assert.equal(new Set(target.overlays.map((overlay) => overlay.id)).size, target.overlays.length);
  assert.deepEqual(target.overlays.find((overlay) => overlay.name === 'Imported').tileIndices, [index(2, 1), index(3, 1), index(4, 1)]);
  const after = fileFormat.write(target);
  assert.equal(fileFormat.write(fileFormat.parse(after)), after);
  history.undo(h);
  assert.equal(fileFormat.write(target), before);
  history.redo(h);
  assert.equal(fileFormat.write(target), after);
  assert.equal(fileFormat.write(source), sourceText);
});

test('incoming paths and features clip to the target, including isolated path points', () => {
  const source = localMap('regional', 'S', 7, 3);
  source.terrainIds.fill(5);
  const index = (columnIndex, rowIndex) => model.localTileIndex(source, columnIndex, rowIndex);
  model.addOverlay(source, { type: 'road', tileIndices: [0, 1, 2, 3, 4, 5, 6].map((columnIndex) => index(columnIndex, 1)) });
  model.addOverlay(source, { type: 'trail', tileIndices: [index(2, 1)] });
  model.setLandmark(source, index(0, 0), { type: 'town', name: 'Outside' });
  model.addLabel(source, { tileIndex: index(6, 2), category: 'region', text: 'Outside' });
  const target = model.createLocalMap({
    width: 3, height: 1, systemName: 'regional', scaleName: 'S', anchor: model.tileToUniversal(source, index(2, 1)),
  });
  assert.equal(resample.merge(source, target).coveredCount, 3);
  assert.equal(target.tileCount, 3);
  assert.ok(target.terrainIds.every((terrainId) => terrainId === 5));
  assert.equal(target.landmarks.size, 0);
  assert.equal(target.labels.length, 0);
  assert.deepEqual(target.overlays.map((overlay) => overlay.tileIndices), [[0, 1, 2], [0]]);
});

test('merge resamples features while preserving label ground sizes and map metadata', () => {
  const source = localMap('regional', 'M', 2, 2);
  source.terrainIds.fill(4);
  model.addLabel(source, { tileIndex: 0, text: 'Vale', category: 'region', size: 24, dx: 6, dy: -3 });
  model.addOverlay(source, { type: 'road', tileIndices: [0, 1] });
  const target = localMap('regional', 'S', 30, 30, 'Hxz+-', -12, 12);
  target.name = 'Keep name';
  const local = target.local;
  const result = resample.merge(source, target);
  assert.ok(result.coveredCount > 20 && result.coveredCount < target.tileCount);
  assert.equal(target.local, local);
  assert.equal(target.name, 'Keep name');
  assert.deepEqual(target.labels.map((label) => [label.size, label.dx, label.dy]), [[144, 36, -18]]);
  assert.ok(target.overlays[0].tileIndices.length > 5);
  for (const overlay of target.overlays) {
    for (let index = 1; index < overlay.tileIndices.length; index++) {
      assert.ok(model.areAdjacent(target, overlay.tileIndices[index - 1], overlay.tileIndices[index]));
    }
  }
});
