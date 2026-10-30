'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Lattice, Topology, Coordinates, Terrain, Model, History, Resample, FileFormat } = LoadModules();

const g_dMilesPerEdge = Projection.MilesPerEdge(Topology.g_nDefaultPanelHexes);
const g_nTerrains = Terrain.g_rgTerrains.length;

function LocalMap(szSystem, szScale, nWidth, nHeight, szPanel = 'Hxz+-', dEast = 0, dNorth = 0) {
  return Model.CreateLocalMap({
    nWidth, nHeight, szSystem, szScale, Anchor: Coordinates.MakeLocation(szPanel, dEast, dNorth),
  });
}

function Distance(A, B) {
  return Math.hypot(A.dEast - B.dEast, A.dNorth - B.dNorth);
}

// Index of the source tile whose centre is nearest (hex lattices are Voronoi cells).
function Nearest(Source, Location) {
  let nBest = -1;
  let dBest = Infinity;
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    const dDistance = Distance(Model.TileToUniversal(Source, nTile), Location);
    if (dDistance < dBest) {
      dBest = dDistance;
      nBest = nTile;
    }
  }
  return { nTile: nBest, dDistance: dBest };
}

test('upscaling repeats each original tile across the smaller hexes inside it', () => {
  const Source = LocalMap('regional', 'M', 4, 4);
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    Source.rgnTerrain[nTile] = nTile % g_nTerrains;
  }
  const Target = Resample.Rescale(Source, 'regional', 'S');
  assert.deepEqual([Target.Local.nWidth, Target.Local.nHeight], [24, 24]);
  let nChecked = 0;
  for (let nTile = 0; nTile < Target.nTiles; nTile++) {
    const Hit = Nearest(Source, Model.TileToUniversal(Target, nTile));
    if (Hit.dDistance < 2.9) {
      assert.equal(Target.rgnTerrain[nTile], Source.rgnTerrain[Hit.nTile], `tile ${nTile}`);
      nChecked++;
    }
  }
  assert.ok(nChecked > 400, `${nChecked} tiles checked`);
});

test('downscaling takes the most common terrain of the tiles each larger hex covers', () => {
  const Source = LocalMap('regional', 'S', 24, 18);
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    const [nX, nY] = Model.LocalTileXY(Source, nTile);
    Source.rgnTerrain[nTile] = (nX + 2 * nY) % 7 === 0 ? 6 : nX < 10 ? 2 : 4;
  }
  const Target = Resample.Rescale(Source, 'regional', 'M');
  assert.deepEqual([Target.Local.nWidth, Target.Local.nHeight], [4, 3]);
  // Source centres strictly inside a target hex vote for it; centres on a hex edge may
  // go either way, so only tiles whose winner beats the runner-up by more than their edge
  // count are checked.
  const dInradius = Target.Local.dHexMiles / 2;
  const rgrgdNormals = [[0, 1], [Math.sqrt(3) / 2, 0.5], [Math.sqrt(3) / 2, -0.5]];
  const Reach = (Center, Location) => Math.max(...rgrgdNormals.map(([dX, dY]) =>
    Math.abs((Location.dEast - Center.dEast) * dX + (Location.dNorth - Center.dNorth) * dY)));
  const rgrgnVotes = Array.from({ length: Target.nTiles }, () => new Array(g_nTerrains).fill(0));
  const rgnEdge = new Array(Target.nTiles).fill(0);
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    const Location = Model.TileToUniversal(Source, nTile);
    for (let nTarget = 0; nTarget < Target.nTiles; nTarget++) {
      const dReach = Reach(Model.TileToUniversal(Target, nTarget), Location);
      if (dReach < dInradius - 1e-6) {
        rgrgnVotes[nTarget][Source.rgnTerrain[nTile]]++;
      } else if (dReach < dInradius + 1e-6) {
        rgnEdge[nTarget]++;
      }
    }
  }
  let nChecked = 0;
  rgrgnVotes.forEach((rgnVotes, nTile) => {
    const rgnSorted = [...rgnVotes].sort((nA, nB) => nB - nA);
    if (rgnSorted[0] - rgnSorted[1] > rgnEdge[nTile]) {
      assert.equal(Target.rgnTerrain[nTile], rgnVotes.indexOf(rgnSorted[0]), `tile ${nTile}`);
      nChecked++;
    }
  });
  assert.ok(nChecked >= 6, `${nChecked} tiles checked`);
});

