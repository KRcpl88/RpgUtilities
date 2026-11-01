'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModules } = require('./_load.cjs');

const { Coordinates: coordinates, Terrain: terrain, Model: model, View: view, Topology: topology, FileFormat: fileFormat } = loadModules();

const GLOBAL_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-global.map.txt'), 'utf8');
const LOCAL_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-local.map.txt'), 'utf8');

function assertSameDocument(actual, expected) {
  assert.equal(actual.kind, expected.kind);
  assert.equal(actual.name, expected.name);
  assert.deepEqual(actual.global, expected.global);
  assert.deepEqual(actual.local, expected.local);
  assert.equal(actual.tileCount, expected.tileCount);
  assert.deepEqual(actual.terrainIds, expected.terrainIds);
  assert.deepEqual([...actual.landmarks].sort((a, b) => a[0] - b[0]), [...expected.landmarks].sort((a, b) => a[0] - b[0]));
  assert.deepEqual(actual.overlays, expected.overlays);
  assert.deepEqual(actual.labels, expected.labels);
}

function roundTrip(doc) {
  const text = fileFormat.write(doc);
  const parsed = fileFormat.parse(text);
  assertSameDocument(parsed, doc);
  assert.equal(fileFormat.write(parsed), text, 'write → parse → write is byte-identical');
  return text;
}

// Replaces line lineNumber (1-based) of the global fixture.
function withLine(lineNumber, edit) {
  const lines = GLOBAL_FIXTURE.split('\n');
  lines[lineNumber - 1] = edit(lines[lineNumber - 1]);
  return lines.join('\n');
}

function lineOf(text, start, fromIndex = 1) {
  const lines = text.split('\n');
  for (let index = fromIndex - 1; index < lines.length; index++) {
    if (lines[index].startsWith(start)) {
      return index + 1;
    }
  }
  throw new Error(`No line starts with ${start}`);
}

function assertFileError(text, lineNumber, rePattern) {
  assert.throws(() => fileFormat.parse(text), (caught) => {
    assert.equal(caught.lineNumber, lineNumber, `line of "${caught.message}"`);
    assert.match(caught.message, rePattern);
    if (lineNumber > 0) {
      assert.match(caught.message, new RegExp(`^Line ${lineNumber}: `));
    }
    return true;
  });
}

test('fixtures parse and are in canonical form', () => {
  const global = fileFormat.parse(GLOBAL_FIXTURE);
  assert.equal(global.kind, 'global');
  assert.equal(global.name, 'Sample world');
  assert.equal(global.landmarks.size, 2);
  assert.equal(global.labels.length, 2);
  assert.deepEqual(global.overlays.map((overlay) => overlay.id), ['river1', 'road1', 'trail1']);
  assert.equal(global.landmarks.get(global.overlays[1].tileIndices[0]).notes, 'Capital of the "north"');
  assert.equal(global.revision, 0);
  assert.equal(fileFormat.write(global), GLOBAL_FIXTURE);

  const local = fileFormat.parse(LOCAL_FIXTURE);
  assert.equal(local.kind, 'local');
  assert.equal(local.local.scaleName, 'M');
  assert.equal(local.tileCount, 96);
  assert.equal(local.overlays[0].tileIndices.length, 7);
  assert.equal(fileFormat.write(local), LOCAL_FIXTURE);
});

test('version 2 files round trip and version 1 and unknown versions are rejected', () => {
  const docs = [
    model.createGlobalMap({ panelHexes: 4 }),
    model.createPanelMap({ panelHexes: 2, panelId: coordinates.panelIdByName('Alpha'), tileScale: 'M' }),
    model.createLocalMap({ width: 3, height: 3, systemName: 'regional', scaleName: 'M',
      anchor: coordinates.parseUniversal('Eta 0.0E 0.0N') }),
  ];
  for (const doc of docs) {
    const text = fileFormat.write(doc);
    assert.ok(text.startsWith('# RPGMAP 2\n'));
    assert.equal(fileFormat.parse(text).versionNumber, 2);
    for (const versionNumber of [0, 1, 3, 99]) {
      const otherVersion = text.replace('# RPGMAP 2', `# RPGMAP ${versionNumber}`);
      const reWarning = versionNumber < 2
        ? new RegExp(`Older map file version ${versionNumber} is no longer supported\\. Expected "# RPGMAP 2"`)
        : new RegExp(`Newer map file version ${versionNumber} is not recognized by this editor\\. Expected "# RPGMAP 2"`);
      assertFileError(otherVersion, 1, reWarning);
      assertFileError('\n\n' + otherVersion, 3, reWarning);
    }
  }
});

