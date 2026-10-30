'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Projection, Terrain, Model, History, View, Edit, FileFormat } = LoadModules();
const g_Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });

function LocalMap(nWidth = 9, nHeight = 7) {
  return Model.CreateLocalMap({
    nWidth, nHeight, szSystem: 'regional', szScale: 'M',
    Anchor: { szPanel: Object.keys(Projection.Build().Panels)[0], dEast: 0, dNorth: 0 },
  });
}

function Distances(Doc, nStart, Excluded = new Set()) {
  const Steps = new Map([[nStart, 0]]);
  const rgnQueue = [nStart];
  for (let nHead = 0; nHead < rgnQueue.length; nHead++) {
    const nTile = rgnQueue[nHead];
    for (const nOther of Model.Neighbors(Doc, nTile)) {
      if (!Steps.has(nOther) && !Excluded.has(nOther)) {
        Steps.set(nOther, Steps.get(nTile) + 1);
        rgnQueue.push(nOther);
      }
    }
  }
  return Steps;
}

function AssertPath(Doc, rgnPath, nFrom, nTo) {
  assert.equal(rgnPath[0], nFrom);
  assert.equal(rgnPath.at(-1), nTo);
  rgnPath.forEach((nTile) => assert.ok(Model.IsTile(Doc, nTile)));
  for (let nIndex = 1; nIndex < rgnPath.length; nIndex++) {
    assert.ok(Model.AreAdjacent(Doc, rgnPath[nIndex - 1], rgnPath[nIndex]), `connected at ${nIndex}`);
  }
}

function AssertUndoable(Hist, Action) {
  const szBefore = FileFormat.Write(Hist.Doc);
  const nUndo = Hist.rgUndo.length;
  const Command = Action();
  assert.ok(Command);
  assert.equal(Hist.rgUndo.length, nUndo + 1, 'one command');
  const szAfter = FileFormat.Write(Hist.Doc);
  assert.notEqual(szAfter, szBefore);
  assert.equal(History.Undo(Hist), Command);
  assert.equal(FileFormat.Write(Hist.Doc), szBefore, 'undo restores exact document');
  assert.equal(History.Redo(Hist), Command);
  assert.equal(FileFormat.Write(Hist.Doc), szAfter, 'redo restores exact document');
  assert.equal(FileFormat.Write(FileFormat.Parse(szAfter)), szAfter, 'edited document remains canonical');
  return Command;
}

test('A* is deterministic and shortest against BFS for global and local tiles', () => {
  for (const Doc of [g_Doc, LocalMap()]) {
    for (let nStart = 0; nStart < Doc.nTiles; nStart += 17) {
      const Steps = Distances(Doc, nStart);
      for (let nEnd = 0; nEnd < Doc.nTiles; nEnd += 13) {
        const rgnPath = Edit.FindPath(Doc, nStart, nEnd);
        AssertPath(Doc, rgnPath, nStart, nEnd);
        assert.equal(rgnPath.length - 1, Steps.get(nEnd));
        assert.deepEqual(Edit.FindPath(Doc, nStart, nEnd), rgnPath);
      }
    }
  }
});

test('A* crosses every seam, including wraparound and tiny partial tiles, in one step', () => {
  const Seen = new Set();
  for (const Tile of g_Doc.Topo.rgTiles) {
    for (const nOther of Model.Neighbors(g_Doc, Tile.nIndex)) {
      const Other = g_Doc.Topo.rgTiles[nOther];
      if (Tile.szPanel !== Other.szPanel) {
        assert.deepEqual(Edit.FindPath(g_Doc, Tile.nIndex, nOther), [Tile.nIndex, nOther]);
        Seen.add([Tile.szPanel, Other.szPanel].sort().join('|'));
      }
    }
  }
  assert.equal(Seen.size, Projection.Build().Seams.length);
});

test('A* handles exclusions, equal endpoints, invalid inputs and unreachable targets', () => {
  const Doc = LocalMap(5, 5);
  const Excluded = new Set([11, 12, 13]);
  const rgnPath = Edit.FindPath(Doc, 0, 24, Excluded);
  AssertPath(Doc, rgnPath, 0, 24);
  assert.equal(rgnPath.length - 1, Distances(Doc, 0, Excluded).get(24));
  assert.ok(rgnPath.every((nTile) => !Excluded.has(nTile)));
  assert.deepEqual(Edit.FindPath(Doc, 4, 4), [4]);
  assert.throws(() => Edit.FindPath(Doc, -1, 0), /endpoints/);
  assert.throws(() => Edit.FindPath(Doc, 0, Doc.nTiles), /endpoints/);
  assert.throws(() => Edit.FindPath(Doc, 12, 24, Excluded), /excluded/);
  assert.throws(() => Edit.FindPath(Doc, 0, 24, new Set(Model.Neighbors(Doc, 0))), /No path/);
});