test('global maps rescale between XL and L and back without losing terrain', () => {
  const Global = Model.CreateGlobalMap({ szName: 'World' });
  for (let nTile = 0; nTile < Global.nTiles; nTile++) {
    Global.rgnTerrain[nTile] = (nTile * 7) % g_nTerrains;
  }
  const Fine = Resample.Rescale(Global, 'regional', 'L');
  assert.equal(Fine.szKind, 'global');
  assert.equal(Fine.Global.szTileScale, 'L');
  assert.equal(Fine.szName, 'World');
  const Back = Resample.Rescale(Fine, 'regional', 'XL');
  // Only a few tiny clipped seam pieces hold no finer tile's anchor; they take the
  // terrain under their own anchor instead.
  const rgnChanged = [];
  for (let nTile = 0; nTile < Global.nTiles; nTile++) {
    if (Back.rgnTerrain[nTile] !== Global.rgnTerrain[nTile]) {
      rgnChanged.push(nTile);
    }
  }
  assert.ok(rgnChanged.every((nTile) => Global.Topo.rgTiles[nTile].rgPieces), 'only partial tiles may change');
  assert.ok(rgnChanged.length < Global.nTiles / 200, `${rgnChanged.length} tiles changed`);
  assert.throws(() => Resample.Rescale(Global, 'regional', 'M'), /cannot use/);
  assert.deepEqual(Resample.RescaleOptions(Global), [['regional', 'XL'], ['regional', 'L']]);
});

test('panel maps rescale to M and local maps to any scale', () => {
  const Panel = Model.CreatePanelMap({ szPanel: 'Sx+', szTileScale: 'L' });
  Panel.rgnTerrain.fill(3);
  const Medium = Resample.Rescale(Panel, 'regional', 'M');
  assert.equal(Medium.Global.szPanel, 'Sx+');
  assert.ok(Medium.rgnTerrain.every((nTerrain) => nTerrain === 3));
  const Local = LocalMap('regional', 'S', 3, 2);
  Local.rgnTerrain.fill(5);
  assert.equal(Resample.RescaleOptions(Local).length, 8);
  const Yard = Resample.Rescale(Local, 'local', 'L');
  assert.equal(Yard.Local.szSystem, 'local');
  assert.equal(Yard.Topo, null);
  // Fine hexes along the old hexes' zig-zag edge may fall outside and stay water.
  assert.ok(Yard.rgnTerrain.every((nTerrain) => nTerrain === 5 || nTerrain === Terrain.g_nWaterId));
  assert.ok(Yard.rgnTerrain.filter((nTerrain) => nTerrain === 5).length > 0.8 * Yard.nTiles);
});

test('local rescaling keeps the north-west corner of the map', () => {
  const Source = LocalMap('regional', 'M', 10, 8, 'Hxz+-', 300, 200);
  for (const [szSystem, szScale] of [['regional', 'S'], ['regional', 'L'], ['local', 'XL']]) {
    const Target = Resample.Rescale(Source, szSystem, szScale);
    const dOld = Source.Local.dHexMiles;
    const dNew = Target.Local.dHexMiles;
    const OldCorner = [Source.Local.Anchor.dEast - dOld / Math.sqrt(3), Source.Local.Anchor.dNorth + dOld / 2];
    const NewCorner = [Target.Local.Anchor.dEast - dNew / Math.sqrt(3), Target.Local.Anchor.dNorth + dNew / 2];
    // Regional anchors snap to the lattice of the new scale.
    assert.ok(Math.hypot(OldCorner[0] - NewCorner[0], OldCorner[1] - NewCorner[1]) <= dNew, `${szSystem} ${szScale}`);
  }
});

