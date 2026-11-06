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

function exposedForestEdges(data) {
  const results = [];
  for (const edge of data.edges) {
    if (edge.cellIndices.length !== 2) {
      continue;
    }
    const forest = edge.cellIndices.map((cellIndex) => data.cells[cellIndex].terrainId === id('forest'));
    if (forest[0] === forest[1]) {
      continue;
    }
    const forestId = edge.cellIndices[forest[0] ? 0 : 1];
    results.push([data.points[edge.indexA], data.points[edge.indexB], forestId]);
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
        const limit = type.key === 'forest' ? 0.8 : 0.5;
        assert.ok(shape.points.flat().every((value) => Number.isFinite(value) && Math.abs(value) < limit), type.key);
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

test('forest motifs match the reference proportions, lobed crowns and single-line trunks', () => {
  const spec = terrain.byKey('forest').embellish;
  assert.equal(spec.body, '#91b765');
  assert.equal(spec.ink, '#395331');
  assert.equal(spec.accent, '#493c2b');
  for (const [trunk, crown] of embellish.motifs('forest')) {
    assert.equal(trunk.role, 'accent');
    assert.equal(trunk.isClosed, false);
    assert.deepEqual(trunk.points, [[0, 0], [0, 55 * embellish.TREE_SCALE]]);
    assert.equal(crown.role, 'body');
    assert.equal(crown.isClosed, true);
    const lobes = crown.points.length / 8;
    assert.ok(Number.isInteger(lobes) && lobes >= 4 && lobes <= 7);
    assert.ok(crown.points.every((point) => point[1] > 0));
    const width = Math.max(...crown.points.map(([x]) => x)) - Math.min(...crown.points.map(([x]) => x));
    const height = Math.max(...crown.points.map(([, y]) => y)) - Math.min(...crown.points.map(([, y]) => y));
    assert.ok(width > 0.3 && width < 0.55);
    assert.ok(height > 0.35 && height < 0.65);
  }
});

test('forest trunks occur only near boundaries and gaps without changing crown positions or depth order', () => {
  const random = util.createRng(77);
  const doc = localMap(16, 12);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, random() < 0.6 ? id('forest') : id('plain'));
  }
  const data = regions.build(doc), exposed = exposedForestEdges(data), result = embellish.build(data);
  assert.ok(exposed.length > 20);
  let trunkCount = 0, crownOnlyCount = 0;
  result.forEach((item, regionIndex) => {
    if (!item || item.key !== 'forest') {
      return;
    }
    const edges = exposed.filter(([, , cellIndex]) => data.cells[cellIndex].regionIndex === regionIndex);
    for (const [instanceIndex, instance] of item.instances.entries()) {
      const nearest = Math.min(Infinity, ...edges.map(([a, b]) => segmentDistance(instance.point, a, b)));
      assert.equal(instance.hasTrunk, nearest <= embellish.TRUNK_BOUNDARY_DISTANCE);
      trunkCount += instance.hasTrunk ? 1 : 0;
      crownOnlyCount += instance.hasTrunk ? 0 : 1;
      if (instanceIndex) {
        const previous = item.instances[instanceIndex - 1].point;
        assert.ok(previous[1] > instance.point[1] || (previous[1] === instance.point[1] && previous[0] <= instance.point[0]));
      }
      assert.ok(data.cells.some((cell) => cell.regionIndex === regionIndex && util.pointInConvex(instance.point, polygon(data, cell), 1e-9)));
    }
  });
  assert.ok(trunkCount > 0 && crownOnlyCount > 0);

  const whole = localMap(12, 12, 'forest');
  const wholeResult = embellish.build(regions.build(whole))[0];
  assert.ok(wholeResult.instances.every((instance) => !instance.hasTrunk), 'export borders and shared forest edges do not create trunks');
  const gap = model.localTileIndex(whole, 6, 6);
  model.setTerrain(whole, gap, id('plain'));
  const gapData = regions.build(whole);
  const gapResult = embellish.build(gapData).find((item) => item && item.key === 'forest');
  assert.ok(gapResult.instances.some((instance) => instance.hasTrunk), 'an enclosed clearing gets trunks');
  const retained = wholeResult.instances.filter((instance) => !util.pointInConvex(instance.point, polygon(gapData, cellOf(gapData, gap)), 0));
  assert.deepEqual(gapResult.instances.map(({ point, variant }) => [point, variant]), retained.map(({ point, variant }) => [point, variant]));
});

