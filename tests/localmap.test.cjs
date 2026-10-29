'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Lattice, Topology, Coordinates, Model, View, Edit, History, FileFormat } = LoadModules();

function LocalMap(szSystem = 'regional', szScale = 'M', nParity = 0, nWidth = 8, nHeight = 6) {
  const dMiles = Lattice.ScaleMiles(szSystem, szScale);
  return Model.CreateLocalMap({
    nWidth, nHeight, szSystem, szScale,
    Anchor: Coordinates.MakeLocation('Hxz+-', nParity * Lattice.ColumnSpacing(dMiles), nParity * dMiles / 2),
  });
}

test('all eight local scales use normalized geometry and preserve their universal distances', () => {
  for (const szSystem of ['regional', 'local']) {
    for (const szScale of Lattice.g_rgszSizes) {
      for (const nParity of szSystem === 'regional' ? [0, 1] : [0]) {
        const Doc = LocalMap(szSystem, szScale, nParity);
        const Geometry = View.MapGeometry(Doc);
        assert.equal(Doc.Topo, null);
        assert.equal(Doc.Local.nParity, nParity);
        assert.equal(Geometry.dD, 1);
        assert.equal(Geometry, View.MapGeometry(Doc), 'geometry is cached by local configuration');
        assert.equal(View.MapLayout(Doc), Geometry.Layout);
        assert.equal(Geometry.Layout.rgPlacements.length, 1);
        assert.equal(View.PanelTileGroups(Geometry, 'local').length, 1);
        assert.deepEqual([...View.PanelTileGroups(Geometry, 'local')[0].rgnTiles], Geometry.rgTiles.map((Tile) => Tile.nIndex));
        for (const Tile of Geometry.rgTiles) {
          const Location = Model.TileToUniversal(Doc, Tile.nIndex);
          const [nX, nY] = Model.LocalTileXY(Doc, Tile.nIndex);
          assert.ok(Math.abs((Location.dEast - Doc.Local.Anchor.dEast) / Model.HexMiles(Doc) - Tile.rgdCenter[0]) < 1e-10);
          assert.ok(Math.abs((Location.dNorth - Doc.Local.Anchor.dNorth) / Model.HexMiles(Doc) - Tile.rgdCenter[1]) < 1e-10);
          assert.deepEqual(Coordinates.UniversalToLocalTile(Doc.Local, Location), [nX, nY]);
          assert.equal(View.HitTest(Geometry, Geometry.Layout, Tile.rgdCenter).nTile, Tile.nIndex);
          assert.equal(Tile.fPartial, false);
          for (const nNeighbor of Model.Neighbors(Doc, Tile.nIndex)) {
            assert.ok(Math.abs(Util.Distance(Tile.rgdCenter, Geometry.rgTiles[nNeighbor].rgdCenter) - 1) < 1e-12);
          }
        }
      }
    }
  }
});

test('regional S through XL anchors of either parity align with each panel lattice', () => {
  for (const szScale of Lattice.g_rgszSizes) {
    for (const szPanel of ['Hxz+-', 'Hyz+-', 'Sy+']) {
      const Grid = Topology.PanelLattice(szPanel, 24, Lattice.ScaleRatio('regional', 'XL', szScale));
      for (const nQ of [-3, -2, 0, 1]) {
        const rgdAnchor = Topology.LatticeCenter(Grid, nQ, 2).map((d) => d * Grid.dMilesPerEdge);
        const Doc = Model.CreateLocalMap({
          nWidth: 5, nHeight: 4, szSystem: 'regional', szScale,
          Anchor: Coordinates.MakeLocation(szPanel, rgdAnchor[0] + Grid.dD * Grid.dMilesPerEdge / 10, rgdAnchor[1]),
        });
        assert.equal(Doc.Local.nParity, Lattice.IsOdd(nQ) ? 1 : 0);
        for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
          const [nX, nY] = Model.LocalTileXY(Doc, nTile);
          const Location = Model.TileToUniversal(Doc, nTile);
          const Expected = Topology.LatticeCenter(Grid, nQ + nX, 2 - nY).map((d) => d * Grid.dMilesPerEdge);
          assert.ok(Util.Distance(Expected, [Location.dEast, Location.dNorth]) < 1e-8);
        }
      }
    }
  }
});

