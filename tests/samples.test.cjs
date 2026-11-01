'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadModules, REPOSITORY_ROOT } = require('./_load.cjs');
const { SAMPLES } = require('../tools/make_sample_maps.cjs');

const { Projection: projection, Terrain: terrain, Model: model, FileFormat: fileFormat, SvgExport: svgExport } = loadModules();
const SAMPLE_DIR = path.join(REPOSITORY_ROOT, 'map-editor', 'samples');

function readSample(file) {
  return fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8');
}

test('sample maps are canonical and match their generator', () => {
  for (const [file, make] of SAMPLES) {
    const text = readSample(file);
    assert.equal(fileFormat.write(fileFormat.parse(text)), text, file);
    assert.equal(fileFormat.write(make()), text, `${file} is stale: run node tools/make_sample_maps.cjs`);
  }
});

test('the valley sample uses every terrain, landmark type, label category and overlay type', () => {
  const doc = fileFormat.parse(readSample('sample-valley.map.txt'));
  assert.equal(doc.kind, 'local');
  const terrains = new Set(doc.terrainIds);
  assert.deepEqual(terrain.TERRAINS.filter((type) => !terrains.has(type.id)).map((type) => type.key), []);
  assert.deepEqual(new Set([...doc.landmarks.values()].map((item) => item.type)), new Set(terrain.LANDMARK_TYPES.map((type) => type.key)));
  assert.deepEqual(new Set(doc.labels.map((item) => item.category)), new Set(model.LABEL_CATEGORIES));
  assert.deepEqual(new Set(doc.overlays.map((item) => item.type)), new Set(model.OVERLAY_TYPES));
});

test('the world sample routes features across polar and equatorial seams', () => {
  const doc = fileFormat.parse(readSample('sample-world.map.txt'));
  const built = projection.build();
  assert.equal(doc.kind, 'global');
  assert.equal(new Set(doc.terrainIds).size, terrain.TERRAINS.length);
  const panelsOf = (overlay) => new Set(overlay.tileIndices.map((tileIndex) => doc.topo.tiles[tileIndex].panelId));
  const sets = doc.overlays.map(panelsOf);
  assert.ok(sets.some((panels) => [...panels].some((panelId) => !built.panels[panelId].isEquatorial)
    && [...panels].some((panelId) => built.panels[panelId].isEquatorial)), 'polar–equatorial crossing');
  assert.ok(sets.some((panels) => [...panels].filter((panelId) => built.panels[panelId].isEquatorial).length >= 2), 'equatorial crossing');
  assert.ok(doc.landmarks.size > 0 && doc.labels.length > 0);
});

test('every sample panel exports well-formed SVG', (context) => {
  const world = fileFormat.parse(readSample('sample-world.map.txt'));
  const valley = fileFormat.parse(readSample('sample-valley.map.txt'));
  const texts = [svgExport.write(valley, { layers: { grid: true, landmarkNames: true } }),
    ...world.topo.panelIds.map((panelId) => svgExport.write(world, { panelId, layers: { landmarkNames: true } }))];
  const check = spawnSync('python3', ['-c', `
import json
import sys
import xml.etree.ElementTree as et
for text in json.load(sys.stdin):
    root = et.fromstring(text)
    assert root.tag == '{http://www.w3.org/2000/svg}svg'
    ids = [e.attrib['id'] for e in root.iter() if 'id' in e.attrib]
    assert len(ids) == len(set(ids))
`], { input: JSON.stringify(texts), encoding: 'utf8' });
  if (check.error && check.error.code === 'ENOENT') {
    context.skip('Python 3 is unavailable');
    return;
  }
  assert.equal(check.status, 0, check.stderr || String(check.error));
});