test('SVG embellishment layer references defined motifs, honours colours-off and scales only by width', () => {
  const doc = localMap(12, 9);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, tileIndex % 17);
  }
  const text = svgExport.write(doc, { width: 900 });
  const terrainId = text.indexOf('id="layer-terrain"'), layer = text.indexOf('id="layer-embellishment"');
  assert.ok(terrainId > 0 && layer > terrainId && text.indexOf('id="layer-shoreline"') > layer);
  const defined = [...text.matchAll(/<g id="(emb-[a-zA-Z]+-\d(?:-trunk)?)"/g)].map((match) => match[1]);
  const used = [...text.matchAll(/<use href="#(emb-[^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length > 100);
  assert.deepEqual([...new Set(used)].sort(), [...defined].sort(), 'only used variants are defined');
  const keys = new Set([...text.matchAll(/data-terrain="([a-zA-Z]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...keys].sort(), terrain.TERRAINS.filter((type) => type.embellish).map((type) => type.key).sort());
  const forestDefinitions = [...text.matchAll(/<g id="emb-forest-(\d)(-trunk)?"[^>]*>(.*?)<\/g>/g)];
  assert.ok(forestDefinitions.some(([, , suffix]) => suffix));
  for (const [, , suffix, content] of forestDefinitions) {
    const paths = [...content.matchAll(/<path[^>]+>/g)].map(([path]) => path);
    assert.equal(paths.length, suffix ? 2 : 1);
    if (suffix) {
      assert.match(paths[0], /fill="none"/);
      assert.match(paths[0], /stroke="#493c2b"/);
      assert.match(paths[0], /d="M0 0L0 -12\.7"/);
    }
    assert.match(paths.at(-1), /fill="#91b765"/);
  }
  assert.ok(!text.includes(`fill="${terrain.byKey('forest').color}"`));
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

test('SVG forest ground matches plains only with terrain colours enabled, leaving crowns unchanged', () => {
  const doc = localMap(4, 4, 'forest');
  const plainColor = terrain.byKey('plain').color;
  const forestColor = terrain.byKey('forest').color;
  const crownColor = terrain.byKey('forest').embellish.body;
  const text = svgExport.write(doc);
  const ground = text.match(/<g id="layer-terrain">(.*?)<\/g>/s)[1];
  assert.match(ground, new RegExp(`fill="${plainColor}"`));
  assert.ok(!ground.includes(forestColor));
  const crowns = [...text.matchAll(/<g id="emb-forest-\d[^"]*"[^>]*>(.*?)<\/g>/g)];
  assert.ok(crowns.length > 0);
  assert.ok(crowns.every(([, content]) => content.includes(`fill="${crownColor}"`)));

  const groundOnly = svgExport.write(doc, { layers: { embellishment: false } });
  assert.match(groundOnly, new RegExp(`fill="${plainColor}"`));
  assert.ok(!groundOnly.includes('id="layer-embellishment"'));

  const noColours = svgExport.write(doc, { layers: { terrain: false } });
  assert.ok(!noColours.includes('id="layer-terrain"'));
  assert.ok(!noColours.includes(`fill="${plainColor}"`));
  assert.ok(!noColours.includes(`fill="${forestColor}"`));
  assert.match(noColours, /fill="#ffffff"/, 'colours-off crowns keep their existing white fill');
  assert.equal(terrain.byKey('forest').color, forestColor, 'the editor palette remains unchanged');
});

test('SVG trees draw each trunk immediately before its crown in north-to-south order', () => {
  const doc = localMap(7, 7, 'forest');
  model.setTerrain(doc, model.localTileIndex(doc, 3, 3), id('plain'));
  const data = regions.build(doc);
  const forest = embellish.build(data).find((item) => item && item.key === 'forest');
  const text = svgExport.write(doc);
  const group = text.match(/<g data-terrain="forest"[^>]*>(.*?)<\/g>/s)[1];
  const uses = [...group.matchAll(/<use href="#emb-forest-(\d)(-trunk)?" x="([^"]+)" y="([^"]+)"\/>/g)];
  assert.equal(uses.length, forest.instances.length);
  uses.forEach(([, variant, suffix, , y], instanceIndex) => {
    assert.equal(Number(variant), forest.instances[instanceIndex].variant);
    assert.equal(Boolean(suffix), forest.instances[instanceIndex].hasTrunk);
    if (instanceIndex) {
      assert.ok(Number(uses[instanceIndex - 1][4]) <= Number(y));
    }
  });
  assert.doesNotMatch(group, /<path/, 'no separate all-trunks layer may bypass tree depth order');
});

test('SVG draws complete terrain motifs over all backgrounds in global depth order', () => {
  const doc = localMap(8, 8);
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, id(tileIndex % 3 === 0 ? 'forest' : 'hills'));
  }
  const data = regions.build(doc);
  const expected = embellish.build(data).flatMap((item) => item
    ? item.instances.map((instance) => ({ key: item.key, ...instance })) : [])
    .sort((a, b) => b.point[1] - a.point[1] || a.point[0] - b.point[0]);
  assert.ok(data.regions.filter((region) => region.terrainId === id('forest')).length > 1);
  for (const terrainEnabled of [true, false]) {
    const text = svgExport.write(doc, { layers: { terrain: terrainEnabled } });
    const layerStart = text.indexOf('id="layer-embellishment"');
    const layerEnd = text.indexOf('id="layer-shoreline"');
    const layer = text.slice(layerStart, layerEnd);
    assert.doesNotMatch(layer, /clip-path|clip-region/);
    assert.match(text, /<g clip-path="url\(#map-clip\)">/);
    if (terrainEnabled) {
      assert.ok(text.indexOf('id="layer-terrain"') < layerStart);
      assert.doesNotMatch(layer, /href="#region-/);
    } else {
      assert.ok(!text.includes('id="layer-terrain"'));
    }
    const uses = [...layer.matchAll(/<use href="#emb-([a-zA-Z]+)-(\d)(-trunk)?" x="([^"]+)" y="([^"]+)"\/>/g)];
    assert.equal(uses.length, expected.length);
    uses.forEach(([, key, variant, suffix, x, y], instanceIndex) => {
      const instance = expected[instanceIndex];
      assert.equal(key, instance.key);
      assert.equal(Number(variant), instance.variant);
      assert.equal(Boolean(suffix), Boolean(instance.hasTrunk));
      assert.ok(Math.abs(Number(x) - (instance.point[0] - data.bounds[0]) * 48) <= 0.0051);
      assert.ok(Math.abs(Number(y) - (data.bounds[3] - instance.point[1]) * 48) <= 0.0051);
    });
  }
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
