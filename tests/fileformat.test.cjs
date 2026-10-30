'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LoadModules } = require('./_load.cjs');

const { Coordinates, Terrain, Model, View, Topology, FileFormat } = LoadModules();

const g_szGlobalFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-global.map.txt'), 'utf8');
const g_szLocalFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-local.map.txt'), 'utf8');

function AssertSameDocument(Actual, Expected) {
  assert.equal(Actual.szKind, Expected.szKind);
  assert.equal(Actual.szName, Expected.szName);
  assert.deepEqual(Actual.Global, Expected.Global);
  assert.deepEqual(Actual.Local, Expected.Local);
  assert.equal(Actual.nTiles, Expected.nTiles);
  assert.deepEqual(Actual.rgnTerrain, Expected.rgnTerrain);
  assert.deepEqual([...Actual.Landmarks].sort((A, B) => A[0] - B[0]), [...Expected.Landmarks].sort((A, B) => A[0] - B[0]));
  assert.deepEqual(Actual.rgOverlays, Expected.rgOverlays);
  assert.deepEqual(Actual.rgLabels, Expected.rgLabels);
}

function RoundTrip(Doc) {
  const szText = FileFormat.Write(Doc);
  const Parsed = FileFormat.Parse(szText);
  AssertSameDocument(Parsed, Doc);
  assert.equal(FileFormat.Write(Parsed), szText, 'write → parse → write is byte-identical');
  return szText;
}

// Replaces line nLine (1-based) of the global fixture.
function WithLine(nLine, fnEdit) {
  const rgszLines = g_szGlobalFixture.split('\n');
  rgszLines[nLine - 1] = fnEdit(rgszLines[nLine - 1]);
  return rgszLines.join('\n');
}

function LineOf(szText, szStart, nFrom = 1) {
  const rgszLines = szText.split('\n');
  for (let nIndex = nFrom - 1; nIndex < rgszLines.length; nIndex++) {
    if (rgszLines[nIndex].startsWith(szStart)) {
      return nIndex + 1;
    }
  }
  throw new Error(`No line starts with ${szStart}`);
}

function AssertFileError(szText, nLine, rePattern) {
  assert.throws(() => FileFormat.Parse(szText), (Caught) => {
    assert.equal(Caught.nLine, nLine, `line of "${Caught.message}"`);
    assert.match(Caught.message, rePattern);
    if (nLine > 0) {
      assert.match(Caught.message, new RegExp(`^Line ${nLine}: `));
    }
    return true;
  });
}

test('fixtures parse and are in canonical form', () => {
  const Global = FileFormat.Parse(g_szGlobalFixture);
  assert.equal(Global.szKind, 'global');
  assert.equal(Global.szName, 'Sample world');
  assert.equal(Global.Landmarks.size, 2);
  assert.equal(Global.rgLabels.length, 2);
  assert.deepEqual(Global.rgOverlays.map((Overlay) => Overlay.szId), ['river1', 'road1', 'trail1']);
  assert.equal(Global.Landmarks.get(Global.rgOverlays[1].rgnTiles[0]).szNotes, 'Capital of the "north"');
  assert.equal(Global.nRevision, 0);
  assert.equal(FileFormat.Write(Global), g_szGlobalFixture);

  const Local = FileFormat.Parse(g_szLocalFixture);
  assert.equal(Local.szKind, 'local');
  assert.equal(Local.Local.szScale, 'M');
  assert.equal(Local.nTiles, 96);
  assert.equal(Local.rgOverlays[0].rgnTiles.length, 7);
  assert.equal(FileFormat.Write(Local), g_szLocalFixture);
});

