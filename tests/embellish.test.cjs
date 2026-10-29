'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Lattice, Coordinates, Model, Terrain, View, Regions, Embellish, SvgExport } = LoadModules();

const g_rgszPlain = ['water', 'lakes', 'firth', 'plain'];
const Id = (szKey) => Terrain.ByKey(szKey).nId;

function LocalMap(nWidth = 9, nHeight = 9, szKey = 'plain') {
  const Doc = Model.CreateLocalMap({ nWidth, nHeight, szSystem: 'regional', szScale: 'M', Anchor: Coordinates.ParseUniversal('Eta 0E 0N') });
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    Model.SetTerrain(Doc, nTile, Id(szKey));
  }
  return Doc;
}

function Polygon(Data, Cell) {
  const rgrgdPoints = Cell.rgnVertices.map((nVertex) => Data.rgrgdPoints[nVertex]);
  return Util.PolygonArea(rgrgdPoints) < 0 ? rgrgdPoints.reverse() : rgrgdPoints;
}

function CellOf(Data, nTile) {
  return Data.rgCells.find((Cell) => Cell.nTile === nTile);
}

function SegmentDistance(rgdPoint, A, B) {
  const Direction = Util.Subtract(B, A);
  const dT = Math.min(1, Math.max(0, Util.Dot(Util.Subtract(rgdPoint, A), Direction) / Util.Dot(Direction, Direction)));
  return Util.Distance(rgdPoint, Util.Add(A, Util.Scale(Direction, dT)));
}

// Internal forest/non-forest edges whose outward normal points south, as [A, B, nForestCell].
function ExposedSouthEdges(Data) {
  const rgResults = [];
  for (const Edge of Data.rgEdges) {
    if (Edge.rgnCells.length !== 2) {
      continue;
    }
    const rgfForest = Edge.rgnCells.map((nCell) => Data.rgCells[nCell].nTerrainId === Id('forest'));
    if (rgfForest[0] === rgfForest[1]) {
      continue;
    }
    const nForest = Edge.rgnCells[rgfForest[0] ? 0 : 1], A = Data.rgrgdPoints[Edge.nA], B = Data.rgrgdPoints[Edge.nB];
    const dToCentre = Util.Center(Polygon(Data, Data.rgCells[nForest]))[1] - (A[1] + B[1]) / 2;
    const dNormalY = Math.abs(B[0] - A[0]) / Util.Distance(A, B);
    if (dToCentre > 0 && dNormalY >= -Embellish.g_dSouthFacing) {
      rgResults.push([A, B, nForest]);
    }
  }
  return rgResults;
}

