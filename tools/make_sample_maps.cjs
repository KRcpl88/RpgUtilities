#!/usr/bin/env node
'use strict';
// Regenerates the sample maps in map-editor/samples/ from the editor's own modules.
// Output is canonical .map.txt and fully deterministic.
//
//   node tools/make_sample_maps.cjs           write the samples
//   node tools/make_sample_maps.cjs --check   verify the committed samples are current

const fs = require('node:fs');
const path = require('node:path');
const { loadModules, REPOSITORY_ROOT } = require('../tests/_load.cjs');

const rpgMap = loadModules();
const { Util: util, Lattice: lattice, Coordinates: coordinates, Terrain: terrain, Model: model, View: view, Edit: edit, FileFormat: fileFormat } = rpgMap;
const SAMPLE_DIR = path.join(REPOSITORY_ROOT, 'map-editor', 'samples');

function terrainId(key) {
  return terrain.byKey(key).id;
}

// Joins shortest tile paths through each waypoint into one adjacent tile path.
function routedPath(doc, waypoints) {
  const tileIndices = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index++) {
    tileIndices.push(...edit.findPath(doc, tileIndices[tileIndices.length - 1], waypoints[index]).slice(1));
  }
  return tileIndices;
}

// The global tile whose centre is nearest a frame point of the named panel.
function globalTile(doc, panelName, east, north) {
  const panelId = coordinates.panelIdByName(panelName);
  const info = doc.topo.panels[panelId];
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let tileIndex = info.firstTile; tileIndex < info.firstTile + info.tileCount; tileIndex++) {
    const distance = util.pointDistance(doc.topo.tiles[tileIndex].center, [east, north]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = tileIndex;
    }
  }
  return bestIndex;
}

function makeWorld() {
  const doc = model.createGlobalMap({ panelHexes: 8, tileScale: 'XL', name: 'Sample World' });
  view.demoTerrain(doc.topo, 7).forEach((id, tileIndex) => model.setTerrain(doc, tileIndex, id));
  const tile = (panelId, east, north, terrain) => {
    const tileIndex = globalTile(doc, panelId, east, north);
    if (terrain) {
      model.setTerrain(doc, tileIndex, terrainId(terrain));
    }
    return tileIndex;
  };
  const capital = tile('Eta', 0.05, -0.1, 'plain');
  const harbour = tile('Alpha', 0.1, 0.25, 'plain');
  const pass = tile('Theta', 0.2, -0.15, 'hills');
  const oasis = tile('Beta', -0.1, 0.1, 'desert');
  const spring = tile('Theta', -0.25, 0.2, 'mountains');
  const mouth = tile('Zeta', 0.3, -0.2, 'firth');
  // Roads, rivers and trails cross both kinds of seam: polar–equatorial and the equatorial strip.
  model.addOverlay(doc, { type: 'road', name: 'Imperial Way', tileIndices: routedPath(doc, [capital, harbour, oasis]) });
  model.addOverlay(doc, { type: 'road', name: 'North Road', style: 'paved', tileIndices: routedPath(doc, [capital, pass]) });
  model.addOverlay(doc, { type: 'river', name: 'Long River', tileIndices: routedPath(doc, [spring, pass, capital, mouth]) });
  model.addOverlay(doc, { type: 'trail', name: 'Pilgrim Trail', tileIndices: routedPath(doc, [oasis, tile('Gamma', 0, 0)]) });
  model.setLandmark(doc, capital, { type: 'city', name: 'Aurelia', notes: 'Imperial capital on the prime meridian' });
  model.setLandmark(doc, harbour, { type: 'town', name: 'Saltmere' });
  model.setLandmark(doc, pass, { type: 'fortress', name: 'Gatehold' });
  model.setLandmark(doc, oasis, { type: 'temple', name: 'Shrine of Sands' });
  model.setLandmark(doc, tile('Iota', 0, 0, 'tundra'), { type: 'ruins', name: 'Frostspire' });
  model.setLandmark(doc, tile('Lambda', 0, 0, 'mountains'), { type: 'dungeon', name: 'Deepdelve' });
  for (const [panelId, text] of [['Eta', 'The Old Empire'], ['Delta', 'Sunward Isles'], ['Kappa', 'Southern Wastes'], ['Omicron', 'Frost March']]) {
    model.addLabel(doc, { tileIndex: tile(panelId, 0, 0.15), text, category: 'region' });
  }
  model.addLabel(doc, { tileIndex: capital, text: 'Aurelia', category: 'city', dy: 18 });
  model.addLabel(doc, { tileIndex: spring, text: 'Long River', category: 'location', rotation: 20 });
  return doc;
}