test('version 2 files round trip and version 1 and unknown versions are rejected', () => {
  const rgDocs = [
    Model.CreateGlobalMap({ nPanelHexes: 4 }),
    Model.CreatePanelMap({ nPanelHexes: 2, szPanel: Coordinates.PanelIdByName('Alpha'), szTileScale: 'M' }),
    Model.CreateLocalMap({ nWidth: 3, nHeight: 3, szSystem: 'regional', szScale: 'M',
      Anchor: Coordinates.ParseUniversal('Eta 0.0E 0.0N') }),
  ];
  for (const Doc of rgDocs) {
    const szText = FileFormat.Write(Doc);
    assert.ok(szText.startsWith('# RPGMAP 2\n'));
    assert.equal(FileFormat.Parse(szText).nVersion, 2);
    for (const nVersion of [0, 1, 3, 99]) {
      const szOtherVersion = szText.replace('# RPGMAP 2', `# RPGMAP ${nVersion}`);
      const reWarning = nVersion < 2
        ? new RegExp(`Older map file version ${nVersion} is no longer supported\\. Expected "# RPGMAP 2"`)
        : new RegExp(`Newer map file version ${nVersion} is not recognized by this editor\\. Expected "# RPGMAP 2"`);
      AssertFileError(szOtherVersion, 1, reWarning);
      AssertFileError('\n\n' + szOtherVersion, 3, reWarning);
    }
  }
});

test('global round trips: demo terrain at n = 4, 24 XL and 4 L, with every item kind', () => {
  for (const [nPanelHexes, szTileScale] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const Doc = Model.CreateGlobalMap({ nPanelHexes, szTileScale, szName: `World ${nPanelHexes}${szTileScale}` });
    Doc.rgnTerrain.set(View.DemoTerrain(Doc.Topo, 2));
    // Items on partial tiles and across seams.
    const nPartial = Doc.Topo.rgTiles.find((Tile) => Tile.fPartial).nIndex;
    const nAcross = Array.from(Topology.Neighbors(Doc.Topo, nPartial))
      .find((nOther) => Doc.Topo.rgTiles[nOther].szPanel !== Doc.Topo.rgTiles[nPartial].szPanel);
    Model.SetLandmark(Doc, nPartial, { szType: 'castle', szName: 'Edge Keep', szNotes: 'On a seam' });
    Model.SetLandmark(Doc, Doc.nTiles - 1, { szType: 'ruins', szName: 'Ünïcode ☃ ruin' });
    Model.AddLabel(Doc, { nTile: nAcross, szText: 'Across', szCategory: 'location', dSize: 12.5, dRotation: 33.25 });
    Model.AddOverlay(Doc, { szType: 'river', szName: 'Seam River', rgnTiles: [nPartial, nAcross] });
    Model.AddOverlay(Doc, { szType: 'road', szId: 'old-road_2', szStyle: 'dirt', rgnTiles: [5] });
    const szText = RoundTrip(Doc);
    assert.ok(/^[\x20-\x7e\n]*$/.test(szText), 'printable ASCII only');
  }
});

test('local round trips for every scale', () => {
  const Anchor = Coordinates.ParseUniversal('Gamma 123.4W 456.7N');
  for (const szSystem of ['regional', 'local']) {
    for (const szScale of ['S', 'M', 'L', 'XL']) {
      const Doc = Model.CreateLocalMap({ nWidth: 9, nHeight: 6, szSystem, szScale, Anchor, szName: `${szSystem} ${szScale}` });
      for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
        Doc.rgnTerrain[nTile] = nTile % Terrain.g_rgTerrains.length;
      }
      Model.SetLandmark(Doc, 0, { szType: 'village', szName: 'Corner' });
      Model.SetLandmark(Doc, Doc.nTiles - 1, { szType: 'dungeon' });
      Model.AddLabel(Doc, { nTile: 10, szText: 'Middle', szCategory: 'region' });
      Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [0, ...Model.Neighbors(Doc, 0).slice(0, 1)] });
      RoundTrip(Doc);
    }
  }
});

test('every tile location written at n = 24 L snaps back to the same tile', () => {
  const Topo = Topology.Build(24, 'L');
  const nDecimals = FileFormat.CoordinateDecimals(Topo.dD * Topo.dMilesPerEdge);
  assert.equal(nDecimals, 1);
  for (let nTile = 0; nTile < Topo.nTiles; nTile += 7) {
    const szText = Coordinates.FormatUniversal(Coordinates.TileToUniversal(Topo, nTile), nDecimals);
    assert.equal(Coordinates.UniversalToTile(Topo, Coordinates.ParseUniversal(szText)), nTile, szText);
  }
});

