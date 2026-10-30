'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Lattice, Coordinates, Model, Terrain, View, Regions } = LoadModules();

function LocalMap(nWidth = 9, nHeight = 9) {
  return Model.CreateLocalMap({ nWidth, nHeight, szSystem: 'regional', szScale: 'M', Anchor: Coordinates.ParseUniversal('Eta 0E 0N') });
}

function Area(Region) {
  return Region.rgrgrgdLoops.reduce((dSum, Loop) => dSum + Util.PolygonArea(Loop), 0);
}

test('one local hex yields one closed six-edge region and no exterior shoreline', () => {
  const Doc = LocalMap(1, 1);
  Model.SetTerrain(Doc, 0, 4);
  const Result = Regions.Build(Doc);
  assert.equal(Result.rgRegions.length, 1);
  assert.equal(Result.rgRegions[0].rgrgrgdLoops.length, 1);
  const Loop = Result.rgRegions[0].rgrgrgdLoops[0];
  assert.equal(Loop.length, 7);
  assert.deepEqual(Loop[0], Loop.at(-1));
  assert.ok(Math.abs(Area(Result.rgRegions[0]) - Lattice.HexArea(1)) < 1e-12);
  assert.equal(Result.rgEdges.length, 6);
  assert.deepEqual(Result.rgShorelines, []);
});

test('a same-terrain ring retains its hole; disconnected equal terrain stays separate', () => {
  const Doc = LocalMap();
  const nCenter = Model.LocalTileIndex(Doc, 4, 4);
  const Ring = Model.Neighbors(Doc, nCenter);
  Ring.forEach((nTile) => Model.SetTerrain(Doc, nTile, 10));
  const Result = Regions.Build(Doc);
  const Forest = Result.rgRegions.find((Region) => Region.nTerrainId === 10);
  assert.equal(Result.rgRegions.length, 3);
  assert.equal(Forest.rgnTiles.length, 6);
  assert.equal(Forest.rgrgrgdLoops.length, 2);
  assert.ok(Forest.rgrgrgdLoops.some((Loop) => Util.PolygonArea(Loop) > 0));
  assert.ok(Forest.rgrgrgdLoops.some((Loop) => Util.PolygonArea(Loop) < 0));
  assert.ok(Math.abs(Area(Forest) - 6 * Lattice.HexArea(1)) < 1e-10);
  assert.equal(Result.rgShorelines.length, 2);
  assert.ok(Result.rgShorelines.every((Path) => Path.fClosed));
  assert.equal(Result.rgShorelines.reduce((nSum, Path) => nSum + Path.rgrgdPoints.length - 1, 0), 24);
  Model.SetTerrain(Doc, 0, 10);
  assert.equal(Regions.Build(Doc).rgRegions.filter((Region) => Region.nTerrainId === 10).length, 2);
});

test('coasts separate land from any water terrain, never colour changes or the export border', () => {
  const Doc = LocalMap(10, 8);
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    const [nX, nY] = Model.LocalTileXY(Doc, nTile);
    Model.SetTerrain(Doc, nTile, nX < 5 ? nY % 4 : 4 + nY % 3);
  }
  const Result = Regions.Build(Doc);
  assert.equal(Result.rgShorelines.length, 1);
  assert.equal(Result.rgShorelines[0].fClosed, false);
  const Expected = Result.rgEdges.filter((Edge) => Edge.rgnCells.length === 2
    && Terrain.IsWater(Result.rgCells[Edge.rgnCells[0]].nTerrainId) !== Terrain.IsWater(Result.rgCells[Edge.rgnCells[1]].nTerrainId));
  assert.equal(Result.rgShorelines[0].rgrgdPoints.length - 1, Expected.length);
  const Smoothed = Regions.SmoothPath(Result.rgShorelines[0]);
  assert.deepEqual(Smoothed.rgrgdPoints[0], Result.rgShorelines[0].rgrgdPoints[0]);
  assert.deepEqual(Smoothed.rgrgdPoints.at(-1), Result.rgShorelines[0].rgrgdPoints.at(-1));
});

test('Chaikin smoothing preserves closure, endpoints and convex panel containment', () => {
  const Closed = { fClosed: true, rgrgdPoints: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] };
  const Smooth = Regions.SmoothPath(Closed);
  assert.equal(Smooth.rgrgdPoints.length, 17);
  assert.deepEqual(Smooth.rgrgdPoints[0], Smooth.rgrgdPoints.at(-1));
  assert.ok(Smooth.rgrgdPoints.every((Point) => Util.PointInConvex(Point, Closed.rgrgdPoints.slice(0, -1))));
  assert.deepEqual(Regions.SmoothPath(Closed, 0), Closed);
  assert.notEqual(Regions.SmoothPath(Closed, 0).rgrgdPoints, Closed.rgrgdPoints);
  assert.throws(() => Regions.SmoothPath(Closed, 4), /0 to 3/);
});

