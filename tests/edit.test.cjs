'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Projection, Topology, Terrain, Model, History, View, Edit } = LoadModules();

const g_Doc = Model.CreateGlobalMap({ nPanelHexes: 24, szTileScale: 'XL', szName: 'Edit test' });
const g_Topo = g_Doc.Topo;
const g_nWater = Terrain.ByKey('water').nId;
const g_nForest = Terrain.ByKey('forest').nId;
const g_nMountain = Terrain.ByKey('mountains').nId;

function PanelTiles(szPanel) {
  const Info = g_Topo.Panels[szPanel];
  return Array.from({ length: Info.nTileCount }, (_, nIndex) => Info.nFirstTile + nIndex);
}

function FirstEquatorialPanel() {
  return Object.keys(g_Topo.Panels).find((szPanel) => g_Topo.Panels[szPanel].Lattice.fEquatorial);
}

// The tile nearest the mean of its panel's tile centres.
function CentralTile(szPanel) {
  const rgnTiles = PanelTiles(szPanel);
  const rgdMean = [0, 0];
  rgnTiles.forEach((nTile) => {
    rgdMean[0] += g_Topo.rgTiles[nTile].rgdCenter[0] / rgnTiles.length;
    rgdMean[1] += g_Topo.rgTiles[nTile].rgdCenter[1] / rgnTiles.length;
  });
  let nBest = rgnTiles[0];
  let dBest = Infinity;
  for (const nTile of rgnTiles) {
    const [dX, dY] = g_Topo.rgTiles[nTile].rgdCenter;
    const dDistance = Math.hypot(dX - rgdMean[0], dY - rgdMean[1]);
    if (dDistance < dBest) {
      dBest = dDistance;
      nBest = nTile;
    }
  }
  return nBest;
}

// Breadth-first step counts from nStart.
function Distances(nStart, nMax) {
  const Steps = new Map([[nStart, 0]]);
  let rgnRing = [nStart];
  for (let nStep = 1; nStep <= nMax; nStep++) {
    const rgnNext = [];
    for (const nTile of rgnRing) {
      for (const nOther of Topology.Neighbors(g_Topo, nTile)) {
        if (!Steps.has(nOther)) {
          Steps.set(nOther, nStep);
          rgnNext.push(nOther);
        }
      }
    }
    rgnRing = rgnNext;
  }
  return Steps;
}

function ResetTerrain(Doc, nId = g_nWater) {
  Doc.rgnTerrain.fill(nId);
  Doc.nRevision++;
}

function WorldCenter(Layout, nTile) {
  const Tile = g_Topo.rgTiles[nTile];
  return Projection.ApplyTransform(View.FindPlacement(Layout, Tile.szPanel).rgdFrameToWorld, Tile.rgdCenter);
}

test('brush footprint is a hex of 3r(r+1)+1 tiles at an interior tile', () => {
  const nCenter = CentralTile(FirstEquatorialPanel());
  for (let nRadius = 0; nRadius <= Edit.g_nMaxBrushRadius; nRadius++) {
    const rgnTiles = Edit.BrushTiles(g_Doc, nCenter, nRadius);
    assert.equal(rgnTiles.length, 3 * nRadius * (nRadius + 1) + 1, `radius ${nRadius}`);
    assert.equal(new Set(rgnTiles).size, rgnTiles.length, 'no duplicates');
    assert.equal(rgnTiles[0], nCenter, 'centre first');
  }
});

test('brush tiles are exactly the tiles within r steps, nearest first, across seams', () => {
  const szPanel = FirstEquatorialPanel();
  const Info = g_Topo.Panels[szPanel];
  // The easternmost tile of the panel sits on the seam with its east neighbour.
  const nEdge = PanelTiles(szPanel).reduce((nBest, nTile) =>
    g_Topo.rgTiles[nTile].rgdCenter[0] > g_Topo.rgTiles[nBest].rgdCenter[0] ? nTile : nBest);
  for (const nRadius of [1, 3]) {
    const Steps = Distances(nEdge, nRadius);
    const rgnTiles = Edit.BrushTiles(g_Doc, nEdge, nRadius);
    assert.deepEqual(new Set(rgnTiles), new Set(Steps.keys()));
    for (let nIndex = 1; nIndex < rgnTiles.length; nIndex++) {
      assert.ok(Steps.get(rgnTiles[nIndex - 1]) <= Steps.get(rgnTiles[nIndex]), 'ordered by distance');
    }
    assert.ok(rgnTiles.some((nTile) => g_Topo.rgTiles[nTile].szPanel === Info.szEast), `radius ${nRadius} crosses the seam`);
  }
});