test('terrain descriptors match the plan: every patterned terrain has four frozen variants', () => {
  for (const Type of Terrain.g_rgTerrains) {
    if (g_rgszPlain.includes(Type.szKey)) {
      assert.equal(Type.Embellish, null, Type.szKey);
      assert.throws(() => Embellish.Motifs(Type.szKey), /embellish/i);
      continue;
    }
    const Spec = Type.Embellish;
    assert.ok(Object.isFrozen(Spec), Type.szKey);
    assert.ok(['scatter', 'tile', 'field'].includes(Spec.szLayout));
    assert.ok(Spec.dDx > 0 && Spec.dDy > 0 && Spec.dChance > 0 && Spec.dChance <= 1);
    assert.match(Spec.szInk, /^#[0-9a-f]{6}$/);
    assert.match(Spec.szAccent, /^#[0-9a-f]{6}$/);
    const rgMotifs = Embellish.Motifs(Type.szKey);
    assert.equal(rgMotifs.length, Embellish.g_nVariants);
    assert.equal(Embellish.Motifs(Type.szKey), rgMotifs, 'motifs are cached');
    assert.ok(Object.isFrozen(rgMotifs) && rgMotifs.every((Motif) => Object.isFrozen(Motif)));
    for (const Motif of rgMotifs) {
      for (const Shape of Motif) {
        assert.ok(['body', 'ink', 'accent', 'dot'].includes(Shape.szRole));
        assert.ok(Shape.rgrgdPoints.length >= 2);
        assert.ok(Shape.rgrgdPoints.flat().every((dValue) => Number.isFinite(dValue) && Math.abs(dValue) < 0.5), Type.szKey);
      }
    }
  }
  assert.ok(Terrain.g_rgTerrains.filter((Type) => Type.Embellish).length === 13);
});

test('embellishment is deterministic, read-only and keeps scatter motifs inside their region', () => {
  const Random = Util.CreateRng(1101);
  const Doc = LocalMap(14, 12);
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    Model.SetTerrain(Doc, nTile, Math.floor(Random() * 17));
  }
  const nRevision = Doc.nRevision, Data = Regions.Build(Doc);
  const First = Embellish.Build(Data);
  assert.deepEqual(Embellish.Build(Regions.Build(Doc)), First);
  assert.equal(Doc.nRevision, nRevision);
  assert.equal(First.length, Data.rgRegions.length);
  First.forEach((Item, nRegion) => {
    const Type = Terrain.ById(Data.rgRegions[nRegion].nTerrainId);
    if (!Type.Embellish) {
      assert.equal(Item, null);
      return;
    }
    assert.equal(Item.szKey, Type.szKey);
    assert.ok(Item.rgInstances.every((Instance) => Instance.nVariant >= 0 && Instance.nVariant < Embellish.g_nVariants));
    if (Type.Embellish.szLayout !== 'scatter') {
      return;
    }
    const rgPolygons = Data.rgCells.filter((Cell) => Cell.nRegion === nRegion).map((Cell) => Polygon(Data, Cell));
    for (const Instance of Item.rgInstances) {
      assert.ok(rgPolygons.some((Cell) => Util.PointInConvex(Instance.rgdPoint, Cell, 1e-9)), `${Type.szKey} motif escapes its region`);
    }
  });
  assert.notDeepEqual(Embellish.PanelSeed('Sx-'), Embellish.PanelSeed('Sx+'));
});

test('scatter lattices continue across tiles: a neighbour joining the terrain does not move motifs', () => {
  const Doc = LocalMap();
  const nTile = Model.LocalTileIndex(Doc, 4, 4), nNeighbor = Model.Neighbors(Doc, nTile)[0];
  const Points = () => {
    const Data = Regions.Build(Doc), Cell = CellOf(Data, nTile), Hex = Polygon(Data, Cell);
    return Embellish.Build(Data)[Cell.nRegion].rgInstances
      .filter((Instance) => Util.PointInConvex(Instance.rgdPoint, Hex, 0)).map((Instance) => [Instance.nVariant, Instance.rgdPoint]);
  };
  Model.SetTerrain(Doc, nTile, Id('hills'));
  const Alone = Points();
  assert.ok(Alone.length >= 4);
  Model.SetTerrain(Doc, nNeighbor, Id('hills'));
  assert.deepEqual(Points(), Alone);
});

test('mountain peaks draw one motif per tile, shrinking only for partial tiles', () => {
  const Doc = LocalMap();
  const rgnPeaks = [10, 30, 31, 70];
  rgnPeaks.forEach((nTile) => Model.SetTerrain(Doc, nTile, Id('mountainPeak')));
  const Data = Regions.Build(Doc);
  const rgInstances = Embellish.Build(Data).filter((Item) => Item && Item.szKey === 'mountainPeak').flatMap((Item) => Item.rgInstances);
  assert.equal(rgInstances.length, rgnPeaks.length);
  for (const nTile of rgnPeaks) {
    const rgdCentre = Util.Center(Polygon(Data, CellOf(Data, nTile)));
    assert.ok(rgInstances.some((Instance) => Util.Distance(Instance.rgdPoint, rgdCentre) < 1e-9 && Instance.dScale === 1));
  }
  const Global = Model.CreateGlobalMap({ nPanelHexes: 4 });
  Global.rgnTerrain.fill(Id('mountainPeak'));
  const GlobalData = Regions.Build(Global, Coordinates.PanelIdByName('Eta'));
  const rgGlobal = Embellish.Build(GlobalData).flatMap((Item) => Item.rgInstances);
  assert.equal(rgGlobal.length, new Set(GlobalData.rgCells.map((Cell) => Cell.nTile)).size);
  assert.ok(rgGlobal.some((Instance) => Instance.dScale === 1));
  assert.ok(rgGlobal.some((Instance) => Instance.dScale < 1 && Instance.dScale >= 0.3));
});

test('forest trunks mark only south-facing internal edges, with crowns kept clear above them', () => {
  const Doc = LocalMap();
  const nTile = Model.LocalTileIndex(Doc, 4, 4);
  Model.SetTerrain(Doc, nTile, Id('forest'));
  let Data = Regions.Build(Doc);
  let Forest = Embellish.Build(Data)[CellOf(Data, nTile).nRegion];
  const rgdCentre = Util.Center(Polygon(Data, CellOf(Data, nTile)));
  assert.ok(Forest.rgrgrgdTrunks.length >= 9);
  for (const [rgdBase, rgdTop] of Forest.rgrgrgdTrunks) {
    assert.ok(rgdBase[1] < rgdCentre[1], 'trunks stand on the southern edges');
    assert.deepEqual(Util.Subtract(rgdTop, rgdBase).map((dValue) => Math.round(dValue * 1e9) / 1e9), [0, Embellish.g_dTrunkHeight]);
    assert.ok(ExposedSouthEdges(Data).some(([A, B]) => SegmentDistance(rgdBase, A, B) < 1e-9));
  }

  const nSouth = Model.Neighbors(Doc, nTile).find((nOther) => {
    const rgdOther = Util.Center(Polygon(Data, CellOf(Data, nOther)));
    return Math.abs(rgdOther[0] - rgdCentre[0]) < 1e-9 && rgdOther[1] < rgdCentre[1];
  });
  Model.SetTerrain(Doc, nSouth, Id('forest'));
  Data = Regions.Build(Doc);
  Forest = Embellish.Build(Data)[CellOf(Data, nTile).nRegion];
  const Shared = Data.rgEdges.find((Edge) => Edge.rgnCells.length === 2
    && Edge.rgnCells.map((nCell) => Data.rgCells[nCell].nTile).sort().join() === [nTile, nSouth].sort().join());
  assert.ok(Forest.rgrgrgdTrunks.every(([rgdBase]) => SegmentDistance(rgdBase, Data.rgrgdPoints[Shared.nA], Data.rgrgdPoints[Shared.nB]) > 1e-6));

  const Whole = LocalMap(6, 5, 'forest'), WholeData = Regions.Build(Whole);
  assert.deepEqual(Embellish.Build(WholeData)[0].rgrgrgdTrunks, [], 'the export border never gets trunks');
});

test('forest crowns respect the clearance band and a fringe row keeps the treeline full', () => {
  const Random = Util.CreateRng(77);
  const Doc = LocalMap(16, 12);
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    Model.SetTerrain(Doc, nTile, Random() < 0.6 ? Id('forest') : Id('plain'));
  }
  const Data = Regions.Build(Doc), Exposed = ExposedSouthEdges(Data), Result = Embellish.Build(Data);
  assert.ok(Exposed.length > 20);
  let nFringe = 0;
  Result.forEach((Item, nRegion) => {
    if (!Item || Item.szKey !== 'forest') {
      return;
    }
    const rgEdges = Exposed.filter(([, , nCell]) => Data.rgCells[nCell].nRegion === nRegion);
    for (const Instance of Item.rgInstances) {
      const dNearest = Math.min(Infinity, ...rgEdges.map(([A, B]) => SegmentDistance(Instance.rgdPoint, A, B)));
      assert.ok(dNearest >= Embellish.g_dCrownClearance - 1e-9);
      nFringe += dNearest < Embellish.g_dCrownClearance + 0.04 ? 1 : 0;
      assert.ok(Data.rgCells.some((Cell) => Cell.nRegion === nRegion && Util.PointInConvex(Instance.rgdPoint, Polygon(Data, Cell), 1e-9)));
    }
  });
  assert.ok(nFringe >= Exposed.length, 'each exposed edge gets at least one fringe crown on average');
});

