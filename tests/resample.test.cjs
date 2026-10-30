'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Projection, Topology, Coordinates, Terrain, Model, Resample, FileFormat } = LoadModules();

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
