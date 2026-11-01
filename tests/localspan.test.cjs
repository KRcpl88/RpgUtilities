'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Lattice: lattice, Topology: topology, Coordinates: coordinates, Model: model, View: view, Edit: edit, FileFormat: fileFormat, Regions: regions, SvgExport: svgExport } = loadModules();

const MILES_PER_EDGE = projection.getMilesPerEdge(topology.DEFAULT_PANEL_HEXES);

// A local map anchored at (east, north) edge units in panelId's frame.
function spanMap(panelId, east, north, width, height, scaleName = 'L', extra = {}) {
  return model.createLocalMap({
    width, height, systemName: 'regional', scaleName,
    anchor: coordinates.makeLocation(panelId, east * MILES_PER_EDGE, north * MILES_PER_EDGE), ...extra,
  });
}

// Every tile sits on its own panel's global lattice of the same scale, so the grid turns
// to follow each panel: the map looks bent where it meets a seam.
function assertPanelLattices(doc) {
  const ratio = lattice.scaleRatio('regional', 'XL', doc.local.scaleName);
  for (const tile of doc.topo.tiles) {
    const info = topology.panelLattice(tile.panelId, doc.local.panelHexes, ratio);
    const [q, j] = topology.latticeNearest(info, tile.center[0], tile.center[1]);
    assert.ok(util.pointDistance(topology.latticeCenter(info, q, j), tile.center) < 1e-9, `tile ${tile.index} is off its panel lattice`);
  }
}

function assertAdjacentAcross(doc, a, b) {
  const found = doc.topo.tiles.some((tile) => tile.panelId === a
    && Array.from(topology.neighbors(doc.topo, tile.index)).some((otherIndex) => doc.topo.tiles[otherIndex].panelId === b));
  assert.ok(found, `no ${a} tile is adjacent to a ${b} tile`);
}

test('a regional map crossing an equatorial east/west seam keeps whole edge hexes on each side', () => {
  const doc = spanMap('Hyz+-', 0.6, 0.2, 30, 10);
  assert.ok(doc.topo && doc.topo.span, 'the map spans panels');
  assert.deepEqual([...doc.topo.panelIds].sort(), ['Hxy++', 'Hyz+-']);
  assert.equal(doc.tileCount, 30 * 10, 'equatorial seams cut no tiles');
  assert.ok(doc.topo.tiles.every((tile) => !tile.pieces));
  assertPanelLattices(doc);
  assertAdjacentAcross(doc, 'Hyz+-', 'Hxy++');
});

test('a regional map crossing a non-equatorial seam crops partial tiles as the global map does', () => {
  const doc = spanMap('Hxz+-', 0.45, 0.3, 40, 30);
  assert.deepEqual([...doc.topo.panelIds].sort(), ['Hxz+-', 'Sx+']);
  assert.ok(doc.topo.tiles.some((tile) => tile.pieces), 'seam tiles are clipped to their panel');
  assertPanelLattices(doc);
  assertAdjacentAcross(doc, 'Hxz+-', 'Sx+');
  const flat = spanMap('Hxz+-', 0.45, 0.3, 40, 30, 'L', { isFlat: true });
  assert.equal(flat.topo, null);
  assert.equal(flat.tileCount, 40 * 30);
});

test('a local map may cross several panel seams', () => {
  const doc = spanMap('Hyz+-', 0, 0, 40, 3, 'XL');
  assert.deepEqual([...doc.topo.panelIds].sort(), ['Hxy++', 'Hxz++', 'Hyz+-']);
  assertPanelLattices(doc);
  assertAdjacentAcross(doc, 'Hyz+-', 'Hxy++');
  assertAdjacentAcross(doc, 'Hxy++', 'Hxz++');
});