test('brush radius is validated', () => {
  for (const nBad of [-1, 1.5, Edit.g_nMaxBrushRadius + 1, NaN]) {
    assert.throws(() => Edit.BrushTiles(g_Doc, 0, nBad));
    assert.throws(() => Edit.BeginStroke(History.Create(g_Doc), g_nForest, nBad));
  }
  assert.throws(() => Edit.BrushTiles(g_Doc, -1, 1));
  assert.throws(() => Edit.BrushTiles(g_Doc, g_Doc.nTiles, 1));
});

test('flood region covers the whole world, a blob, and crosses seams', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 24, szTileScale: 'XL', szName: 'Flood' });
  ResetTerrain(Doc);
  assert.equal(Edit.FloodRegion(Doc, 0).length, Doc.nTiles);

  const szPanel = FirstEquatorialPanel();
  const nEdge = PanelTiles(szPanel).reduce((nBest, nTile) =>
    g_Topo.rgTiles[nTile].rgdCenter[0] > g_Topo.rgTiles[nBest].rgdCenter[0] ? nTile : nBest);
  const rgnBlob = Edit.BrushTiles(Doc, nEdge, 3);
  rgnBlob.forEach((nTile) => Model.SetTerrain(Doc, nTile, g_nForest));
  const rgnRegion = Edit.FloodRegion(Doc, nEdge);
  assert.deepEqual(new Set(rgnRegion), new Set(rgnBlob));
  assert.ok(new Set(rgnRegion.map((nTile) => Doc.Topo.rgTiles[nTile].szPanel)).size > 1, 'region spans panels');
  assert.equal(Edit.FloodRegion(Doc, 0).length, Doc.nTiles - rgnBlob.length);
});

test('segment tiles include every tile hit by dense sampling, in order', () => {
  const Layout = View.BuildNetLayout();
  const szPanel = FirstEquatorialPanel();
  const nFrom = CentralTile(szPanel);
  const nTo = CentralTile(g_Topo.Panels[szPanel].szEast);
  const rgdFrom = WorldCenter(Layout, nFrom);
  const rgdTo = WorldCenter(Layout, nTo);
  const rgnTiles = Edit.SegmentTiles(g_Topo, Layout, rgdFrom, rgdTo);
  assert.equal(rgnTiles[0], nFrom);
  assert.equal(rgnTiles[rgnTiles.length - 1], nTo);
  for (let nIndex = 1; nIndex < rgnTiles.length; nIndex++) {
    assert.notEqual(rgnTiles[nIndex], rgnTiles[nIndex - 1], 'no consecutive repeats');
  }
  const Included = new Set(rgnTiles);
  const nSamples = 4000;
  for (let nStep = 0; nStep <= nSamples; nStep++) {
    const dT = nStep / nSamples;
    const Hit = View.HitTest(g_Topo, Layout, [rgdFrom[0] + dT * (rgdTo[0] - rgdFrom[0]), rgdFrom[1] + dT * (rgdTo[1] - rgdFrom[1])]);
    if (Hit) {
      assert.ok(Included.has(Hit.nTile), `tile ${Hit.nTile} at t=${dT}`);
    }
  }
  // Consecutive tiles touch (the path is connected).
  for (let nIndex = 1; nIndex < rgnTiles.length; nIndex++) {
    assert.ok(Array.from(Topology.Neighbors(g_Topo, rgnTiles[nIndex - 1])).includes(rgnTiles[nIndex]), `step ${nIndex}`);
  }
  assert.deepEqual(Edit.SegmentTiles(g_Topo, Layout, rgdFrom, rgdFrom), [nFrom]);
});

