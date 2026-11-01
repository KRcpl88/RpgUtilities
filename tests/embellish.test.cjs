'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Lattice: lattice, Coordinates: coordinates, Model: model, Terrain: terrain, View: view, Regions: regions, Embellish: embellish, SvgExport: svgExport } = loadModules();

const PLAIN = ['water', 'lakes', 'firth', 'plain'];
const id = (key) => terrain.byKey(key).id;

function localMap(width = 9, height = 9, key = 'plain') {
  const doc = model.createLocalMap({ width, height, systemName: 'regional', scaleName: 'M', anchor: coordinates.parseUniversal('Eta 0E 0N') });
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, id(key));
  }
  return doc;
}

function polygon(data, cell) {
  const points = cell.vertexIndices.map((vertex) => data.points[vertex]);
  return util.polygonArea(points) < 0 ? points.reverse() : points;
}

function cellOf(data, tileIndex) {
  return data.cells.find((cell) => cell.tileIndex === tileIndex);
}

function segmentDistance(point, a, b) {
  const direction = util.subtract(b, a);
  const t = Math.min(1, Math.max(0, util.dot(util.subtract(point, a), direction) / util.dot(direction, direction)));
  return util.pointDistance(point, util.add(a, util.scale(direction, t)));
}

// Internal forest/non-forest edges whose outward normal points south, as [a, b, forestCell].
function exposedSouthEdges(data) {
  const results = [];
  for (const edge of data.edges) {
    if (edge.cellIndices.length !== 2) {
      continue;
    }
    const forest = edge.cellIndices.map((cellIndex) => data.cells[cellIndex].terrainId === id('forest'));
    if (forest[0] === forest[1]) {
      continue;
    }
    const forestId = edge.cellIndices[forest[0] ? 0 : 1], a = data.points[edge.indexA], b = data.points[edge.indexB];
    const toCentre = util.center(polygon(data, data.cells[forestId]))[1] - (a[1] + b[1]) / 2;
    const normalY = Math.abs(b[0] - a[0]) / util.pointDistance(a, b);
    if (toCentre > 0 && normalY >= -embellish.SOUTH_FACING) {
      results.push([a, b, forestId]);
    }
  }
  return results;
}

test('terrain descriptors match the plan: every patterned terrain has four frozen variants', () => {
  for (const type of terrain.TERRAINS) {
    if (PLAIN.includes(type.key)) {
      assert.equal(type.embellish, null, type.key);
      assert.throws(() => embellish.motifs(type.key), /embellish/i);
      continue;
    }
    const spec = type.embellish;
    assert.ok(Object.isFrozen(spec), type.key);
    assert.ok(['scatter', 'tile', 'field'].includes(spec.layoutKind));
    assert.ok(spec.dx > 0 && spec.dy > 0 && spec.chance > 0 && spec.chance <= 1);
    assert.match(spec.ink, /^#[0-9a-f]{6}$/);
    assert.match(spec.accent, /^#[0-9a-f]{6}$/);
    const motifs = embellish.motifs(type.key);
    assert.equal(motifs.length, embellish.VARIANTS);
    assert.equal(embellish.motifs(type.key), motifs, 'motifs are cached');
    assert.ok(Object.isFrozen(motifs) && motifs.every((motif) => Object.isFrozen(motif)));
    for (const motif of motifs) {
      for (const shape of motif) {
        assert.ok(['body', 'ink', 'accent', 'dot'].includes(shape.role));
        assert.ok(shape.points.length >= 2);
        assert.ok(shape.points.flat().every((value) => Number.isFinite(value) && Math.abs(value) < 0.5), type.key);
      }
    }
  }
  assert.ok(terrain.TERRAINS.filter((type) => type.embellish).length === 13);
});

test('embellishment is deterministic, read-only and keeps scatter motifs inside their region', () => {
  const random = util.createRng(1101);
  const doc = localMap(14, 12);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, Math.floor(random() * 17));
  }
  const revision = doc.revision, data = regions.build(doc);
  const first = embellish.build(data);
  assert.deepEqual(embellish.build(regions.build(doc)), first);
  assert.equal(doc.revision, revision);
  assert.equal(first.length, data.regions.length);
  first.forEach((item, regionIndex) => {
    const type = terrain.byId(data.regions[regionIndex].terrainId);
    if (!type.embellish) {
      assert.equal(item, null);
      return;
    }
    assert.equal(item.key, type.key);
    assert.ok(item.instances.every((instance) => instance.variant >= 0 && instance.variant < embellish.VARIANTS));
    if (type.embellish.layoutKind !== 'scatter') {
      return;
    }
    const polygons = data.cells.filter((cell) => cell.regionIndex === regionIndex).map((cell) => polygon(data, cell));
    for (const instance of item.instances) {
      assert.ok(polygons.some((cell) => util.pointInConvex(instance.point, cell, 1e-9)), `${type.key} motif escapes its region`);
    }
  });
  assert.notDeepEqual(embellish.panelSeed('Sx-'), embellish.panelSeed('Sx+'));
});

