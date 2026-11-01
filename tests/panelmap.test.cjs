'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Coordinates: coordinates, Model: model, Topology: topology, View: view, Edit: edit, History: history, FileFormat: fileFormat, Regions: regions, SvgExport: svgExport } = loadModules();

for (const name of Object.keys(projection.SECTOR_LABELS).map((panelId) => projection.build().panels[panelId].name)) {
  for (const tileScale of ['XL', 'L', 'M']) {
    test(`${name} ${tileScale}: isolated topology covers the complete panel and never wraps`, () => {
      const panelId = coordinates.panelIdByName(name);
      const doc = model.createPanelMap({ panelId, panelHexes: 2, tileScale });
      const topo = doc.topo;
      const layout = view.mapLayout(doc);
      assert.equal(doc.kind, 'panel');
      assert.equal(doc.local, null);
      assert.ok(Math.abs(model.hexMiles(doc) - { XL: 216, L: 36, M: 6 }[tileScale]) < 1e-10);
      assert.deepEqual(Object.keys(topo.panels), [panelId]);
      assert.equal(layout.mode, 'panel');
      assert.equal(view.mapLayout(doc), layout);
      assert.equal(layout.placements.length, 1);
      assert.equal(layout.placements[0].panelId, panelId);
      assert.equal(view.panelTileGroups(topo, panelId).length, 1);
      const polygon = projection.build().frames[panelId].polygon;
      if (projection.build().panels[panelId].isEquatorial) {
        const halfWidth = projection.build().equatorialWidth / 2;
        for (const tile of topo.tiles) {
          assert.ok(Math.abs(Math.abs(tile.center[0]) - halfWidth) >= topo.w / 2 - 1e-12,
            `${tileScale}: neither east/west edge passes through a column`);
          assert.ok(Math.abs(tile.center[0]) >= topo.w / 2 - 1e-12,
            `${tileScale}: the centreline is between columns`);
        }
      }
      const area = topo.tiles.reduce((sum, tile) => sum + tile.area, 0);
      assert.ok(Math.abs(area - util.polygonArea(polygon)) < 1e-8, 'no holes or duplicated edge-hex area');
      for (const tile of topo.tiles) {
        assert.equal(tile.panelId, panelId);
        const point = view.featureAnchor(topo, tile.index);
        assert.ok(util.pointInConvex(point, polygon));
        assert.equal(view.hitTest(topo, layout, point).tileIndex, tile.index);
        assert.equal(coordinates.universalToTile(topo, model.tileToUniversal(doc, tile.index)), tile.index);
        for (const otherIndex of model.neighbors(doc, tile.index)) {
          assert.ok(model.areAdjacent(doc, otherIndex, tile.index));
          assert.ok(util.pointDistance(tile.center, topo.tiles[otherIndex].center) <= topo.d * 1.000001);
        }
      }
      for (const [a, b] of util.boundary(polygon)) {
        for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
          const point = util.scale(util.add(a, util.scale(util.subtract(b, a), t)), 0.99999);
          assert.ok(view.hitTest(topo, layout, point), 'every panel edge has editable tiles');
        }
      }
      assert.equal(view.hitTest(topo, layout, [100, 100]), null);
      const text = fileFormat.write(doc);
      assert.equal((text.match(/^\[panel /gm) || []).length, 1);
      assert.equal(fileFormat.write(fileFormat.parse(text)), text);
      const region = regions.build(doc);
      const exportArea = region.regions.reduce((sum, item) =>
        sum + item.loops.reduce((part, loop) => part + util.polygonArea(loop.slice(0, -1)), 0), 0);
      assert.ok(Math.abs(exportArea * topo.d ** 2 - area) < 1e-8);
    });
  }
}

test('panel maps preserve terrain, features and scale through editing, undo, saving and SVG export', () => {
  for (const tileScale of ['XL', 'L', 'M']) {
    const doc = model.createPanelMap({ panelId: coordinates.panelIdByName('Beta'), panelHexes: 2, tileScale, name: 'Only Beta' });
    const tileIndex = Math.floor(doc.tileCount / 2);
    const hist = history.create(doc);
    edit.fill(hist, tileIndex, 4);
    assert.ok(doc.terrainIds.every((id) => id === 4));
    history.undo(hist);
    assert.ok(doc.terrainIds.every((id) => id === 0));
    history.redo(hist);
    const path = edit.findPath(doc, 0, doc.tileCount - 1);
    model.addOverlay(doc, { type: 'road', tileIndices: path });
    model.setLandmark(doc, tileIndex, { type: 'castle', name: 'Keep' });
    model.addLabel(doc, { tileIndex, category: 'region', text: 'Beta only' });
    const text = fileFormat.write(doc);
    const parsed = fileFormat.parse(text);
    assert.equal(fileFormat.write(parsed), text);
    assert.equal(parsed.global.tileScale, tileScale);
    const svg = svgExport.write(parsed, { layers: { grid: true } });
    assert.match(svg, /Only Beta - Beta/);
    assert.match(svg, /id="overlay-road1"/);
    assert.match(svg, /Beta only/);
    assert.match(svg, /data-reference="equator"/);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
    assert.equal(svgExport.estimate(doc).tileCount, doc.tileCount);
    assert.equal(svgExport.fileName(doc), 'Only-Beta-Beta.svg');
  }
});

test('invalid panel map settings and out-of-scope panel sections are rejected', () => {
  const panelId = coordinates.panelIdByName('Beta');
  assert.throws(() => model.createPanelMap(), /Choose a panel/);
  assert.throws(() => model.createPanelMap({ panelId: 'unknown' }), /Unknown panel/);
  assert.throws(() => model.createPanelMap({ panelId, tileScale: 'S' }), /tile scale/);
  assert.throws(() => model.createPanelMap({ panelId, panelHexes: 3 }), /even/);
  assert.throws(() => model.createGlobalMap({ tileScale: 'M' }), /tile scale/);
  const text = fileFormat.write(model.createPanelMap({ panelId, panelHexes: 2 }));
  assert.throws(() => fileFormat.parse(text.replace('panel = Beta\n', '')), /panel/);
  assert.throws(() => fileFormat.parse(text.replace('[panel Beta]', '[panel Alpha]')), /outside this map/);
  assert.throws(() => fileFormat.parse(text.replace('kind = panel', 'kind = global')), /only for single-panel/);
  assert.throws(() => svgExport.write(model.createPanelMap({ panelId, panelHexes: 2 }), {
    panelId: coordinates.panelIdByName('Alpha'),
  }), /valid export panel/);
  assert.equal(topology.build(2, 'XL', panelId), topology.build(2, 'XL', panelId));
});