test('features follow their tiles; overlays are bridged, split at the map edge, and labels keep their ground size', () => {
  const Source = LocalMap('regional', 'M', 6, 4);
  const Index = (nX, nY) => Model.LocalTileIndex(Source, nX, nY);
  Model.SetLandmark(Source, Index(1, 1), { szType: 'town', szName: 'Ford' });
  Model.AddLabel(Source, { nTile: Index(2, 2), szText: 'Vale', szCategory: 'region', dSize: 24, dDx: 6, dDy: -3 });
  Model.AddOverlay(Source, { szType: 'road', szId: 'road1', rgnTiles: [Index(0, 1), Index(1, 1), Index(2, 1), Index(3, 1), Index(4, 1), Index(5, 1)] });

  const Fine = Resample.Rescale(Source, 'regional', 'S');
  assert.equal(Fine.Landmarks.size, 1);
  const [[nLandmarkTile, Landmark]] = [...Fine.Landmarks];
  assert.equal(Landmark.szName, 'Ford');
  assert.ok(Distance(Model.TileToUniversal(Fine, nLandmarkTile), Model.TileToUniversal(Source, Index(1, 1))) < 1e-6);
  const [Label] = Fine.rgLabels;
  assert.deepEqual([Label.szText, Label.dSize, Label.dDx, Label.dDy], ['Vale', 144, 36, -18]);
  assert.equal(Fine.rgOverlays.length, 1);
  const Road = Fine.rgOverlays[0];
  for (let nIndex = 1; nIndex < Road.rgnTiles.length; nIndex++) {
    assert.ok(Model.AreAdjacent(Fine, Road.rgnTiles[nIndex - 1], Road.rgnTiles[nIndex]));
  }
  assert.ok(Road.rgnTiles.length > 25, 'the upscaled road is bridged tile by tile');
  assert.equal(Fine.nRevision, 0);
  assert.equal(FileFormat.Write(FileFormat.Parse(FileFormat.Write(Fine))), FileFormat.Write(Fine));

  // A crop through the middle of the road keeps the part inside; a road leaving and
  // re-entering the crop becomes two overlays with unique ids.
  Model.AddOverlay(Source, { szType: 'river', szId: 'river1', rgnTiles: [Index(0, 2), Index(0, 1), Index(0, 0), Index(1, 0), Index(2, 0), Index(2, 1), Index(2, 2)] });
  const Corner = Model.TileToUniversal(Source, Index(0, 1));
  const Crop = Resample.Crop(Source, { nWidth: 3, nHeight: 2, szSystem: 'regional', szScale: 'M', Anchor: Corner });
  assert.deepEqual(Crop.rgOverlays.map((Overlay) => Overlay.szId), ['road1', 'river1', 'river1_2']);
  assert.equal(Crop.rgOverlays[0].rgnTiles.length, 3);
});

test('cropping a global map into a seam-crossing local map copies each panel\'s tiles', () => {
  const Global = Model.CreateGlobalMap({ szTileScale: 'L' });
  for (let nTile = 0; nTile < Global.nTiles; nTile++) {
    Global.rgnTerrain[nTile] = Global.Topo.rgTiles[nTile].szPanel === 'Hxy++' ? 7 : 2;
  }
  const Crop = Resample.Crop(Global, {
    szName: 'Strait', nWidth: 30, nHeight: 10, szSystem: 'regional', szScale: 'L',
    Anchor: Coordinates.MakeLocation('Hyz+-', 0.6 * g_dMilesPerEdge, 0.2 * g_dMilesPerEdge),
  });
  assert.equal(Crop.szName, 'Strait');
  assert.ok(Crop.Topo && Crop.Topo.Span);
  for (const Tile of Crop.Topo.rgTiles) {
    assert.equal(Crop.rgnTerrain[Tile.nIndex], Tile.szPanel === 'Hxy++' ? 7 : 2);
    const nGlobal = Coordinates.UniversalToTile(Global.Topo, Model.TileToUniversal(Crop, Tile.nIndex));
    assert.ok(nGlobal >= 0, 'crop tiles coincide with global tiles of the same scale');
  }
  assert.equal(Crop.Local.nPanelHexes, Global.Global.nPanelHexes);
});