test('scatter lattices continue across tiles: a neighbour joining the terrain does not move motifs', () => {
  const doc = localMap();
  const tileIndex = model.localTileIndex(doc, 4, 4), neighbor = model.neighbors(doc, tileIndex)[0];
  const points = () => {
    const data = regions.build(doc), cell = cellOf(data, tileIndex), hex = polygon(data, cell);
    return embellish.build(data)[cell.regionIndex].instances
      .filter((instance) => util.pointInConvex(instance.point, hex, 0)).map((instance) => [instance.variant, instance.point]);
  };
  model.setTerrain(doc, tileIndex, id('hills'));
  const alone = points();
  assert.ok(alone.length >= 4);
  model.setTerrain(doc, neighbor, id('hills'));
  assert.deepEqual(points(), alone);
});

test('mountain peaks draw one motif per tile, shrinking only for partial tiles', () => {
  const doc = localMap();
  const peaks = [10, 30, 31, 70];
  peaks.forEach((tileIndex) => model.setTerrain(doc, tileIndex, id('mountainPeak')));
  const data = regions.build(doc);
  const instances = embellish.build(data).filter((item) => item && item.key === 'mountainPeak').flatMap((item) => item.instances);
  assert.equal(instances.length, peaks.length);
  for (const tileIndex of peaks) {
    const centre = util.center(polygon(data, cellOf(data, tileIndex)));
    assert.ok(instances.some((instance) => util.pointDistance(instance.point, centre) < 1e-9 && instance.scale === 1));
  }
  const global = model.createGlobalMap({ panelHexes: 4 });
  global.terrainIds.fill(id('mountainPeak'));
  const globalData = regions.build(global, coordinates.panelIdByName('Eta'));
  const globalShapes = embellish.build(globalData).flatMap((item) => item.instances);
  assert.equal(globalShapes.length, new Set(globalData.cells.map((cell) => cell.tileIndex)).size);
  assert.ok(globalShapes.some((instance) => instance.scale === 1));
  assert.ok(globalShapes.some((instance) => instance.scale < 1 && instance.scale >= 0.3));
});

test('forest trunks mark only south-facing internal edges, with crowns kept clear above them', () => {
  const doc = localMap();
  const tileIndex = model.localTileIndex(doc, 4, 4);
  model.setTerrain(doc, tileIndex, id('forest'));
  let data = regions.build(doc);
  let forest = embellish.build(data)[cellOf(data, tileIndex).regionIndex];
  const centre = util.center(polygon(data, cellOf(data, tileIndex)));
  assert.ok(forest.trunks.length >= 9);
  for (const [basePoint, topPoint] of forest.trunks) {
    assert.ok(basePoint[1] < centre[1], 'trunks stand on the southern edges');
    assert.deepEqual(util.subtract(topPoint, basePoint).map((value) => Math.round(value * 1e9) / 1e9), [0, embellish.TRUNK_HEIGHT]);
    assert.ok(exposedSouthEdges(data).some(([a, b]) => segmentDistance(basePoint, a, b) < 1e-9));
  }

  const south = model.neighbors(doc, tileIndex).find((otherIndex) => {
    const other = util.center(polygon(data, cellOf(data, otherIndex)));
    return Math.abs(other[0] - centre[0]) < 1e-9 && other[1] < centre[1];
  });
  model.setTerrain(doc, south, id('forest'));
  data = regions.build(doc);
  forest = embellish.build(data)[cellOf(data, tileIndex).regionIndex];
  const shared = data.edges.find((edge) => edge.cellIndices.length === 2
    && edge.cellIndices.map((cellIndex) => data.cells[cellIndex].tileIndex).sort().join() === [tileIndex, south].sort().join());
  assert.ok(forest.trunks.every(([basePoint]) => segmentDistance(basePoint, data.points[shared.indexA], data.points[shared.indexB]) > 1e-6));

  const whole = localMap(6, 5, 'forest'), wholeData = regions.build(whole);
  assert.deepEqual(embellish.build(wholeData)[0].trunks, [], 'the export border never gets trunks');
});