// A hand-placed local valley that uses every terrain, landmark type and label category.
function makeValley() {
  const width = 36;
  const height = 26;
  const doc = model.createLocalMap({
    width, height, systemName: 'regional', scaleName: 'M', name: 'Sample Valley',
    anchor: coordinates.parseUniversal('Eta 120W 340N'),
  });
  const point = (columnIndex, rowIndex) => coordinates.localTilePoint(doc.local, columnIndex, rowIndex);
  const at = (columnIndex, rowIndex) => model.localTileIndex(doc, columnIndex, rowIndex);
  // Blobs painted in order: [terrain, x, y, radius in hexes]. Edges are roughened by hash.
  const blobs = [
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
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    for (let columnIndex = 0; columnIndex < width; columnIndex++) {
      const here = point(columnIndex, rowIndex);
      for (const [terrain, cx, cy, radius] of blobs) {
        const centre = point(cx, cy);
        const noise = (util.hashIntegers(columnIndex, rowIndex, terrainId(terrain)) / 4294967296 - 0.5) * Math.min(1.2, radius * 0.5);
        if (util.pointDistance(here, centre) <= radius + noise) {
          model.setTerrain(doc, at(columnIndex, rowIndex), terrainId(terrain));
        }
      }
    }
  }
  const places = {
    city: [17, 13, 'Riverford'], town: [14, 8, 'Millbrook'], village: [21, 17, 'Ashby'],
    castle: [19, 11, 'Highwatch'], fortress: [26, 9, 'Ironpass Keep'], tower: [10, 20, 'Fen Tower'],
    ruins: [31, 20, 'Sunken Court'], mine: [27, 4, 'Deep Seam'], temple: [11, 4, 'Grove Shrine'],
    cave: [25, 19, 'Echo Cave'], dungeon: [32, 3, 'Ice Vault'],
  };
  for (const [type, [columnIndex, rowIndex, name]] of Object.entries(places)) {
    model.setLandmark(doc, at(columnIndex, rowIndex), { type, name });
  }
  const tile = (type) => at(places[type][0], places[type][1]);
  model.addOverlay(doc, { type: 'road', name: 'Kings Road', tileIndices: routedPath(doc, [tile('town'), tile('city'), tile('village'), at(35, 17)]) });
  model.addOverlay(doc, { type: 'road', name: 'Pass Road', style: 'paved', tileIndices: routedPath(doc, [tile('castle'), tile('fortress')]) });
  model.addOverlay(doc, { type: 'trail', name: 'Miners Path', tileIndices: routedPath(doc, [tile('fortress'), tile('mine'), tile('dungeon')]) });
  model.addOverlay(doc, { type: 'trail', tileIndices: routedPath(doc, [tile('village'), tile('cave'), tile('ruins')]) });
  model.addOverlay(doc, { type: 'river', name: 'Silverrun', tileIndices: routedPath(doc, [at(26, 6), at(20, 6), at(18, 12), at(9, 13)]) });
  model.addOverlay(doc, { type: 'river', name: 'Fenwater', tileIndices: routedPath(doc, [at(13, 17), at(8, 19)]) });
  model.addLabel(doc, { tileIndex: at(4, 13), text: 'Grey Sea', category: 'region', rotation: -80 });
  model.addLabel(doc, { tileIndex: at(30, 21), text: 'Ember Waste', category: 'region' });
  model.addLabel(doc, { tileIndex: at(13, 3), text: 'Old Wood', category: 'location' });
  model.addLabel(doc, { tileIndex: at(17, 13), text: 'Riverford', category: 'city', dy: 22 });
  model.addLabel(doc, { tileIndex: at(24, 15), text: 'Kings Road', category: 'location', rotation: 15 });
  model.addLabel(doc, { tileIndex: at(29, 5), text: 'Miners Path', category: 'location', rotation: -30 });
  model.addLabel(doc, { tileIndex: at(22, 8), text: 'Silverrun', category: 'location', rotation: 25, dy: -10 });
  return doc;
}

const SAMPLES = [
  ['sample-world.map.txt', makeWorld],
  ['sample-valley.map.txt', makeValley],
];

function main(args) {
  const check = args.includes('--check');
  let stale = false;
  for (const [file, make] of SAMPLES) {
    const text = fileFormat.write(make());
    const filePath = path.join(SAMPLE_DIR, file);
    if (check) {
      const current = fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text;
      console.log(`${current ? 'ok' : 'STALE'} ${path.relative(REPOSITORY_ROOT, filePath)}`);
      stale = stale || !current;
    } else {
      fs.mkdirSync(SAMPLE_DIR, { recursive: true });
      fs.writeFileSync(filePath, text);
      console.log(`wrote ${path.relative(REPOSITORY_ROOT, filePath)} (${text.length} bytes)`);
    }
  }
  return stale ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { SAMPLES, makeWorld, makeValley, main };