test('local hit testing includes full hex tips, rejects gaps, and fits one-row/column maps', () => {
  for (const nParity of [0, 1]) {
    for (const [nWidth, nHeight] of [[1, 1], [1, 7], [7, 1], [8, 6]]) {
      const Doc = LocalMap('regional', 'L', nParity, nWidth, nHeight);
      const Geometry = View.MapGeometry(Doc);
      const Layout = View.MapLayout(Doc);
      const Outline = View.FrameOutline(Geometry, 'local');
      for (const Tile of Geometry.rgTiles) {
        for (const Vertex of Lattice.HexPolygon(Tile.rgdCenter, 1)) {
          assert.ok(Util.PointInConvex(Vertex, Outline));
          const Interior = Util.Add(Tile.rgdCenter, Util.Scale(Util.Subtract(Vertex, Tile.rgdCenter), 0.999));
          assert.equal(View.HitTest(Geometry, Layout, Interior).nTile, Tile.nIndex);
        }
      }
      for (const [nX, nY] of [[-1, 0], [0, -1], [nWidth, 0], [0, nHeight], [nWidth, nHeight]]) {
        assert.equal(View.HitTest(Geometry, Layout, Coordinates.LocalTilePoint(Doc.Local, nX, nY)), null);
      }
      assert.equal(View.HitTest(Geometry, Layout, [Layout.rgdBounds[0] + 1e-5, Layout.rgdBounds[1] + 1e-5]), null);
      const Camera = View.CreateCamera();
      View.ResizeCamera(Camera, 600, 400);
      View.FitBounds(Camera, Layout.rgdBounds);
      for (const Vertex of Outline) {
        const [dX, dY] = View.WorldToScreen(Camera, Vertex);
        assert.ok(dX >= 0 && dX <= 600 && dY >= 0 && dY <= 400);
      }
    }
  }
});

test('local pointer hit testing is not restricted to the file-coordinate snap radius', () => {
  const Doc = LocalMap();
  assert.deepEqual(Coordinates.LocalPointToTile(Doc.Local, [0.4, 0]), [0, 0]);
  const Location = Model.TileToUniversal(Doc, 0);
  assert.equal(Coordinates.UniversalToLocalTile(Doc.Local, { ...Location, dEast: Location.dEast + 0.4 * Model.HexMiles(Doc) }), null);
});

test('large local rectangles fit below the global zoom floor and still zoom about the cursor', () => {
  const Doc = LocalMap('local', 'S', 0, 300, 260);
  const Layout = View.MapLayout(Doc);
  const Camera = View.CreateCamera();
  View.ResizeCamera(Camera, 600, 400);
  View.FitBounds(Camera, Layout.rgdBounds);
  assert.ok(Camera.dScale < View.g_dMinScale);
  const dFitScale = Camera.dScale;
  const rgdCursor = [80, 110];
  const Before = View.ScreenToWorld(Camera, rgdCursor);
  View.ZoomAt(Camera, rgdCursor, 0.5);
  assert.ok(Util.Distance(View.ScreenToWorld(Camera, rgdCursor), Before) < 1e-10);
  View.ZoomAt(Camera, rgdCursor, 1e-10);
  assert.equal(Camera.dScale, dFitScale / 4);
  View.FitBounds(Camera, View.BuildNetLayout().rgdBounds);
  assert.equal(Camera.dMinScale, View.g_dMinScale, 'global fit restores its usual minimum');
});

test('local edge strokes, brush and flood-fill are bounded and undoable for both parities', () => {
  for (const nParity of [0, 1]) {
    const Doc = LocalMap('regional', 'M', nParity, 20, 12);
    const Geometry = View.MapGeometry(Doc);
    const Hist = History.Create(Doc);
    const Stroke = Edit.BeginStroke(Hist, 4, 1);
    const From = [-3, -4.25], To = [21, -4.25];
    Edit.StrokeTo(Stroke, Geometry.Layout, From);
    Edit.StrokeTo(Stroke, Geometry.Layout, To);
    const Command = Edit.EndStroke(Stroke);
    assert.ok(Command.rgChanges.length > 30);
    for (let nSample = 0; nSample <= 1000; nSample++) {
      const Point = Util.Add(From, Util.Scale(Util.Subtract(To, From), nSample / 1000));
      const Hit = View.HitTest(Geometry, Geometry.Layout, Point);
      if (Hit) assert.equal(Model.GetTerrain(Doc, Hit.nTile), 4);
    }
    assert.ok(Edit.BrushTiles(Doc, 0, 5).every((nTile) => Model.IsTile(Doc, nTile)));
    const Painted = Doc.rgnTerrain.slice();
    History.Undo(Hist);
    assert.ok(Doc.rgnTerrain.every((nId) => nId === 0));
    History.Redo(Hist);
    assert.deepEqual(Doc.rgnTerrain, Painted);
    History.Undo(Hist);
    assert.equal(Edit.Fill(Hist, 0, 5).rgnTiles.length, Doc.nTiles);
    History.Undo(Hist);
    assert.ok(Doc.rgnTerrain.every((nId) => nId === 0));
  }
});