test('whole-panel crops export the entire panel at the original, finer or coarser scale', () => {
  const Source = Model.CreateGlobalMap({ nPanelHexes: 2, szTileScale: 'L', szName: 'World' });
  Source.rgnTerrain.fill(3);
  const nFeature = Resample.TileAtPoint(Source, 'Hxz+-', [0, 0]);
  Model.SetLandmark(Source, nFeature, { szType: 'town', szName: 'Centre' });
  Model.AddLabel(Source, { nTile: nFeature, szCategory: 'region', szText: 'Coast' });
  Model.AddOverlay(Source, { szType: 'trail', rgnTiles: [nFeature] });
  const szBefore = FileFormat.Write(Source);
  for (const szScale of ['XL', 'L', 'M']) {
    const Crop = Resample.Crop(Source, { szKind: 'panel', szPanel: 'Hxz+-', szScale, szName: 'Panel crop' });
    assert.equal(Crop.szKind, 'panel');
    assert.equal(Crop.szName, 'Panel crop');
    assert.deepEqual(Crop.Global, { nPanelHexes: 2, szTileScale: szScale, szPanel: 'Hxz+-' });
    assert.ok(Crop.rgnTerrain.every((nTerrain) => nTerrain === 3));
    assert.equal(Crop.Landmarks.size, 1);
    assert.equal(Crop.rgLabels.length, 1);
    assert.equal(Crop.rgOverlays.length, 1, 'single-tile paths survive the panel crop');
    assert.equal(Crop.nRevision, 0);
    assert.equal(FileFormat.Write(FileFormat.Parse(FileFormat.Write(Crop))), FileFormat.Write(Crop));
  }
  assert.equal(FileFormat.Write(Source), szBefore);
  assert.throws(() => Resample.Crop(Source, { szKind: 'panel', szPanel: 'Hxz+-', szScale: 'S' }), /scale/i);
});

test('same-scale merges replace land and water only inside the imported rectangle', () => {
  const Target = LocalMap('regional', 'S', 6, 5);
  Target.rgnTerrain.fill(6);
  const Anchor = Model.TileToUniversal(Target, Model.LocalTileIndex(Target, 2, 1));
  const Source = Model.CreateLocalMap({ nWidth: 2, nHeight: 2, szSystem: 'regional', szScale: 'S', Anchor });
  Source.rgnTerrain.set([0, 2, 4, 0]);
  const szSource = FileFormat.Write(Source);
  const Geometry = Target.Local;
  const Result = Resample.Merge(Source, Target);
  assert.equal(Result.nCovered, 4);
  assert.equal(Target.Local, Geometry);
  for (let nTile = 0; nTile < Target.nTiles; nTile++) {
    const [nX, nY] = Model.LocalTileXY(Target, nTile);
    const nExpected = nX >= 2 && nX < 4 && nY >= 1 && nY < 3 ? Source.rgnTerrain[(nY - 1) * 2 + nX - 2] : 6;
    assert.equal(Target.rgnTerrain[nTile], nExpected, `tile ${nTile}`);
  }
  assert.equal(FileFormat.Write(Source), szSource);
});

test('outside imports leave local and isolated panel maps completely unchanged', () => {
  const Local = LocalMap('regional', 'S', 3, 3);
  const FarAway = LocalMap('regional', 'S', 3, 3, 'Hxz+-', 1000, 1000);
  const Panel = Model.CreatePanelMap({ nPanelHexes: 2, szPanel: 'Sx+', szTileScale: 'L' });
  const OtherPanel = Model.CreatePanelMap({ nPanelHexes: 2, szPanel: 'Sx-', szTileScale: 'L' });
  for (const [Target, Source] of [[Local, FarAway], [Panel, OtherPanel]]) {
    Target.rgnTerrain.fill(5);
    Source.rgnTerrain.fill(7);
    Model.SetLandmark(Target, 0, { szType: 'village', szName: 'Keep' });
    Model.AddLabel(Target, { nTile: 0, szCategory: 'region', szText: 'Keep' });
    const szBefore = FileFormat.Write(Target);
    const nRevision = Target.nRevision;
    const H = History.Create(Target);
    const Command = History.Perform(H, 'Import', (Doc, Record) => {
      assert.equal(Resample.Merge(Source, Doc, Record).nCovered, 0);
    });
    assert.equal(Command, null);
    assert.equal(Target.nRevision, nRevision);
    assert.equal(FileFormat.Write(Target), szBefore);
  }
});