test('overlay create, extend and insert are connected single undo steps', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const Hist = History.Create(Doc);
  AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'overlay', null, { szType: 'river', szName: 'Silverrun', rgnTiles: [0] }));
  AssertUndoable(Hist, () => Edit.ExtendOverlay(Hist, 'river1', Doc.nTiles - 1));
  const Before = Model.GetOverlay(Doc, 'river1');
  AssertPath(Doc, Before.rgnTiles, 0, Doc.nTiles - 1);
  const nInsert = 2;
  const nTile = 50;
  AssertUndoable(Hist, () => Edit.InsertOverlayPoint(Hist, 'river1', nInsert, nTile));
  const After = Model.GetOverlay(Doc, 'river1');
  assert.deepEqual(After.rgnTiles.slice(0, nInsert + 1), Before.rgnTiles.slice(0, nInsert + 1));
  assert.ok(After.rgnTiles.includes(nTile));
  AssertPath(Doc, After.rgnTiles, 0, Doc.nTiles - 1);
  assert.equal(Edit.ExtendOverlay(Hist, 'river1', After.rgnTiles.at(-1)), null);
});

test('removing overlay points reconnects around the removed tile, including loops', () => {
  const Doc = LocalMap();
  const Hist = History.Create(Doc);
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'road', rgnTiles: Edit.FindPath(Doc, 0, Doc.nTiles - 1) });
  const Before = Model.GetOverlay(Doc, 'road1');
  const nRemoved = Before.rgnTiles[2];
  AssertUndoable(Hist, () => Edit.RemoveOverlayPoint(Hist, 'road1', 2));
  const After = Model.GetOverlay(Doc, 'road1');
  assert.ok(!After.rgnTiles.includes(nRemoved));
  AssertPath(Doc, After.rgnTiles, Before.rgnTiles[0], Before.rgnTiles.at(-1));
  AssertUndoable(Hist, () => Edit.RemoveOverlayPoint(Hist, 'road1', 0));
  AssertUndoable(Hist, () => Edit.RemoveOverlayPoint(Hist, 'road1', Model.GetOverlay(Doc, 'road1').rgnTiles.length - 1));
  const nNext = Model.Neighbors(Doc, 0)[0];
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'trail', rgnTiles: [0, nNext, 0] });
  AssertUndoable(Hist, () => Edit.RemoveOverlayPoint(Hist, 'trail1', 1));
  assert.deepEqual(Model.GetOverlay(Doc, 'trail1').rgnTiles, [0]);
  AssertUndoable(Hist, () => Edit.RemoveOverlayPoint(Hist, 'trail1', 0));
  assert.equal(Model.GetOverlay(Doc, 'trail1'), null);
});

test('split shares its junction; join supports all endpoint orientations and preserves properties', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const Hist = History.Create(Doc);
  const rgnOriginal = Edit.FindPath(Doc, 0, Doc.nTiles - 1);
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'road', szName: 'Main Road', szStyle: 'highway', rgnTiles: rgnOriginal });
  AssertUndoable(Hist, () => Edit.SplitOverlay(Hist, 'road1', 3));
  assert.deepEqual(Doc.rgOverlays[0].rgnTiles, rgnOriginal.slice(0, 4));
  assert.deepEqual(Doc.rgOverlays[1].rgnTiles, rgnOriginal.slice(3));
  assert.equal(Doc.rgOverlays[1].szName, 'Main Road');
  assert.equal(Doc.rgOverlays[1].szStyle, 'highway');
  AssertUndoable(Hist, () => Edit.JoinOverlays(Hist, 'road1', 'road2'));
  assert.deepEqual(Doc.rgOverlays[0].rgnTiles, rgnOriginal);
  assert.equal(Doc.rgOverlays.length, 1);
  for (const fReverseFirst of [false, true]) {
    for (const fReverseSecond of [false, true]) {
      Edit.SetFeature(Hist, 'overlay', null, { szType: 'road', szName: 'Side road', rgnTiles: Edit.FindPath(Doc, 20, 45) });
      const First = Model.GetOverlay(Doc, 'road1'), Second = Model.GetOverlay(Doc, 'road2');
      AssertUndoable(Hist, () => Edit.JoinOverlays(Hist, 'road1', 'road2', fReverseFirst, fReverseSecond));
      const Joined = Model.GetOverlay(Doc, 'road1');
      AssertPath(Doc, Joined.rgnTiles, fReverseFirst ? First.rgnTiles.at(-1) : First.rgnTiles[0], fReverseSecond ? Second.rgnTiles[0] : Second.rgnTiles.at(-1));
      assert.equal(Joined.szName, First.szName);
      assert.equal(Joined.szStyle, First.szStyle);
    }
  }
});

