'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LoadModules, g_szRepositoryRoot } = require('./_load.cjs');
const { g_Samples } = require('../tools/make_sample_maps.cjs');

const { Projection, Terrain, Model, FileFormat, SvgExport } = LoadModules();
const g_szSampleDir = path.join(g_szRepositoryRoot, 'map-editor', 'samples');

function ReadSample(szFile) {
  return fs.readFileSync(path.join(g_szSampleDir, szFile), 'utf8');
}

test('sample maps are canonical and match their generator', () => {
  for (const [szFile, fnMake] of g_Samples) {
    const szText = ReadSample(szFile);
    assert.equal(FileFormat.Write(FileFormat.Parse(szText)), szText, szFile);
    assert.equal(FileFormat.Write(fnMake()), szText, `${szFile} is stale: run node tools/make_sample_maps.cjs`);
  }
});

test('the valley sample uses every terrain, landmark type, label category and overlay type', () => {
  const Doc = FileFormat.Parse(ReadSample('sample-valley.map.txt'));
  assert.equal(Doc.szKind, 'local');
  const Terrains = new Set(Doc.rgnTerrain);
  assert.deepEqual(Terrain.g_rgTerrains.filter((Type) => !Terrains.has(Type.nId)).map((Type) => Type.szKey), []);
  assert.deepEqual(new Set([...Doc.Landmarks.values()].map((Item) => Item.szType)), new Set(Terrain.g_rgLandmarkTypes.map((Type) => Type.szKey)));
  assert.deepEqual(new Set(Doc.rgLabels.map((Item) => Item.szCategory)), new Set(Model.g_rgszLabelCategories));
  assert.deepEqual(new Set(Doc.rgOverlays.map((Item) => Item.szType)), new Set(Model.g_rgszOverlayTypes));
});

test('the world sample routes features across polar and equatorial seams', () => {
  const Doc = FileFormat.Parse(ReadSample('sample-world.map.txt'));
  const Built = Projection.Build();
  assert.equal(Doc.szKind, 'global');
  assert.equal(new Set(Doc.rgnTerrain).size, Terrain.g_rgTerrains.length);
  const PanelsOf = (Overlay) => new Set(Overlay.rgnTiles.map((nTile) => Doc.Topo.rgTiles[nTile].szPanel));
  const rgSets = Doc.rgOverlays.map(PanelsOf);
  assert.ok(rgSets.some((Panels) => [...Panels].some((szPanel) => !Built.Panels[szPanel].fEquatorial)
    && [...Panels].some((szPanel) => Built.Panels[szPanel].fEquatorial)), 'polar–equatorial crossing');
  assert.ok(rgSets.some((Panels) => [...Panels].filter((szPanel) => Built.Panels[szPanel].fEquatorial).length >= 2), 'equatorial crossing');
  assert.ok(Doc.Landmarks.size > 0 && Doc.rgLabels.length > 0);
});

test('every sample panel exports well-formed SVG', (Context) => {
  const World = FileFormat.Parse(ReadSample('sample-world.map.txt'));
  const Valley = FileFormat.Parse(ReadSample('sample-valley.map.txt'));
  const Texts = [SvgExport.Write(Valley, { Layers: { grid: true, landmarkNames: true } }),
    ...World.Topo.rgszPanels.map((szPanel) => SvgExport.Write(World, { szPanel, Layers: { landmarkNames: true } }))];
  const Check = spawnSync('python3', ['-c', `
import json, sys, xml.etree.ElementTree as ET
for text in json.load(sys.stdin):
    root = ET.fromstring(text)
    assert root.tag == '{http://www.w3.org/2000/svg}svg'
    ids = [e.attrib['id'] for e in root.iter() if 'id' in e.attrib]
    assert len(ids) == len(set(ids))
`], { input: JSON.stringify(Texts), encoding: 'utf8' });
  if (Check.error && Check.error.code === 'ENOENT') {
    Context.skip('Python 3 is unavailable');
    return;
  }
  assert.equal(Check.status, 0, Check.stderr || String(Check.error));
});