test('merge rejects incompatible hex systems or world sizes without changing the map', () => {
  const Regional = LocalMap('regional', 'S', 2, 2);
  const Yard = LocalMap('local', 'M', 2, 2);
  for (const [Source, Target] of [[Regional, Yard], [Yard, Regional],
    [Yard, Model.CreateGlobalMap({ nPanelHexes: 2 })]]) {
    const szBefore = FileFormat.Write(Target);
    const nRevision = Target.nRevision;
    assert.throws(() => Resample.Merge(Source, Target), /Cannot merge local.*regional/);
    assert.equal(FileFormat.Write(Target), szBefore);
    assert.equal(Target.nRevision, nRevision);
  }
  assert.throws(() => Resample.Merge(Model.CreateGlobalMap({ nPanelHexes: 2 }), Regional), /same panel size/);
});

test('coarser imports repeat terrain into finer yard-scale hexes without clearing outside tiles', () => {
  const Target = LocalMap('local', 'S', 24, 24, 'Hxz+-', -0.003, 0.003);
  Target.rgnTerrain.fill(6);
  const Source = LocalMap('local', 'M', 1, 1);
  Source.rgnTerrain.fill(2);
  const Result = Resample.Merge(Source, Target);
  assert.ok(Result.nCovered > 50 && Result.nCovered < Target.nTiles);
  const Covered = new Set(Result.rgnTiles);
  for (let nTile = 0; nTile < Target.nTiles; nTile++) {
    assert.equal(Target.rgnTerrain[nTile], Covered.has(nTile) ? 2 : 6);
  }
});

test('finer imports use majority votes, including coarse tiles whose centres are outside the source', () => {
  const Target = LocalMap('regional', 'M', 6, 6);
  Target.rgnTerrain.fill(6);
  const Anchor = Model.TileToUniversal(Target, Model.LocalTileIndex(Target, 2, 2));
  const Source = Model.CreateLocalMap({ nWidth: 9, nHeight: 9, szSystem: 'regional', szScale: 'S', Anchor });
  Source.rgnTerrain.fill(4);
  Source.rgnTerrain[0] = 2;
  const Votes = new Map();
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    const Point = Resample.TilePoint(Source, nTile);
    const nTarget = Resample.TileAtPoint(Target, Point.szPanel, Point.rgdPoint);
    assert.ok(nTarget >= 0);
    if (!Votes.has(nTarget)) {
      Votes.set(nTarget, new Array(g_nTerrains).fill(0));
    }
    Votes.get(nTarget)[Source.rgnTerrain[nTile]]++;
  }
  const Result = Resample.Merge(Source, Target);
  assert.equal(Result.nCovered, Votes.size);
  let nOffCentre = 0;
  for (const nTile of Result.rgnTiles) {
    const rgnVotes = Votes.get(nTile);
    assert.equal(Target.rgnTerrain[nTile], rgnVotes.indexOf(Math.max(...rgnVotes)));
    const Point = Resample.TilePoint(Target, nTile);
    if (Resample.TileAtPoint(Source, Point.szPanel, Point.rgdPoint) < 0) {
      nOffCentre++;
    }
  }
  assert.ok(nOffCentre > 0, 'partial coverage still replaces a coarse tile');
  for (let nTile = 0; nTile < Target.nTiles; nTile++) {
    if (!Votes.has(nTile)) {
      assert.equal(Target.rgnTerrain[nTile], 6);
    }
  }
});