test('a local map stops short of panel corner vertices instead of tearing around them', () => {
  const doc = spanMap('Hxz+-', 0.45, 0.5, 60, 60);
  assert.deepEqual([doc.local.width, doc.local.height], [29, 60]);
  const other = spanMap('Hyz+-', 0.5, 0.6, 20, 6, 'XL');
  assert.deepEqual([other.local.width, other.local.height], [5, 6]);
  assert.deepEqual(coordinates.previewLocalSpan({
    width: 20, height: 6, systemName: 'regional', scaleName: 'XL',
    anchor: coordinates.makeLocation('Hyz+-', 0.5 * MILES_PER_EDGE, 0.6 * MILES_PER_EDGE),
  }), { width: 5, height: 6, panelIds: ['Hyz+-', 'Hxz+-'] });
  // No two kept panels may meet only at a vertex inside the map.
  const built = projection.build();
  for (const probe of [doc, other]) {
    if (!probe.topo) {
      continue;
    }
    const panels = new Set(probe.topo.panelIds);
    for (const vertexId of Object.keys(built.vertices)) {
      const around = built.seams.filter((seam) => seam.vertexIds.includes(vertexId))
        .flatMap((seam) => [seam.panelA, seam.panelB]).filter((panelId) => panels.has(panelId));
      assert.ok(new Set(around).size <= 2, `the map wraps around vertex ${vertexId}`);
    }
  }
});

test('yard-scale maps and maps inside one panel stay flat', () => {
  const yard = model.createLocalMap({
    width: 100, height: 10, systemName: 'local', scaleName: 'XL',
    anchor: coordinates.makeLocation('Hyz+-', 0.8795 * MILES_PER_EDGE - 5, 0),
  });
  assert.equal(yard.topo, null);
  assert.equal(yard.tileCount, 1000);
  const inside = spanMap('Hxz+-', 0, 0, 10, 10, 'M');
  assert.equal(inside.topo, null);
});

test('span maps write [panel] sections canonically and legacy [local] files stay flat', () => {
  const doc = spanMap('Hyz+-', 0.6, 0.2, 30, 10);
  model.setTerrain(doc, 0, 3);
  model.setTerrain(doc, doc.tileCount - 1, 5);
  const last = doc.tileCount - 1;
  model.addOverlay(doc, { type: 'road', tileIndices: edit.findPath(doc, 0, last) });
  const text = fileFormat.write(doc);
  assert.match(text, /\n\[panel /);
  assert.doesNotMatch(text, /\n\[local\]/);
  const parsed = fileFormat.parse(text);
  assert.ok(parsed.topo && parsed.topo.span);
  assert.equal(parsed.tileCount, doc.tileCount);
  assert.deepEqual(Array.from(parsed.terrainIds), Array.from(doc.terrainIds));
  assert.equal(fileFormat.write(parsed), text, 'write → parse → write is byte-identical');

  const flat = spanMap('Hyz+-', 0.6, 0.2, 30, 10, 'L', { isFlat: true });
  const flatMapText = fileFormat.write(flat);
  assert.match(flatMapText, /\n\[local\]/);
  const parsedFlat = fileFormat.parse(flatMapText);
  assert.equal(parsedFlat.topo, null);
  assert.equal(fileFormat.write(parsedFlat), flatMapText);
});

test('span maps hit-test every tile and lay out one placement per panel', () => {
  const doc = spanMap('Hxz+-', 0.45, 0.3, 40, 30);
  const geometry = view.mapGeometry(doc);
  const layout = view.mapLayout(doc);
  assert.equal(layout.mode, 'span');
  assert.deepEqual(layout.placements.map((placement) => placement.panelId).sort(), [...doc.topo.panelIds].sort());
  for (const tile of geometry.tiles) {
    const placement = view.findPlacement(layout, tile.panelId);
    const world = projection.applyTransform(placement.frameToWorld, view.featureAnchor(geometry, tile.index));
    assert.equal(view.hitTest(geometry, layout, world).tileIndex, tile.index);
  }
});

test('span maps export SVG and regions for the whole map', () => {
  const doc = spanMap('Hyz+-', 0, 0, 40, 3, 'XL');
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex += 2) {
    model.setTerrain(doc, tileIndex, 4);
  }
  const built = regions.build(doc, 'local');
  assert.ok(built.regions.length > 0);
  const svg = svgExport.write(doc, { panelId: 'local', width: 800 });
  assert.match(svg, /^<\?xml|^<svg/);
  assert.match(svg, /<\/svg>\s*$/);
});
