'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Coordinates, Model, Topology, View, Edit, History, FileFormat, Regions, SvgExport } = LoadModules();

for (const szName of Object.keys(Projection.g_SectorLabels).map((sz) => Projection.Build().Panels[sz].szName)) {
  for (const szTileScale of ['XL', 'L', 'M']) {
    test(`${szName} ${szTileScale}: isolated topology covers the complete panel and never wraps`, () => {
      const szPanel = Coordinates.PanelIdByName(szName);
      const Doc = Model.CreatePanelMap({ szPanel, nPanelHexes: 2, szTileScale });
      const Topo = Doc.Topo;
      const Layout = View.MapLayout(Doc);
      assert.equal(Doc.szKind, 'panel');
      assert.equal(Doc.Local, null);
      assert.ok(Math.abs(Model.HexMiles(Doc) - { XL: 216, L: 36, M: 6 }[szTileScale]) < 1e-10);
      assert.deepEqual(Object.keys(Topo.Panels), [szPanel]);
      assert.equal(Layout.szMode, 'panel');
      assert.equal(View.MapLayout(Doc), Layout);
      assert.equal(Layout.rgPlacements.length, 1);
      assert.equal(Layout.rgPlacements[0].szPanel, szPanel);
      assert.equal(View.PanelTileGroups(Topo, szPanel).length, 1);
      const Polygon = Projection.Build().Frames[szPanel].rgrgdPolygon;
      const dArea = Topo.rgTiles.reduce((dSum, Tile) => dSum + Tile.dArea, 0);
      assert.ok(Math.abs(dArea - Util.PolygonArea(Polygon)) < 1e-8, 'no holes or duplicated edge-hex area');
      for (const Tile of Topo.rgTiles) {
        assert.equal(Tile.szPanel, szPanel);
        const Point = View.FeatureAnchor(Topo, Tile.nIndex);
        assert.ok(Util.PointInConvex(Point, Polygon));
        assert.equal(View.HitTest(Topo, Layout, Point).nTile, Tile.nIndex);
        assert.equal(Coordinates.UniversalToTile(Topo, Model.TileToUniversal(Doc, Tile.nIndex)), Tile.nIndex);
        for (const nOther of Model.Neighbors(Doc, Tile.nIndex)) {
          assert.ok(Model.AreAdjacent(Doc, nOther, Tile.nIndex));
          assert.ok(Util.Distance(Tile.rgdCenter, Topo.rgTiles[nOther].rgdCenter) <= Topo.dD * 1.000001);
        }
      }
      for (const [A, B] of Util.Boundary(Polygon)) {
        for (const dT of [0.01, 0.25, 0.5, 0.75, 0.99]) {
          const Point = Util.Scale(Util.Add(A, Util.Scale(Util.Subtract(B, A), dT)), 0.99999);
          assert.ok(View.HitTest(Topo, Layout, Point), 'every panel edge has editable tiles');
        }
      }
      assert.equal(View.HitTest(Topo, Layout, [100, 100]), null);
      const Text = FileFormat.Write(Doc);
      assert.equal((Text.match(/^\[panel /gm) || []).length, 1);
      assert.equal(FileFormat.Write(FileFormat.Parse(Text)), Text);
      const Region = Regions.Build(Doc);
      const dExportArea = Region.rgRegions.reduce((dSum, Item) =>
        dSum + Item.rgrgrgdLoops.reduce((dPart, Loop) => dPart + Util.PolygonArea(Loop.slice(0, -1)), 0), 0);
      assert.ok(Math.abs(dExportArea * Topo.dD ** 2 - dArea) < 1e-8);
    });
  }
}

test('panel maps preserve terrain, features and scale through editing, undo, saving and SVG export', () => {
  for (const szTileScale of ['XL', 'L', 'M']) {
    const Doc = Model.CreatePanelMap({ szPanel: Coordinates.PanelIdByName('Beta'), nPanelHexes: 2, szTileScale, szName: 'Only Beta' });
    const nTile = Math.floor(Doc.nTiles / 2);
    const Hist = History.Create(Doc);
    Edit.Fill(Hist, nTile, 4);
    assert.ok(Doc.rgnTerrain.every((nId) => nId === 4));
    History.Undo(Hist);
    assert.ok(Doc.rgnTerrain.every((nId) => nId === 0));
    History.Redo(Hist);
    const Path = Edit.FindPath(Doc, 0, Doc.nTiles - 1);
    Model.AddOverlay(Doc, { szType: 'road', rgnTiles: Path });
    Model.SetLandmark(Doc, nTile, { szType: 'castle', szName: 'Keep' });
    Model.AddLabel(Doc, { nTile, szCategory: 'region', szText: 'Beta only' });
    const Text = FileFormat.Write(Doc);
    const Parsed = FileFormat.Parse(Text);
    assert.equal(FileFormat.Write(Parsed), Text);
    assert.equal(Parsed.Global.szTileScale, szTileScale);
    const Svg = SvgExport.Write(Parsed, { Layers: { grid: true } });
    assert.match(Svg, /Only Beta - Beta/);
    assert.match(Svg, /id="overlay-road1"/);
    assert.match(Svg, /Beta only/);
    assert.match(Svg, /data-reference="equator"/);
    assert.doesNotMatch(Svg, /NaN|Infinity|undefined/);
    assert.equal(SvgExport.Estimate(Doc).nTiles, Doc.nTiles);
    assert.equal(SvgExport.FileName(Doc), 'Only-Beta-Beta.svg');
  }
});

test('invalid panel map settings and out-of-scope panel sections are rejected', () => {
  const szPanel = Coordinates.PanelIdByName('Beta');
  assert.throws(() => Model.CreatePanelMap(), /Choose a panel/);
  assert.throws(() => Model.CreatePanelMap({ szPanel: 'unknown' }), /Unknown panel/);
  assert.throws(() => Model.CreatePanelMap({ szPanel, szTileScale: 'S' }), /tile scale/);
  assert.throws(() => Model.CreatePanelMap({ szPanel, nPanelHexes: 3 }), /even/);
  assert.throws(() => Model.CreateGlobalMap({ szTileScale: 'M' }), /tile scale/);
  const Text = FileFormat.Write(Model.CreatePanelMap({ szPanel, nPanelHexes: 2 }));
  assert.throws(() => FileFormat.Parse(Text.replace('panel = Beta\n', '')), /panel/);
  assert.throws(() => FileFormat.Parse(Text.replace('[panel Beta]', '[panel Alpha]')), /outside this map/);
  assert.throws(() => FileFormat.Parse(Text.replace('kind = panel', 'kind = global')), /only for single-panel/);
  assert.throws(() => SvgExport.Write(Model.CreatePanelMap({ szPanel, nPanelHexes: 2 }), {
    szPanel: Coordinates.PanelIdByName('Alpha'),
  }), /valid export panel/);
  assert.equal(Topology.Build(2, 'XL', szPanel), Topology.Build(2, 'XL', szPanel));
});