test('regional rectangles merge into globes, and globe imports clip to a panel or rectangle', () => {
  const Global = Model.CreateGlobalMap();
  Global.rgnTerrain.fill(6);
  const Source = LocalMap('regional', 'XL', 1, 1);
  Source.rgnTerrain.fill(3);
  const Result = Resample.Merge(Source, Global);
  assert.equal(Result.nCovered, 1);
  assert.equal(Global.rgnTerrain[Result.rgnTiles[0]], 3);
  assert.equal(Global.rgnTerrain.filter((nTerrain) => nTerrain === 6).length, Global.nTiles - 1);
  Global.rgnTerrain.fill(5);
  const Panel = Model.CreatePanelMap({ szPanel: 'Hxz+-', szTileScale: 'L' });
  const Rectangle = LocalMap('regional', 'S', 5, 5);
  for (const Target of [Panel, Rectangle]) {
    const nTiles = Target.nTiles;
    const Topo = Target.Topo;
    const Local = Target.Local;
    const Merged = Resample.Merge(Global, Target);
    assert.equal(Merged.nCovered, nTiles);
    assert.ok(Target.rgnTerrain.every((nTerrain) => nTerrain === 5));
    assert.equal(Target.nTiles, nTiles);
    assert.equal(Target.Topo, Topo);
    assert.equal(Target.Local, Local);
  }
});

test('panel imports replace their clipped boundary hexes on the globe, including features in a clipped tip', () => {
  const Source = Model.CreatePanelMap({ nPanelHexes: 2, szPanel: 'Hyz+-', szTileScale: 'L' });
  const Target = Model.CreateGlobalMap({ nPanelHexes: 2, szTileScale: 'L' });
  Source.rgnTerrain.fill(3);
  Target.rgnTerrain.fill(6);
  const Covered = new Set();
  let nBoundarySource = -1;
  let nBoundaryTarget = -1;
  for (let nTile = 0; nTile < Source.nTiles; nTile++) {
    const Point = Resample.TilePoint(Source, nTile);
    const nTarget = Resample.TileAtPoint(Target, Point.szPanel, Point.rgdPoint);
    assert.ok(nTarget >= 0);
    Covered.add(nTarget);
    const Center = Resample.TilePoint(Target, nTarget);
    if (Resample.TileAtPoint(Source, Center.szPanel, Center.rgdPoint) < 0) {
      nBoundarySource = nTile;
      nBoundaryTarget = nTarget;
    }
  }
  assert.ok(nBoundarySource >= 0, 'isolated panels include tips owned by neighbouring globe tiles');
  Model.SetLandmark(Source, nBoundarySource, { szType: 'village', szName: 'Edge' });
  Model.AddLabel(Source, { nTile: nBoundarySource, szCategory: 'region', szText: 'Edge' });
  Model.AddOverlay(Source, { szType: 'trail', rgnTiles: [nBoundarySource] });
  assert.equal(Resample.Merge(Source, Target).nCovered, Covered.size);
  for (let nTile = 0; nTile < Target.nTiles; nTile++) {
    assert.equal(Target.rgnTerrain[nTile], Covered.has(nTile) ? 3 : 6);
  }
  assert.equal(Model.GetLandmark(Target, nBoundaryTarget).szName, 'Edge');
  assert.equal(Target.rgLabels[0].nTile, nBoundaryTarget);
  assert.deepEqual(Target.rgOverlays[0].rgnTiles, [nBoundaryTarget]);
});

test('resampling never treats the clipped-away part of a boundary hex as map coverage', () => {
  const Panel = Model.CreatePanelMap({ nPanelHexes: 2, szPanel: 'Sx+', szTileScale: 'L' });
  let nChecked = 0;
  for (const Tile of Panel.Topo.rgTiles.filter((Tile) => Tile.fPartial)) {
    const Polygons = Topology.TilePolygons(Panel.Topo, Tile.nIndex);
    for (const Vertex of Lattice.HexPolygon(Tile.rgdCenter, Panel.Topo.dD)) {
      const Point = Vertex.map((dValue, nAxis) => 0.9 * dValue + 0.1 * Tile.rgdCenter[nAxis]);
      if (!Polygons.some((Polygon) => Util.PointInConvex(Point, Polygon))) {
        assert.equal(Resample.TileAtPoint(Panel, Tile.szPanel, Point), -1);
        nChecked++;
      }
    }
  }
  assert.ok(nChecked > 0);
});

