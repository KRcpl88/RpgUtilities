#!/usr/bin/env node
'use strict';
// Regenerates the sample maps in map-editor/samples/ from the editor's own modules.
// Output is canonical .map.txt and fully deterministic.
//
//   node tools/make_sample_maps.cjs           write the samples
//   node tools/make_sample_maps.cjs --check   verify the committed samples are current

const fs = require('node:fs');
const path = require('node:path');
const { LoadModules, g_szRepositoryRoot } = require('../tests/_load.cjs');

const RpgMap = LoadModules();
const { Util, Lattice, Coordinates, Terrain, Model, View, Edit, FileFormat } = RpgMap;
const g_szSampleDir = path.join(g_szRepositoryRoot, 'map-editor', 'samples');

function TerrainId(szKey) {
  return Terrain.ByKey(szKey).nId;
}

// Joins shortest tile paths through each waypoint into one adjacent tile path.
function RoutedPath(Doc, rgnWaypoints) {
  const rgnTiles = [rgnWaypoints[0]];
  for (let nIndex = 1; nIndex < rgnWaypoints.length; nIndex++) {
    rgnTiles.push(...Edit.FindPath(Doc, rgnTiles[rgnTiles.length - 1], rgnWaypoints[nIndex]).slice(1));
  }
  return rgnTiles;
}

// The global tile whose centre is nearest a frame point of the named panel.
function GlobalTile(Doc, szPanelName, dEast, dNorth) {
  const szPanel = Coordinates.PanelIdByName(szPanelName);
  const Info = Doc.Topo.Panels[szPanel];
  let nBest = -1;
  let dBest = Infinity;
  for (let nTile = Info.nFirstTile; nTile < Info.nFirstTile + Info.nTileCount; nTile++) {
    const dDistance = Util.Distance(Doc.Topo.rgTiles[nTile].rgdCenter, [dEast, dNorth]);
    if (dDistance < dBest) {
      dBest = dDistance;
      nBest = nTile;
    }
  }
  return nBest;
}

function MakeWorld() {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 8, szTileScale: 'XL', szName: 'Sample World' });
  View.DemoTerrain(Doc.Topo, 7).forEach((nId, nTile) => Model.SetTerrain(Doc, nTile, nId));
  const Tile = (szPanel, dEast, dNorth, szTerrain) => {
    const nTile = GlobalTile(Doc, szPanel, dEast, dNorth);
    if (szTerrain) {
      Model.SetTerrain(Doc, nTile, TerrainId(szTerrain));
    }
    return nTile;
  };
  const Capital = Tile('Eta', 0.05, -0.1, 'plain');
  const Harbour = Tile('Alpha', 0.1, 0.25, 'plain');
  const Pass = Tile('Theta', 0.2, -0.15, 'hills');
  const Oasis = Tile('Beta', -0.1, 0.1, 'desert');
  const Spring = Tile('Theta', -0.25, 0.2, 'mountains');
  const Mouth = Tile('Zeta', 0.3, -0.2, 'firth');
  // Roads, rivers and trails cross both kinds of seam: polar–equatorial and the equatorial strip.
  Model.AddOverlay(Doc, { szType: 'road', szName: 'Imperial Way', rgnTiles: RoutedPath(Doc, [Capital, Harbour, Oasis]) });
  Model.AddOverlay(Doc, { szType: 'road', szName: 'North Road', szStyle: 'paved', rgnTiles: RoutedPath(Doc, [Capital, Pass]) });
  Model.AddOverlay(Doc, { szType: 'river', szName: 'Long River', rgnTiles: RoutedPath(Doc, [Spring, Pass, Capital, Mouth]) });
  Model.AddOverlay(Doc, { szType: 'trail', szName: 'Pilgrim Trail', rgnTiles: RoutedPath(Doc, [Oasis, Tile('Gamma', 0, 0)]) });
  Model.SetLandmark(Doc, Capital, { szType: 'city', szName: 'Aurelia', szNotes: 'Imperial capital on the prime meridian' });
  Model.SetLandmark(Doc, Harbour, { szType: 'town', szName: 'Saltmere' });
  Model.SetLandmark(Doc, Pass, { szType: 'fortress', szName: 'Gatehold' });
  Model.SetLandmark(Doc, Oasis, { szType: 'temple', szName: 'Shrine of Sands' });
  Model.SetLandmark(Doc, Tile('Iota', 0, 0, 'tundra'), { szType: 'ruins', szName: 'Frostspire' });
  Model.SetLandmark(Doc, Tile('Lambda', 0, 0, 'mountains'), { szType: 'dungeon', szName: 'Deepdelve' });
  for (const [szPanel, szText] of [['Eta', 'The Old Empire'], ['Delta', 'Sunward Isles'], ['Kappa', 'Southern Wastes'], ['Omicron', 'Frost March']]) {
    Model.AddLabel(Doc, { nTile: Tile(szPanel, 0, 0.15), szText, szCategory: 'region' });
  }
  Model.AddLabel(Doc, { nTile: Capital, szText: 'Aurelia', szCategory: 'city', dDy: 18 });
  Model.AddLabel(Doc, { nTile: Spring, szText: 'Long River', szCategory: 'location', dRotation: 20 });
  return Doc;
}