test('global round trips: demo terrain at n = 4, 24 XL and 4 L, with every item kind', () => {
  for (const [panelHexes, tileScale] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const doc = model.createGlobalMap({ panelHexes, tileScale, name: `World ${panelHexes}${tileScale}` });
    doc.terrainIds.set(view.demoTerrain(doc.topo, 2));
    // Items on partial tiles and across seams.
    const partial = doc.topo.tiles.find((tile) => tile.isPartial).index;
    const across = Array.from(topology.neighbors(doc.topo, partial))
      .find((otherIndex) => doc.topo.tiles[otherIndex].panelId !== doc.topo.tiles[partial].panelId);
    model.setLandmark(doc, partial, { type: 'castle', name: 'Edge Keep', notes: 'On a seam' });
    model.setLandmark(doc, doc.tileCount - 1, { type: 'ruins', name: 'Ünïcode ☃ ruin' });
    model.addLabel(doc, { tileIndex: across, text: 'Across', category: 'location', size: 12.5, rotation: 33.25 });
    model.addOverlay(doc, { type: 'river', name: 'Seam River', tileIndices: [partial, across] });
    model.addOverlay(doc, { type: 'road', id: 'old-road_2', style: 'dirt', tileIndices: [5] });
    const text = roundTrip(doc);
    assert.ok(/^[\x20-\x7e\n]*$/.test(text), 'printable ASCII only');
  }
});

test('local round trips for every scale', () => {
  const anchor = coordinates.parseUniversal('Gamma 123.4W 456.7N');
  for (const systemName of ['regional', 'local']) {
    for (const scaleName of ['S', 'M', 'L', 'XL']) {
      const doc = model.createLocalMap({ width: 9, height: 6, systemName, scaleName, anchor, name: `${systemName} ${scaleName}` });
      for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
        doc.terrainIds[tileIndex] = tileIndex % terrain.TERRAINS.length;
      }
      model.setLandmark(doc, 0, { type: 'village', name: 'Corner' });
      model.setLandmark(doc, doc.tileCount - 1, { type: 'dungeon' });
      model.addLabel(doc, { tileIndex: 10, text: 'Middle', category: 'region' });
      model.addOverlay(doc, { type: 'trail', tileIndices: [0, ...model.neighbors(doc, 0).slice(0, 1)] });
      roundTrip(doc);
    }
  }
});

test('every tile location written at n = 24 L snaps back to the same tile', () => {
  const topo = topology.build(24, 'L');
  const decimals = fileFormat.coordinateDecimals(topo.d * topo.milesPerEdge);
  assert.equal(decimals, 1);
  for (let tileIndex = 0; tileIndex < topo.tileCount; tileIndex += 7) {
    const text = coordinates.formatUniversal(coordinates.tileToUniversal(topo, tileIndex), decimals);
    assert.equal(coordinates.universalToTile(topo, coordinates.parseUniversal(text)), tileIndex, text);
  }
});