test('merges follow panel grids on seam-crossing rectangular maps', () => {
  const Global = Model.CreateGlobalMap({ szTileScale: 'L' });
  Global.rgnTerrain.fill(7);
  const Span = Model.CreateLocalMap({
    nWidth: 30, nHeight: 10, szSystem: 'regional', szScale: 'L',
    Anchor: Coordinates.MakeLocation('Hyz+-', 0.6 * g_dMilesPerEdge, 0.2 * g_dMilesPerEdge),
  });
  assert.ok(Span.Topo && Span.Topo.Span);
  assert.equal(Resample.Merge(Global, Span).nCovered, Span.nTiles);
  assert.ok(Span.rgnTerrain.every((nTerrain) => nTerrain === 7));
  const nCovered = Resample.Merge(Span, Global).nCovered;
  assert.ok(nCovered > 0 && nCovered < Global.nTiles);
});

test('merge replaces covered features, splits crossing paths, resolves ids and is one undo step', () => {
  const Target = LocalMap('regional', 'S', 7, 3);
  Target.rgnTerrain.fill(6);
  const Index = (nX, nY) => Model.LocalTileIndex(Target, nX, nY);
  const Source = Model.CreateLocalMap({
    nWidth: 3, nHeight: 1, szSystem: 'regional', szScale: 'S', Anchor: Model.TileToUniversal(Target, Index(2, 1)),
  });
  Source.rgnTerrain.set([0, 3, 4]);
  Model.SetLandmark(Target, Index(0, 0), { szType: 'town', szName: 'Outside' });
  Model.SetLandmark(Target, Index(2, 1), { szType: 'town', szName: 'Erase' });
  Model.SetLandmark(Target, Index(3, 1), { szType: 'town', szName: 'Replace' });
  Model.SetLandmark(Source, 1, { szType: 'village', szName: 'Imported' });
  Model.AddLabel(Target, { szId: 'label1', nTile: Index(0, 0), szCategory: 'region', szText: 'Outside' });
  Model.AddLabel(Target, { szId: 'erase', nTile: Index(2, 1), szCategory: 'region', szText: 'Erase' });
  Model.AddLabel(Source, { szId: 'label1', nTile: 0, szCategory: 'region', szText: 'Imported' });
  Model.AddOverlay(Target, { szType: 'road', szId: 'road1', szName: 'Crossing', rgnTiles: [0, 1, 2, 3, 4, 5, 6].map((nX) => Index(nX, 1)) });
  Model.AddOverlay(Target, { szType: 'trail', szId: 'road1_2', szName: 'Outside', rgnTiles: [Index(0, 0), Index(1, 0)] });
  Model.AddOverlay(Target, { szType: 'river', szId: 'river1', szName: 'Ends', rgnTiles: [1, 2, 3, 4, 5].map((nX) => Index(nX, 1)) });
  Model.AddOverlay(Source, { szType: 'road', szId: 'road1', szName: 'Imported', rgnTiles: [0, 1, 2] });
  const szBefore = FileFormat.Write(Target);
  const szSource = FileFormat.Write(Source);
  const H = History.Create(Target);
  History.Perform(H, 'Import', (Doc, Record) => assert.equal(Resample.Merge(Source, Doc, Record).nCovered, 3));
  assert.equal(H.rgUndo.length, 1);
  assert.equal(Target.Landmarks.size, 2);
  assert.equal(Model.GetLandmark(Target, Index(0, 0)).szName, 'Outside');
  assert.equal(Model.GetLandmark(Target, Index(2, 1)), null);
  assert.equal(Model.GetLandmark(Target, Index(3, 1)).szName, 'Imported');
  assert.deepEqual(Target.rgLabels.map((Label) => [Label.szId, Label.szText]), [['label1', 'Outside'], ['label1_2', 'Imported']]);
  assert.deepEqual(Target.rgOverlays.filter((Overlay) => Overlay.szName === 'Crossing').map((Overlay) => Overlay.rgnTiles),
    [[Index(0, 1), Index(1, 1)], [Index(5, 1), Index(6, 1)]]);
  assert.deepEqual(Target.rgOverlays.filter((Overlay) => Overlay.szName === 'Ends').map((Overlay) => Overlay.rgnTiles),
    [[Index(1, 1)], [Index(5, 1)]]);
  assert.equal(new Set(Target.rgOverlays.map((Overlay) => Overlay.szId)).size, Target.rgOverlays.length);
  assert.deepEqual(Target.rgOverlays.find((Overlay) => Overlay.szName === 'Imported').rgnTiles, [Index(2, 1), Index(3, 1), Index(4, 1)]);
  const szAfter = FileFormat.Write(Target);
  assert.equal(FileFormat.Write(FileFormat.Parse(szAfter)), szAfter);
  History.Undo(H);
  assert.equal(FileFormat.Write(Target), szBefore);
  History.Redo(H);
  assert.equal(FileFormat.Write(Target), szAfter);
  assert.equal(FileFormat.Write(Source), szSource);
});