// A hand-placed local valley that uses every terrain, landmark type and label category.
function MakeValley() {
  const nWidth = 36;
  const nHeight = 26;
  const Doc = Model.CreateLocalMap({
    nWidth, nHeight, szSystem: 'regional', szScale: 'M', szName: 'Sample Valley',
    Anchor: Coordinates.ParseUniversal('Eta 120W 340N'),
  });
  const Point = (nX, nY) => Coordinates.LocalTilePoint(Doc.Local, nX, nY);
  const At = (nX, nY) => Model.LocalTileIndex(Doc, nX, nY);
  // Blobs painted in order: [terrain, x, y, radius in hexes]. Edges are roughened by hash.
  const rgBlobs = [
    ['plain', 18, 13, 40],
    ['water', -4, 13, 9.5], ['water', 2, 24, 5],
    ['islands', 2, 8, 1.6], ['islands', 1, 16, 1.2],
    ['firth', 7, 13, 1.3], ['firth', 9, 13, 1.1],
    ['mangrove', 7, 20, 2.2], ['marsh', 11, 17, 2.4],
    ['farmland', 15, 10, 3.2], ['farmland', 19, 15, 2.2],
    ['forest', 13, 3, 4.2], ['forest', 24, 9, 2.6],
    ['tundra', 31, 2, 4.2],
    ['hills', 25, 4, 3.2], ['mountains', 28, 6, 2.6], ['mountainPeak', 28, 6, 0.8], ['mountainPeak', 30, 4, 0.6],
    ['lakes', 20, 6, 1.2],
    ['desert', 30, 19, 4.5], ['sandDunes', 32, 22, 2.2], ['badlands', 24, 22, 2.8], ['canyon', 26, 18, 1.4], ['canyon', 27, 19, 1],
  ];
  for (let nY = 0; nY < nHeight; nY++) {
    for (let nX = 0; nX < nWidth; nX++) {
      const rgdHere = Point(nX, nY);
      for (const [szTerrain, nCX, nCY, dRadius] of rgBlobs) {
        const rgdCentre = Point(nCX, nCY);
        const dNoise = (Util.HashIntegers(nX, nY, TerrainId(szTerrain)) / 4294967296 - 0.5) * Math.min(1.2, dRadius * 0.5);
        if (Util.Distance(rgdHere, rgdCentre) <= dRadius + dNoise) {
          Model.SetTerrain(Doc, At(nX, nY), TerrainId(szTerrain));
        }
      }
    }
  }
  const Places = {
    city: [17, 13, 'Riverford'], town: [14, 8, 'Millbrook'], village: [21, 17, 'Ashby'],
    castle: [19, 11, 'Highwatch'], fortress: [26, 9, 'Ironpass Keep'], tower: [10, 20, 'Fen Tower'],
    ruins: [31, 20, 'Sunken Court'], mine: [27, 4, 'Deep Seam'], temple: [11, 4, 'Grove Shrine'],
    cave: [25, 19, 'Echo Cave'], dungeon: [32, 3, 'Ice Vault'],
  };
  for (const [szType, [nX, nY, szName]] of Object.entries(Places)) {
    Model.SetLandmark(Doc, At(nX, nY), { szType, szName });
  }
  const Tile = (szType) => At(Places[szType][0], Places[szType][1]);
  Model.AddOverlay(Doc, { szType: 'road', szName: 'Kings Road', rgnTiles: RoutedPath(Doc, [Tile('town'), Tile('city'), Tile('village'), At(35, 17)]) });
  Model.AddOverlay(Doc, { szType: 'road', szName: 'Pass Road', szStyle: 'paved', rgnTiles: RoutedPath(Doc, [Tile('castle'), Tile('fortress')]) });
  Model.AddOverlay(Doc, { szType: 'trail', szName: 'Miners Path', rgnTiles: RoutedPath(Doc, [Tile('fortress'), Tile('mine'), Tile('dungeon')]) });
  Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: RoutedPath(Doc, [Tile('village'), Tile('cave'), Tile('ruins')]) });
  Model.AddOverlay(Doc, { szType: 'river', szName: 'Silverrun', rgnTiles: RoutedPath(Doc, [At(26, 6), At(20, 6), At(18, 12), At(9, 13)]) });
  Model.AddOverlay(Doc, { szType: 'river', szName: 'Fenwater', rgnTiles: RoutedPath(Doc, [At(13, 17), At(8, 19)]) });
  Model.AddLabel(Doc, { nTile: At(4, 13), szText: 'Grey Sea', szCategory: 'region', dRotation: -80 });
  Model.AddLabel(Doc, { nTile: At(30, 21), szText: 'Ember Waste', szCategory: 'region' });
  Model.AddLabel(Doc, { nTile: At(13, 3), szText: 'Old Wood', szCategory: 'location' });
  Model.AddLabel(Doc, { nTile: At(17, 13), szText: 'Riverford', szCategory: 'city', dDy: 22 });
  Model.AddLabel(Doc, { nTile: At(24, 15), szText: 'Kings Road', szCategory: 'location', dRotation: 15 });
  Model.AddLabel(Doc, { nTile: At(29, 5), szText: 'Miners Path', szCategory: 'location', dRotation: -30 });
  Model.AddLabel(Doc, { nTile: At(22, 8), szText: 'Silverrun', szCategory: 'location', dRotation: 25, dDy: -10 });
  return Doc;
}

const g_Samples = [
  ['sample-world.map.txt', MakeWorld],
  ['sample-valley.map.txt', MakeValley],
];

function Main(rgszArgs) {
  const fCheck = rgszArgs.includes('--check');
  let fStale = false;
  for (const [szFile, fnMake] of g_Samples) {
    const szText = FileFormat.Write(fnMake());
    const szPath = path.join(g_szSampleDir, szFile);
    if (fCheck) {
      const fCurrent = fs.existsSync(szPath) && fs.readFileSync(szPath, 'utf8') === szText;
      console.log(`${fCurrent ? 'ok' : 'STALE'} ${path.relative(g_szRepositoryRoot, szPath)}`);
      fStale = fStale || !fCurrent;
    } else {
      fs.mkdirSync(g_szSampleDir, { recursive: true });
      fs.writeFileSync(szPath, szText);
      console.log(`wrote ${path.relative(g_szRepositoryRoot, szPath)} (${szText.length} bytes)`);
    }
  }
  return fStale ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = Main(process.argv.slice(2));
}

module.exports = { g_Samples, MakeWorld, MakeValley, Main };