test('a brush stroke is one undoable command', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 24, szTileScale: 'XL', szName: 'Stroke' });
  ResetTerrain(Doc);
  const Hist = History.Create(Doc);
  const Layout = View.BuildNetLayout();
  const szPanel = FirstEquatorialPanel();
  const rgdFrom = WorldCenter(Layout, CentralTile(szPanel));
  const rgdTo = WorldCenter(Layout, CentralTile(g_Topo.Panels[szPanel].szEast));
  const rgnBefore = Doc.rgnTerrain.slice();

  const Stroke = Edit.BeginStroke(Hist, g_nForest, 2);
  assert.equal(History.CanUndo(Hist), false, 'no undo mid-stroke');
  const rgnFirst = Edit.StrokeTo(Stroke, Layout, rgdFrom);
  assert.equal(rgnFirst.length, 19);
  const rgnSecond = Edit.StrokeTo(Stroke, Layout, [(rgdFrom[0] + rgdTo[0]) / 2, (rgdFrom[1] + rgdTo[1]) / 2]);
  const rgnThird = Edit.StrokeTo(Stroke, Layout, rgdTo);
  assert.deepEqual(Edit.StrokeTo(Stroke, Layout, rgdTo), [], 'repainting a centre changes nothing');
  const rgnAll = [...rgnFirst, ...rgnSecond, ...rgnThird];
  assert.equal(new Set(rgnAll).size, rgnAll.length, 'each tile changes once');
  rgnAll.forEach((nTile) => assert.equal(Doc.rgnTerrain[nTile], g_nForest));
  const Command = Edit.EndStroke(Stroke);
  assert.equal(Command.szLabel, 'Paint Forest');
  assert.deepEqual(new Set(Edit.CommandTiles(Command)), new Set(rgnAll));
  const rgnAfter = Doc.rgnTerrain.slice();

  assert.equal(History.Undo(Hist), Command);
  assert.deepEqual(Doc.rgnTerrain, rgnBefore);
  assert.equal(History.CanUndo(Hist), false, 'the stroke was a single command');
  History.Redo(Hist);
  assert.deepEqual(Doc.rgnTerrain, rgnAfter);
});

test('an empty stroke records nothing', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4, szTileScale: 'XL', szName: 'Empty' });
  ResetTerrain(Doc);
  const Hist = History.Create(Doc);
  const Layout = View.BuildNetLayout();
  const Stroke = Edit.BeginStroke(Hist, g_nWater, 1);
  assert.deepEqual(Edit.StrokeTo(Stroke, Layout, WorldCenter(Layout, 0)), []);
  assert.equal(Edit.EndStroke(Stroke), null);
  assert.equal(History.CanUndo(Hist), false);
});

test('fill replaces one connected region as one command', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 24, szTileScale: 'XL', szName: 'Fill' });
  ResetTerrain(Doc);
  const Hist = History.Create(Doc);
  const nCenter = CentralTile(FirstEquatorialPanel());
  // A mountain ring at distance 3 encloses a 19-tile water pocket (distance ≤ 2).
  const Steps = Distances(nCenter, 3);
  const rgnRing = [...Steps.keys()].filter((nTile) => Steps.get(nTile) === 3);
  rgnRing.forEach((nTile) => Model.SetTerrain(Doc, nTile, g_nMountain));
  const rgnBefore = Doc.rgnTerrain.slice();

  const { Command, rgnTiles } = Edit.Fill(Hist, nCenter, g_nForest);
  assert.equal(Command.szLabel, 'Fill Forest');
  assert.equal(rgnTiles.length, 19);
  assert.deepEqual(new Set(Edit.CommandTiles(Command)), new Set(rgnTiles));
  rgnRing.forEach((nTile) => assert.equal(Doc.rgnTerrain[nTile], g_nMountain));
  assert.equal(Doc.rgnTerrain.filter((nId) => nId === g_nForest).length, 19);

  const Again = Edit.Fill(Hist, nCenter, g_nForest);
  assert.equal(Again.Command, null, 'same terrain is a no-op');
  assert.deepEqual(Again.rgnTiles, []);

  History.Undo(Hist);
  assert.deepEqual(Doc.rgnTerrain, rgnBefore);
  assert.throws(() => Edit.Fill(Hist, nCenter, 999));
});

test('CommandTiles of null is empty', () => {
  assert.deepEqual(Edit.CommandTiles(null), []);
});