test('local features remain in one flat frame beyond the anchor panel boundary', () => {
  const Doc = Model.CreateLocalMap({
    nWidth: 12, nHeight: 9, szSystem: 'regional', szScale: 'XL',
    Anchor: Coordinates.ParseUniversal('Eta 10000E 10000N'),
  });
  const Geometry = View.MapGeometry(Doc);
  const rgnTiles = Edit.FindPath(Doc, 0, Doc.nTiles - 1);
  Model.AddOverlay(Doc, { szType: 'road', rgnTiles });
  Model.AddLabel(Doc, { nTile: 22, szCategory: 'region', szText: 'Beyond the panel', dDx: 48, dDy: 24, dRotation: 90 });
  const Curves = View.OverlayCurves(Geometry, Doc.rgOverlays[0]);
  assert.equal(Curves.length, rgnTiles.length - 1);
  Curves.forEach((Curve, nIndex) => {
    assert.equal(Curve.szPanel, 'local');
    assert.deepEqual(Curve.rgrgdControl[0], Geometry.rgTiles[rgnTiles[nIndex]].rgdCenter);
    assert.deepEqual(Curve.rgrgdControl[3], Geometry.rgTiles[rgnTiles[nIndex + 1]].rgdCenter);
  });
  assert.equal(View.FeatureCopies(Geometry, Geometry.Layout, 22).length, 1);
  const Transform = View.LabelTransform(Geometry, Doc.rgLabels[0]);
  const Center = Geometry.rgTiles[22].rgdCenter;
  assert.deepEqual(Transform.slice(4), [Center[0] + 1, Center[1] - 0.5]);
  assert.ok(Math.abs(Transform[1] + 1 / 48) < 1e-12);
  assert.equal(Model.TileToUniversal(Doc, Doc.nTiles - 1).szPanel, Doc.Local.Anchor.szPanel);
});

test('arbitrary free anchors produce canonical files after terrain and feature edits at every yard scale', () => {
  for (const szScale of Lattice.g_rgszSizes) {
    const Anchor = Coordinates.ParseUniversal('Eta 123.456789E 98.765432N');
    const Doc = Model.CreateLocalMap({ nWidth: 8, nHeight: 6, szSystem: 'local', szScale, Anchor });
    const Hist = History.Create(Doc);
    Edit.Fill(Hist, 0, 4);
    Edit.SetFeature(Hist, 'landmark', 1, { szType: 'village', szName: 'Village' });
    Edit.SetFeature(Hist, 'label', null, { nTile: 2, szCategory: 'location', szText: 'Label', dRotation: 37, dDx: 4 });
    Edit.SetFeature(Hist, 'overlay', null, { szType: 'river', rgnTiles: Edit.FindPath(Doc, 0, 47) });
    const Text = FileFormat.Write(Doc);
    const Parsed = FileFormat.Parse(Text);
    assert.equal(FileFormat.Write(Parsed), Text);
    assert.deepEqual(Parsed.rgnTerrain, Doc.rgnTerrain);
    assert.deepEqual(Parsed.Landmarks, Doc.Landmarks);
    assert.deepEqual(Parsed.rgLabels, Doc.rgLabels);
    assert.deepEqual(Parsed.rgOverlays, Doc.rgOverlays);
    assert.deepEqual(Doc.Local.Anchor, Anchor, 'saving never mutates the free anchor');
    assert.ok(Util.Distance([Anchor.dEast, Anchor.dNorth], [Parsed.Local.Anchor.dEast, Parsed.Local.Anchor.dNorth]) < Doc.Local.dHexMiles / 10);
    for (let nTile = 0; nTile < Parsed.nTiles; nTile++) {
      assert.deepEqual(Coordinates.UniversalToLocalTile(Parsed.Local, Model.TileToUniversal(Parsed, nTile)), Model.LocalTileXY(Parsed, nTile));
    }
  }
});

test('local configuration rejects invalid dimensions, references, scales and anchors', () => {
  const Options = { nWidth: 8, nHeight: 6, szSystem: 'regional', szScale: 'M', Anchor: Coordinates.ParseUniversal('Eta 0E 0N') };
  for (const Changes of [
    { nWidth: 0 }, { nHeight: -1 }, { nWidth: 1.5 }, { nWidth: Infinity },
    { nWidth: Number.MAX_SAFE_INTEGER + 1 }, { nWidth: 1e9, nHeight: 1e9 },
    { nPanelHexes: 0 }, { nPanelHexes: 3 }, { nPanelHexes: Infinity },
    { szSystem: 'unknown' }, { szScale: 'XXL' }, { Anchor: null },
    { Anchor: { ...Options.Anchor, dEast: Infinity } }, { Anchor: { ...Options.Anchor, dNorth: NaN } },
    { Anchor: { ...Options.Anchor, szPanel: 'unknown' } },
  ]) {
    assert.throws(() => Coordinates.CreateLocalMap({ ...Options, ...Changes }));
  }
  assert.throws(() => Coordinates.ParseUniversal(`Eta ${'9'.repeat(400)}E 0N`), /finite/);
  assert.throws(() => Model.TileToUniversal(LocalMap(), -1), /tile/i);
});