test('incoming paths and features clip to the target, including isolated path points', () => {
  const Source = LocalMap('regional', 'S', 7, 3);
  Source.rgnTerrain.fill(5);
  const Index = (nX, nY) => Model.LocalTileIndex(Source, nX, nY);
  Model.AddOverlay(Source, { szType: 'road', rgnTiles: [0, 1, 2, 3, 4, 5, 6].map((nX) => Index(nX, 1)) });
  Model.AddOverlay(Source, { szType: 'trail', rgnTiles: [Index(2, 1)] });
  Model.SetLandmark(Source, Index(0, 0), { szType: 'town', szName: 'Outside' });
  Model.AddLabel(Source, { nTile: Index(6, 2), szCategory: 'region', szText: 'Outside' });
  const Target = Model.CreateLocalMap({
    nWidth: 3, nHeight: 1, szSystem: 'regional', szScale: 'S', Anchor: Model.TileToUniversal(Source, Index(2, 1)),
  });
  assert.equal(Resample.Merge(Source, Target).nCovered, 3);
  assert.equal(Target.nTiles, 3);
  assert.ok(Target.rgnTerrain.every((nTerrain) => nTerrain === 5));
  assert.equal(Target.Landmarks.size, 0);
  assert.equal(Target.rgLabels.length, 0);
  assert.deepEqual(Target.rgOverlays.map((Overlay) => Overlay.rgnTiles), [[0, 1, 2], [0]]);
});

test('merge resamples features while preserving label ground sizes and map metadata', () => {
  const Source = LocalMap('regional', 'M', 2, 2);
  Source.rgnTerrain.fill(4);
  Model.AddLabel(Source, { nTile: 0, szText: 'Vale', szCategory: 'region', dSize: 24, dDx: 6, dDy: -3 });
  Model.AddOverlay(Source, { szType: 'road', rgnTiles: [0, 1] });
  const Target = LocalMap('regional', 'S', 30, 30, 'Hxz+-', -12, 12);
  Target.szName = 'Keep name';
  const Local = Target.Local;
  const Result = Resample.Merge(Source, Target);
  assert.ok(Result.nCovered > 20 && Result.nCovered < Target.nTiles);
  assert.equal(Target.Local, Local);
  assert.equal(Target.szName, 'Keep name');
  assert.deepEqual(Target.rgLabels.map((Label) => [Label.dSize, Label.dDx, Label.dDy]), [[144, 36, -18]]);
  assert.ok(Target.rgOverlays[0].rgnTiles.length > 5);
  for (const Overlay of Target.rgOverlays) {
    for (let nIndex = 1; nIndex < Overlay.rgnTiles.length; nIndex++) {
      assert.ok(Model.AreAdjacent(Target, Overlay.rgnTiles[nIndex - 1], Overlay.rgnTiles[nIndex]));
    }
  }
});