test('CRLF, comments, blank lines, a missing legend and custom legend characters are accepted', () => {
  const szCommented = g_szGlobalFixture.split('\n')
    .flatMap((szLine) => szLine.startsWith('[') ? ['# a comment', '', `  ${szLine}  `] : [szLine])
    .join('\r\n');
  AssertSameDocument(FileFormat.Parse('\n\n' + szCommented), FileFormat.Parse(g_szGlobalFixture));

  const szNoLegend = g_szLocalFixture.replace(/\[legend\][^[]*/, '');
  AssertSameDocument(FileFormat.Parse(szNoLegend), FileFormat.Parse(g_szLocalFixture));

  const szCustom = g_szLocalFixture.replace('~ water', 'W water').replace(/^~+/gm, (szRun) => 'W'.repeat(szRun.length));
  AssertSameDocument(FileFormat.Parse(szCustom), FileFormat.Parse(g_szLocalFixture));
});

test('optional item fields take their defaults', () => {
  const szText = g_szLocalFixture.replace(/\[labels\][\s\S]*$/, '') +
    '[labels]\nEta 140.3W 315.0N city "Defaults"\n\n[overlays]\nriver : Eta 176.7W 282.0N\n'.replace('river :', 'river r :');
  const Doc = FileFormat.Parse(szText);
  assert.deepEqual({ ...Doc.rgLabels[0] }, { szId: 'label1', nTile: Doc.rgLabels[0].nTile, szText: 'Defaults', szCategory: 'city', dSize: 18, dRotation: 0, dDx: 0, dDy: 0 });
  assert.deepEqual({ ...Doc.rgOverlays[0], rgnTiles: [...Doc.rgOverlays[0].rgnTiles] },
    { szId: 'r', szType: 'river', szName: '', szStyle: '', rgnTiles: [Doc.rgOverlays[0].rgnTiles[0]] });
});

test('quoting escapes backslash, quote and non-ASCII and tokenizing reverses it', () => {
  const szText = 'a "b" \\ c ☃ é\u00a0';
  const szQuoted = FileFormat.Quote(szText);
  assert.equal(szQuoted, '"a \\"b\\" \\\\ c \\u2603 \\u00e9\\u00a0"');
  assert.deepEqual(FileFormat.Tokenize(`x k=v n=${szQuoted} ${szQuoted};:`, 1), [
    { szKind: 'word', szValue: 'x' },
    { szKind: 'pair', szKey: 'k', szValue: 'v' },
    { szKind: 'pair', szKey: 'n', szValue: szText },
    { szKind: 'string', szValue: szText },
    { szKind: 'punct', szValue: ';' },
    { szKind: 'punct', szValue: ':' },
  ]);
});

test('errors report the offending line', () => {
  const nMap = LineOf(g_szGlobalFixture, '[map]');
  const nAlpha = LineOf(g_szGlobalFixture, '[panel Alpha]');
  const nFirstRow = nAlpha + 5;
  const nLandmark = LineOf(g_szGlobalFixture, '[landmarks]') + 1;
  const nLabel = LineOf(g_szGlobalFixture, '[labels]') + 1;
  const nRiver = LineOf(g_szGlobalFixture, 'river ');
  const nLegend = LineOf(g_szGlobalFixture, '~ water');

  AssertFileError('hello', 1, /Not a map file/);
  AssertFileError(WithLine(nMap + 1, () => 'kind = flat'), nMap + 1, /"global", "panel" or "local"/);
  AssertFileError(WithLine(nMap + 3, () => 'panelHexes = 5'), nMap, /even/);
  AssertFileError(WithLine(nMap + 3, () => 'color = red'), nMap + 3, /Unknown key "color"/);
  AssertFileError(WithLine(nLegend, () => '~ lava'), nLegend, /Unknown terrain "lava"/);
  AssertFileError(WithLine(nLegend, () => '. water'), nLegend + 4, /defined twice/);
  AssertFileError(WithLine(nAlpha + 1, () => 'columns = 3'), nAlpha + 1, /columns = 4/);
  AssertFileError(WithLine(nFirstRow, (szLine) => szLine + '~'), nFirstRow, /5 characters wide, expected 4/);
  AssertFileError(WithLine(nFirstRow + 1, (szLine) => 'Q' + szLine.slice(1)), nFirstRow + 1, /Unknown terrain character "Q" in column 1/);
  const szRow = g_szGlobalFixture.split('\n')[nFirstRow - 1];
  const nReserved = szRow.indexOf('_');
  assert.ok(nReserved >= 0, 'the fixture has a reserved cell in Alpha row 1');
  AssertFileError(WithLine(nFirstRow, (szLine) => szLine.slice(0, nReserved) + '~' + szLine.slice(nReserved + 1)), nFirstRow, /not a tile of this panel/);
  const nTileColumn = szRow.search(/[^_]/);
  AssertFileError(WithLine(nFirstRow, (szLine) => szLine.slice(0, nTileColumn) + '_' + szLine.slice(nTileColumn + 1)), nFirstRow, /is a tile/);
  AssertFileError(WithLine(nAlpha, () => '[panel Omega]'), nAlpha, /Unknown panel "Omega"/);
  AssertFileError(WithLine(nAlpha, () => '[panel Beta]'), LineOf(g_szGlobalFixture, '[panel Beta]'), /Duplicate section \[panel Beta\] \(first on line/);
  AssertFileError(g_szGlobalFixture.replace(/\[panel Mu\][^[]*/, ''), 0, /Missing panel sections: Mu/);
  AssertFileError(WithLine(nLandmark, (szLine) => szLine.replace('city', 'spaceport')), nLandmark, /Unknown landmark type/);
  AssertFileError(WithLine(nLandmark + 1, () => g_szGlobalFixture.split('\n')[nLandmark - 1]), nLandmark + 1, /already exists/);
  AssertFileError(WithLine(nLandmark, (szLine) => szLine.replace(/^Iota \S+/, 'Iota 5000.0W')), nLandmark, /No tile within/);
  AssertFileError(WithLine(nLandmark + 1, (szLine) => szLine.replace(/"$/, '')), nLandmark + 1, /Unterminated/);
  AssertFileError(WithLine(nLabel, (szLine) => szLine.replace('rot=-15', 'rot=steep')), nLabel, /"rot" must be a number/);
  AssertFileError(WithLine(nLabel, (szLine) => szLine.replace('rot=-15', 'tilt=3')), nLabel, /Unknown option "tilt"/);
  AssertFileError(WithLine(nRiver, (szLine) => szLine.replace(/; 0\.0E 216\.0N/, '')), nRiver, /not adjacent/);
  AssertFileError(WithLine(nRiver, (szLine) => szLine.replace(' : ', ' ')), nRiver, /Missing ":"/);
  AssertFileError(WithLine(nRiver, (szLine) => szLine + ';'), nRiver, /Empty overlay point 5/);
  AssertFileError(g_szGlobalFixture + '\n[weather]\n', LineOf(g_szGlobalFixture + '\n[weather]\n', '[weather]'), /Unknown section/);
  AssertFileError(g_szLocalFixture.replace(/\[local\][^[]*/, ''), 0, /Missing \[local\]/);
  AssertFileError(g_szLocalFixture.replace('size = M', 'size = XXL'), LineOf(g_szLocalFixture, 'size = M'), /Unknown regional size "XXL"/);
});

test('file names come from the map name', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4, szName: '  My World: Part/2 ' });
  assert.equal(FileFormat.FileName(Doc), 'My-World_-Part_2.map.txt');
  assert.equal(FileFormat.FileName(Model.CreateGlobalMap({ nPanelHexes: 4 })), 'map.map.txt');
});