test('failed edits leave the document and history intact', () => {
  const Doc = LocalMap(1, 3);
  const Hist = History.Create(Doc);
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'road', rgnTiles: [0, 1, 2] });
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'river', rgnTiles: [0] });
  const szBefore = FileFormat.Write(Doc);
  const nUndo = Hist.rgUndo.length;
  const nRevision = Doc.nRevision;
  for (const Action of [
    () => Edit.RemoveOverlayPoint(Hist, 'road1', 1),
    () => Edit.SplitOverlay(Hist, 'road1', 0),
    () => Edit.SplitOverlay(Hist, 'road1', 2),
    () => Edit.InsertOverlayPoint(Hist, 'road1', -1, 1),
    () => Edit.JoinOverlays(Hist, 'road1', 'road1'),
    () => Edit.JoinOverlays(Hist, 'road1', 'river1'),
    () => Edit.ExtendOverlay(Hist, 'missing', 0),
    () => Edit.SetFeature(Hist, 'overlay', 'road1', { szStyle: 'bad style' }),
    () => Edit.SetFeature(Hist, 'label', null, { nTile: 0, szCategory: 'city', szText: '' }),
  ]) {
    assert.throws(Action);
    assert.equal(FileFormat.Write(Doc), szBefore);
    assert.equal(Hist.rgUndo.length, nUndo);
    assert.equal(Doc.nRevision, nRevision);
    assert.equal(Hist.Pending, null);
  }
});

test('landmark place, replace, edit and erase affect only their layer', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const Hist = History.Create(Doc);
  Edit.SetFeature(Hist, 'overlay', null, { szType: 'road', rgnTiles: [10] });
  const rgnTerrain = Doc.rgnTerrain.slice();
  for (const Type of Terrain.g_rgLandmarkTypes) {
    assert.match(Type.szPath, /^M/);
    AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'landmark', 10, { szType: Type.szKey, szName: Type.szName }));
    assert.equal(Doc.Landmarks.size, 1);
  }
  AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'landmark', 10, { szNotes: 'Old gate' }));
  assert.equal(Edit.SetFeature(Hist, 'landmark', 10, { szNotes: 'Old gate' }), null);
  AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'landmark', 10, null));
  assert.equal(Doc.rgOverlays.length, 1);
  assert.deepEqual(Doc.rgnTerrain, rgnTerrain);
});

test('multiple labels on one tile support every property and undoable erase', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const Hist = History.Create(Doc);
  for (const szCategory of Model.g_rgszLabelCategories) {
    AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'label', null, { nTile: 5, szCategory, szText: szCategory }));
  }
  assert.equal(Model.LabelsAt(Doc, 5).length, 3);
  AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'label', 'label1', { szText: 'Grey Hills', szCategory: 'city', dSize: 12.5, dRotation: -43.2, dDx: 3.4, dDy: -12 }));
  const Label = Model.GetLabel(Doc, 'label1');
  assert.equal(Edit.SetFeature(Hist, 'label', 'label1', { dDx: 3.4, dDy: -12 }), null);
  assert.equal(Edit.GetFeature(Doc, { szLayer: 'label', Key: 'label1' }), Label);
  AssertUndoable(Hist, () => Edit.SetFeature(Hist, 'label', 'label1', null));
  assert.equal(Model.LabelsAt(Doc, 5).length, 2);
  assert.equal(Edit.GetFeature(Doc, { szLayer: 'label', Key: 'label1' }), null);
});

function AssertPointClose(A, B) {
  assert.ok(Util.Distance(A, B) < 1e-8, `${A} != ${B}`);
}

test('feature anchors lie in their tile, including clipped partial tiles', () => {
  const Layout = View.BuildNetLayout();
  for (const Tile of g_Doc.Topo.rgTiles) {
    const rgdAnchor = View.FeatureAnchor(g_Doc.Topo, Tile.nIndex);
    const Copy = View.FeatureCopies(g_Doc.Topo, Layout, Tile.nIndex).find((Item) => Item.Placement.szPanel === Tile.szPanel);
    const rgdWorld = Projection.ApplyTransform(Copy.rgdFrameToWorld, rgdAnchor);
    assert.equal(View.HitTest(g_Doc.Topo, Layout, rgdWorld).nTile, Tile.nIndex);
  }
});