test('SVG embellishment layer references defined motifs, honours colours-off and scales only by width', () => {
  const Doc = LocalMap(12, 9);
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    Model.SetTerrain(Doc, nTile, nTile % 17);
  }
  const Text = SvgExport.Write(Doc, { nWidth: 900 });
  const nTerrain = Text.indexOf('id="layer-terrain"'), nLayer = Text.indexOf('id="layer-embellishment"');
  assert.ok(nTerrain > 0 && nLayer > nTerrain && Text.indexOf('id="layer-shoreline"') > nLayer);
  const rgszDefined = [...Text.matchAll(/<g id="(emb-[a-zA-Z]+-\d)"/g)].map((Match) => Match[1]);
  const rgszUsed = [...Text.matchAll(/<use href="#(emb-[^"]+)"/g)].map((Match) => Match[1]);
  assert.ok(rgszUsed.length > 100);
  assert.deepEqual([...new Set(rgszUsed)].sort(), [...rgszDefined].sort(), 'only used variants are defined');
  const rgszKeys = new Set([...Text.matchAll(/data-terrain="([a-zA-Z]+)"/g)].map((Match) => Match[1]));
  assert.deepEqual([...rgszKeys].sort(), Terrain.g_rgTerrains.filter((Type) => Type.Embellish).map((Type) => Type.szKey).sort());
  assert.match(Text, /class="trunks"/);
  assert.ok(Text.includes(`fill="${Terrain.ByKey('forest').szColor}"`));
  assert.doesNotMatch(Text, /(?:NaN|Infinity|undefined)/);

  const Plain = SvgExport.Write(Doc, { nWidth: 900, Layers: { terrain: false } });
  assert.ok(!Plain.includes('id="layer-terrain"') && Plain.includes('id="layer-embellishment"'));
  const Defs = Plain.slice(Plain.indexOf('<g id="emb-forest'), Plain.indexOf('</g>', Plain.indexOf('<g id="emb-forest')));
  assert.match(Defs, /fill="#ffffff"/);
  assert.ok(!Defs.includes(Terrain.ByKey('forest').szColor));

  const Wide = SvgExport.Write(Doc, { nWidth: 2400 });
  const Strip = (szText) => szText.replace(/^<svg [^>]*>/m, (szTag) => szTag.replace(/ (?:width|height)="[^"]*"/g, ''));
  assert.equal(Strip(Wide), Strip(Text));
});