test('forest crowns respect the clearance band and a fringe row keeps the treeline full', () => {
  const random = util.createRng(77);
  const doc = localMap(16, 12);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, random() < 0.6 ? id('forest') : id('plain'));
  }
  const data = regions.build(doc), exposed = exposedSouthEdges(data), result = embellish.build(data);
  assert.ok(exposed.length > 20);
  let fringe = 0;
  result.forEach((item, regionIndex) => {
    if (!item || item.key !== 'forest') {
      return;
    }
    const edges = exposed.filter(([, , cellIndex]) => data.cells[cellIndex].regionIndex === regionIndex);
    for (const instance of item.instances) {
      const nearest = Math.min(Infinity, ...edges.map(([a, b]) => segmentDistance(instance.point, a, b)));
      assert.ok(nearest >= embellish.CROWN_CLEARANCE - 1e-9);
      fringe += nearest < embellish.CROWN_CLEARANCE + 0.04 ? 1 : 0;
      assert.ok(data.cells.some((cell) => cell.regionIndex === regionIndex && util.pointInConvex(instance.point, polygon(data, cell), 1e-9)));
    }
  });
  assert.ok(fringe >= exposed.length, 'each exposed edge gets at least one fringe crown on average');
});

test('SVG embellishment layer references defined motifs, honours colours-off and scales only by width', () => {
  const doc = localMap(12, 9);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, tileIndex % 17);
  }
  const text = svgExport.write(doc, { width: 900 });
  const terrainId = text.indexOf('id="layer-terrain"'), layer = text.indexOf('id="layer-embellishment"');
  assert.ok(terrainId > 0 && layer > terrainId && text.indexOf('id="layer-shoreline"') > layer);
  const defined = [...text.matchAll(/<g id="(emb-[a-zA-Z]+-\d)"/g)].map((match) => match[1]);
  const used = [...text.matchAll(/<use href="#(emb-[^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length > 100);
  assert.deepEqual([...new Set(used)].sort(), [...defined].sort(), 'only used variants are defined');
  const keys = new Set([...text.matchAll(/data-terrain="([a-zA-Z]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...keys].sort(), terrain.TERRAINS.filter((type) => type.embellish).map((type) => type.key).sort());
  assert.match(text, /class="trunks"/);
  assert.ok(text.includes(`fill="${terrain.byKey('forest').color}"`));
  assert.doesNotMatch(text, /(?:NaN|Infinity|undefined)/);

  const plain = svgExport.write(doc, { width: 900, layers: { terrain: false } });
  assert.ok(!plain.includes('id="layer-terrain"') && plain.includes('id="layer-embellishment"'));
  const defs = plain.slice(plain.indexOf('<g id="emb-forest'), plain.indexOf('</g>', plain.indexOf('<g id="emb-forest')));
  assert.match(defs, /fill="#ffffff"/);
  assert.ok(!defs.includes(terrain.byKey('forest').color));

  const wide = svgExport.write(doc, { width: 2400 });
  const strip = (text) => text.replace(/^<svg [^>]*>/m, (tag) => tag.replace(/ (?:width|height)="[^"]*"/g, ''));
  assert.equal(strip(wide), strip(text));
});

test('every local scale and all global panels export embellishments without invalid numbers', () => {
  for (const scaleName of lattice.SIZES) {
    const doc = localMap(6, 5);
    for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
      model.setTerrain(doc, tileIndex, (tileIndex * 7) % 17);
    }
    const scaled = model.createLocalMap({ width: 6, height: 5, systemName: 'local', scaleName, anchor: coordinates.parseUniversal('Eta 0E 0N') });
    scaled.terrainIds.set(doc.terrainIds);
    const text = svgExport.write(scaled);
    assert.match(text, /id="layer-embellishment"/);
    assert.doesNotMatch(text, /(?:NaN|Infinity|undefined)/);
  }
  const global = model.createGlobalMap({ panelHexes: 8 });
  global.terrainIds.set(view.demoTerrain(global.topo, 5));
  for (const panelId of global.topo.panelIds) {
    const data = regions.build(global, panelId), result = embellish.build(data);
    for (const item of result.filter((entry) => entry && entry.key !== 'farmland')) {
      assert.ok(item.instances.every((instance) => instance.point.every(Number.isFinite)));
      assert.ok(item.instances.every((instance) => util.pointInConvex(instance.point, data.outline, 1e-9)), panelId);
    }
    assert.doesNotMatch(svgExport.write(global, { panelId }), /(?:NaN|Infinity|undefined)/);
  }
});