test('every cross-seam curve is identical on both panels after unfolding, not a net-spanning line', () => {
  const Topo = g_Doc.Topo;
  let nCrossings = 0;
  for (const Tile of Topo.rgTiles) {
    for (const nOther of Model.Neighbors(g_Doc, Tile.nIndex)) {
      const Other = Topo.rgTiles[nOther];
      if (Tile.szPanel === Other.szPanel) {
        continue;
      }
      const Overlay = { rgnTiles: [Tile.nIndex, nOther] };
      const rgCurves = View.OverlayCurves(Topo, Overlay);
      assert.equal(View.OverlayCurves(Topo, Overlay), rgCurves, 'immutable overlay geometry is cached');
      const A = rgCurves.find((Curve) => Curve.szPanel === Tile.szPanel);
      const B = rgCurves.find((Curve) => Curve.szPanel === Other.szPanel);
      assert.ok(A && B);
      const rgdBToA = View.PanelTransform(Other.szPanel, Tile.szPanel);
      for (let nPoint = 0; nPoint < 4; nPoint++) {
        AssertPointClose(A.rgrgdControl[nPoint], Projection.ApplyTransform(rgdBToA, B.rgrgdControl[nPoint]));
      }
      AssertPointClose(A.rgrgdControl[0], View.FeatureAnchor(Topo, Tile.nIndex));
      AssertPointClose(B.rgrgdControl[3], View.FeatureAnchor(Topo, nOther));
      assert.ok(Util.Distance(A.rgrgdControl[0], A.rgrgdControl[3]) < Topo.dD * 3);
      const Focus = View.BuildFocusLayout(Tile.szPanel);
      const rgdBToWorld = View.FindPlacement(Focus, Other.szPanel).rgdFrameToWorld;
      AssertPointClose(Projection.ApplyTransform(rgdBToWorld, B.rgrgdControl[0]), A.rgrgdControl[0]);
      nCrossings++;
    }
  }
  assert.ok(nCrossings > 100);
});

test('successive smooth segments meet with equal tangents, also at panel seams', () => {
  const Topo = g_Doc.Topo;
  const Overlay = { rgnTiles: Edit.FindPath(g_Doc, 0, g_Doc.nTiles - 1) };
  const Curves = View.OverlayCurves(Topo, Overlay);
  for (let nPoint = 1; nPoint < Overlay.rgnTiles.length - 1; nPoint++) {
    const szPanel = Topo.rgTiles[Overlay.rgnTiles[nPoint]].szPanel;
    const Before = Curves.find((Curve) => Curve.nPoint === nPoint - 1 && Curve.szPanel === szPanel).rgrgdControl;
    const After = Curves.find((Curve) => Curve.nPoint === nPoint && Curve.szPanel === szPanel).rgrgdControl;
    AssertPointClose(Before[3], After[0]);
    AssertPointClose(Util.Subtract(Before[3], Before[2]), Util.Subtract(After[1], After[0]));
  }
});

test('adaptive curve hits track the drawn cubic within half a screen pixel', () => {
  const rgControls = [[0, 0], [1000, -1800], [2000, 1300], [3000, 0]];
  const rgPoints = View.FlattenCurve(rgControls);
  assert.deepEqual(rgPoints[0], rgControls[0]);
  assert.deepEqual(rgPoints.at(-1), rgControls[3]);
  for (let nStep = 0; nStep <= 1000; nStep++) {
    const Point = View.CubicPoint(rgControls, nStep / 1000);
    assert.ok(rgPoints.slice(1).some((End, nIndex) => View.DistanceToSegment(Point, rgPoints[nIndex], End) <= 0.5));
  }
  assert.equal(View.DistanceToSegment([3, 4], [0, 0], [0, 0]), 5);
});

test('label transforms preserve panel-relative size, clockwise rotation and offsets in every focus view', () => {
  const Topo = g_Doc.Topo;
  const nTile = Topo.rgTiles.find((Tile) => !Tile.fPartial).nIndex;
  const Label = { nTile, dSize: 18, dRotation: 90, dDx: 12, dDy: -24 };
  const rgdT = View.LabelTransform(Topo, Label);
  const dUnit = Topo.dD / View.g_dLabelUnitsPerHex;
  const rgdCenter = View.FeatureAnchor(Topo, nTile);
  AssertPointClose(Projection.ApplyTransform(rgdT, [0, 0]), [rgdCenter[0] + 12 * dUnit, rgdCenter[1] + 24 * dUnit]);
  AssertPointClose(Util.Subtract(Projection.ApplyTransform(rgdT, [1, 0]), Projection.ApplyTransform(rgdT, [0, 0])), [0, -dUnit]);
  for (const szPanel of Object.keys(Topo.Panels)) {
    const Layout = View.BuildFocusLayout(szPanel);
    const Camera = View.CreateCamera(900, 600);
    for (const Copy of View.FeatureCopies(Topo, Layout, nTile)) {
      const rgdScreen = Projection.ComposeTransforms(rgdT, Projection.ComposeTransforms(Copy.rgdFrameToWorld, View.WorldToScreenTransform(Camera)));
      const Inverse = Projection.InvertTransform(rgdScreen);
      for (const Point of [[0, 0], [12, -32], [-40, 100]]) {
        AssertPointClose(Projection.ApplyTransform(Inverse, Projection.ApplyTransform(rgdScreen, Point)), Point);
      }
    }
  }
});