test('every local scale and all global panels export embellishments without invalid numbers', () => {
  for (const szScale of Lattice.g_rgszSizes) {
    const Doc = LocalMap(6, 5);
    for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
      Model.SetTerrain(Doc, nTile, (nTile * 7) % 17);
    }
    const Scaled = Model.CreateLocalMap({ nWidth: 6, nHeight: 5, szSystem: 'local', szScale, Anchor: Coordinates.ParseUniversal('Eta 0E 0N') });
    Scaled.rgnTerrain.set(Doc.rgnTerrain);
    const Text = SvgExport.Write(Scaled);
    assert.match(Text, /id="layer-embellishment"/);
    assert.doesNotMatch(Text, /(?:NaN|Infinity|undefined)/);
  }
  const Global = Model.CreateGlobalMap({ nPanelHexes: 8 });
  Global.rgnTerrain.set(View.DemoTerrain(Global.Topo, 5));
  for (const szPanel of Global.Topo.rgszPanels) {
    const Data = Regions.Build(Global, szPanel), Result = Embellish.Build(Data);
    for (const Item of Result.filter((Entry) => Entry && Entry.szKey !== 'farmland')) {
      assert.ok(Item.rgInstances.every((Instance) => Instance.rgdPoint.every(Number.isFinite)));
      assert.ok(Item.rgInstances.every((Instance) => Util.PointInConvex(Instance.rgdPoint, Data.rgrgdOutline, 1e-9)), szPanel);
    }
    assert.doesNotMatch(SvgExport.Write(Global, { szPanel }), /(?:NaN|Infinity|undefined)/);
  }
});