test('CRLF, comments, blank lines, a missing legend and custom legend characters are accepted', () => {
  const commented = GLOBAL_FIXTURE.split('\n')
    .flatMap((line) => line.startsWith('[') ? ['# a comment', '', `  ${line}  `] : [line])
    .join('\r\n');
  assertSameDocument(fileFormat.parse('\n\n' + commented), fileFormat.parse(GLOBAL_FIXTURE));

  const noLegend = LOCAL_FIXTURE.replace(/\[legend\][^[]*/, '');
  assertSameDocument(fileFormat.parse(noLegend), fileFormat.parse(LOCAL_FIXTURE));

  const custom = LOCAL_FIXTURE.replace('~ water', 'W water').replace(/^~+/gm, (run) => 'W'.repeat(run.length));
  assertSameDocument(fileFormat.parse(custom), fileFormat.parse(LOCAL_FIXTURE));
});

test('optional item fields take their defaults', () => {
  const text = LOCAL_FIXTURE.replace(/\[labels\][\s\S]*$/, '') +
    '[labels]\nEta 140.3W 315.0N city "Defaults"\n\n[overlays]\nriver : Eta 176.7W 282.0N\n'.replace('river :', 'river r :');
  const doc = fileFormat.parse(text);
  assert.deepEqual({ ...doc.labels[0] }, { id: 'label1', tileIndex: doc.labels[0].tileIndex, text: 'Defaults', category: 'city', size: 18, rotation: 0, dx: 0, dy: 0 });
  assert.deepEqual({ ...doc.overlays[0], tileIndices: [...doc.overlays[0].tileIndices] },
    { id: 'r', type: 'river', name: '', style: '', tileIndices: [doc.overlays[0].tileIndices[0]] });
});

test('quoting escapes backslash, quote and non-ASCII and tokenizing reverses it', () => {
  const text = 'a "b" \\ c ☃ é\u00a0';
  const quoted = fileFormat.quote(text);
  assert.equal(quoted, '"a \\"b\\" \\\\ c \\u2603 \\u00e9\\u00a0"');
  assert.deepEqual(fileFormat.tokenize(`x k=v n=${quoted} ${quoted};:`, 1), [
    { kind: 'word', value: 'x' },
    { kind: 'pair', key: 'k', value: 'v' },
    { kind: 'pair', key: 'n', value: text },
    { kind: 'string', value: text },
    { kind: 'punct', value: ';' },
    { kind: 'punct', value: ':' },
  ]);
});

test('errors report the offending line', () => {
  const map = lineOf(GLOBAL_FIXTURE, '[map]');
  const alpha = lineOf(GLOBAL_FIXTURE, '[panel Alpha]');
  const firstRow = alpha + 5;
  const landmark = lineOf(GLOBAL_FIXTURE, '[landmarks]') + 1;
  const label = lineOf(GLOBAL_FIXTURE, '[labels]') + 1;
  const river = lineOf(GLOBAL_FIXTURE, 'river ');
  const legend = lineOf(GLOBAL_FIXTURE, '~ water');

  assertFileError('hello', 1, /Not a map file/);
  assertFileError(withLine(map + 1, () => 'kind = flat'), map + 1, /"global", "panel" or "local"/);
  assertFileError(withLine(map + 3, () => 'panelHexes = 5'), map, /even/);
  assertFileError(withLine(map + 3, () => 'color = red'), map + 3, /Unknown key "color"/);
  assertFileError(withLine(legend, () => '~ lava'), legend, /Unknown terrain "lava"/);
  assertFileError(withLine(legend, () => '. water'), legend + 4, /defined twice/);
  assertFileError(withLine(alpha + 1, () => 'columns = 3'), alpha + 1, /columns = 4/);
  assertFileError(withLine(firstRow, (line) => line + '~'), firstRow, /5 characters wide, expected 4/);
  assertFileError(withLine(firstRow + 1, (line) => 'Q' + line.slice(1)), firstRow + 1, /Unknown terrain character "Q" in column 1/);
  const row = GLOBAL_FIXTURE.split('\n')[firstRow - 1];
  const reserved = row.indexOf('_');
  assert.ok(reserved >= 0, 'the fixture has a reserved cell in Alpha row 1');
  assertFileError(withLine(firstRow, (line) => line.slice(0, reserved) + '~' + line.slice(reserved + 1)), firstRow, /not a tile of this panel/);
  const tileColumn = row.search(/[^_]/);
  assertFileError(withLine(firstRow, (line) => line.slice(0, tileColumn) + '_' + line.slice(tileColumn + 1)), firstRow, /is a tile/);
  assertFileError(withLine(alpha, () => '[panel Omega]'), alpha, /Unknown panel "Omega"/);
  assertFileError(withLine(alpha, () => '[panel Beta]'), lineOf(GLOBAL_FIXTURE, '[panel Beta]'), /Duplicate section \[panel Beta\] \(first on line/);
  assertFileError(GLOBAL_FIXTURE.replace(/\[panel Mu\][^[]*/, ''), 0, /Missing panel sections: Mu/);
  assertFileError(withLine(landmark, (line) => line.replace('city', 'spaceport')), landmark, /Unknown landmark type/);
  assertFileError(withLine(landmark + 1, () => GLOBAL_FIXTURE.split('\n')[landmark - 1]), landmark + 1, /already exists/);
  assertFileError(withLine(landmark, (line) => line.replace(/^Iota \S+/, 'Iota 5000.0W')), landmark, /No tile within/);
  assertFileError(withLine(landmark + 1, (line) => line.replace(/"$/, '')), landmark + 1, /Unterminated/);
  assertFileError(withLine(label, (line) => line.replace('rot=-15', 'rot=steep')), label, /"rot" must be a number/);
  assertFileError(withLine(label, (line) => line.replace('rot=-15', 'tilt=3')), label, /Unknown option "tilt"/);
  assertFileError(withLine(river, (line) => line.replace(/; 0\.0E 216\.0N/, '')), river, /not adjacent/);
  assertFileError(withLine(river, (line) => line.replace(' : ', ' ')), river, /Missing ":"/);
  assertFileError(withLine(river, (line) => line + ';'), river, /Empty overlay point 5/);
  assertFileError(GLOBAL_FIXTURE + '\n[weather]\n', lineOf(GLOBAL_FIXTURE + '\n[weather]\n', '[weather]'), /Unknown section/);
  assertFileError(LOCAL_FIXTURE.replace(/\[local\][^[]*/, ''), 0, /Missing \[local\]/);
  assertFileError(LOCAL_FIXTURE.replace('size = M', 'size = XXL'), lineOf(LOCAL_FIXTURE, 'size = M'), /Unknown regional size "XXL"/);
});

test('file names come from the map name', () => {
  const doc = model.createGlobalMap({ panelHexes: 4, name: '  My World: Part/2 ' });
  assert.equal(fileFormat.fileName(doc), 'My-World_-Part_2.map.txt');
  assert.equal(fileFormat.fileName(model.createGlobalMap({ panelHexes: 4 })), 'map.map.txt');
});