test('clipped regions cover every global panel with closed loops at XL and L', () => {
  for (const [nPanelHexes, szTileScale] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const Doc = Model.CreateGlobalMap({ nPanelHexes, szTileScale });
    Doc.rgnTerrain.set(View.DemoTerrain(Doc.Topo, 1));
    for (const szPanel of Object.keys(Projection.Build().Panels)) {
      const Result = Regions.Build(Doc, szPanel);
      assert.ok(Math.abs(Result.rgRegions.reduce((dSum, Region) => dSum + Area(Region), 0)
        - Util.PolygonArea(Result.rgrgdOutline)) < 1e-5, `${nPanelHexes} ${szTileScale} ${szPanel}`);
      for (const Region of Result.rgRegions) {
        assert.ok(Region.rgrgrgdLoops.every((Loop) => Loop.length >= 4 && Util.Distance(Loop[0], Loop.at(-1)) === 0));
        assert.ok(Region.rgnTiles.every((nTile) => Model.GetTerrain(Doc, nTile) === Region.nTerrainId));
      }
      assert.ok(Result.rgrgdPoints.every((Point) => Util.PointInConvex(Point, Result.rgrgdOutline, 1e-7)));
      for (const Path of Result.rgShorelines) {
        assert.ok(Regions.SmoothPath(Path).rgrgdPoints.every((Point) => Util.PointInConvex(Point, Result.rgrgdOutline, 1e-7)));
      }
    }
  }
});

test('n=24 L export cancels interior edges rather than retaining individual tile rings', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 24, szTileScale: 'L' });
  const Result = Regions.Build(Doc, Coordinates.PanelIdByName('Alpha'));
  assert.ok(Result.rgCells.length > 10000);
  assert.equal(Result.rgRegions.length, 1);
  assert.equal(Result.rgRegions[0].rgrgrgdLoops.length, 1);
  assert.ok(Result.rgRegions[0].rgrgrgdLoops[0].length < 1000);
  assert.deepEqual(Result.rgShorelines, []);
});

test('equatorial export includes the neighbouring owner of each overhanging hex tip', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const szOwner = Coordinates.PanelIdByName('Gamma'), szDraw = Coordinates.PanelIdByName('Beta');
  const Tile = Doc.Topo.rgTiles.find((Item) => Item.szPanel === szOwner
    && Item.nColumn === Doc.Topo.Panels[szOwner].nColumns - 1 && !Item.fPartial);
  Model.SetTerrain(Doc, Tile.nIndex, 10);
  const Result = Regions.Build(Doc, szDraw);
  const Cell = Result.rgCells.find((Item) => Item.nTile === Tile.nIndex);
  assert.ok(Cell, 'the Beta export includes the Gamma-owned tip');
  assert.equal(Cell.nTerrainId, 10);
  const dArea = Util.PolygonArea(Cell.rgnVertices.map((nIndex) => Result.rgrgdPoints[nIndex]));
  assert.ok(dArea > 0 && dArea < Lattice.HexArea(1) / 4);
  const TipRegion = Result.rgRegions.find((Region) => Region.nTerrainId === 10);
  assert.deepEqual(TipRegion.rgnTiles, [Tile.nIndex]);
  assert.ok(Result.rgShorelines.every((Path) => !Path.fClosed), 'no coastline is invented along the panel cut');
});

test('random local terrain partitions preserve area and topology without modifying the model', () => {
  const Random = Util.CreateRng(140);
  for (let nTrial = 0; nTrial < 20; nTrial++) {
    const Doc = LocalMap(12, 12);
    for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
      Model.SetTerrain(Doc, nTile, Math.floor(Random() * 17));
    }
    const Before = Doc.rgnTerrain.slice(), nRevision = Doc.nRevision;
    const Result = Regions.Build(Doc);
    assert.equal(Result.rgCells.length, Doc.nTiles);
    assert.ok(Math.abs(Result.rgRegions.reduce((dSum, Region) => dSum + Area(Region), 0) - Doc.nTiles * Lattice.HexArea(1)) < 1e-8);
    assert.deepEqual(Doc.rgnTerrain, Before);
    assert.equal(Doc.nRevision, nRevision);
  }
});

test('region export rejects invalid scope and ambiguous boundaries explicitly', () => {
  assert.throws(() => Regions.Build(LocalMap(), 'Alpha'), /panel/);
  assert.throws(() => Regions.Build(Model.CreateGlobalMap({ nPanelHexes: 4 })), /panel/);
  assert.throws(() => Regions.Build(Model.CreateGlobalMap({ nPanelHexes: 4 }), 'constructor'), /panel/);
  assert.throws(() => Regions.TracePaths([{ nA: 0, nB: 1 }, { nA: 0, nB: 2 }], [[0, 0], [1, 0], [0, 1]]), /Ambiguous/);
});
