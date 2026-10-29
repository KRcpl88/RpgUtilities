'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Lattice, Coordinates, Model, View, FileFormat, SvgExport } = LoadModules();

function LocalMap(szSystem = 'regional', szScale = 'M') {
  const Doc = Model.CreateLocalMap({
    nWidth: 9, nHeight: 8, szSystem, szScale, szName: 'A & B <Map> "quoted"',
    Anchor: Coordinates.ParseUniversal('Eta 123.456789E 98.765432N'),
  });
  Model.SetTerrain(Doc, 40, 4);
  for (const szType of ['road', 'trail', 'river']) {
    Model.AddOverlay(Doc, { szType, rgnTiles: [20, 21, 22, 23] });
  }
  Model.SetLandmark(Doc, 40, { szType: 'castle', szName: 'Keep & <town>' });
  Model.AddLabel(Doc, { nTile: 40, szText: 'A & <B> "quoted" \u03b1 \ud83c\udff0', szCategory: 'region', dRotation: 32, dDx: 5, dDy: -12 });
  return Doc;
}

test('SVG exports are deterministic and leave terrain, features and revision unchanged', () => {
  const Doc = LocalMap(), Before = FileFormat.Write(Doc), nRevision = Doc.nRevision;
  const Options = { nWidth: 1200, Layers: { grid: true, landmarkNames: true } };
  const First = SvgExport.Write(Doc, Options);
  assert.equal(SvgExport.Write(Doc, Options), First);
  assert.equal(FileFormat.Write(Doc), Before);
  assert.equal(Doc.nRevision, nRevision);
  assert.match(First, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200"/);
  assert.match(First, /fill-rule="evenodd"/);
  assert.match(First, /clip-path="url\(#map-clip\)"/);
  assert.match(First, /<symbol id="landmark-castle"/);
  assert.match(First, /<use href="#landmark-castle"/);
  assert.match(First, /paint-order="stroke"/);
  assert.doesNotMatch(First, /(?:NaN|Infinity|undefined)/);
});

test('every export layer can be excluded independently without altering other layers', () => {
  const Doc = LocalMap();
  const Enabled = Object.fromEntries(SvgExport.g_Layers.map(([szKey]) => [szKey, true]));
  for (const [szKey] of SvgExport.g_Layers) {
    const Text = SvgExport.Write(Doc, { Layers: { ...Enabled, [szKey]: false } });
    if (['road', 'trail', 'river'].includes(szKey)) {
      assert.ok(!Text.includes(`data-layer="${szKey}"`));
    } else if (szKey === 'landmarkNames') {
      assert.ok(!Text.includes('Keep &amp; &lt;town&gt;'));
    } else {
      assert.ok(!Text.includes(`id="layer-${szKey}"`));
    }
    if (szKey !== 'label') assert.ok(Text.includes('id="layer-label"'));
    if (szKey !== 'terrain') assert.ok(Text.includes('id="layer-terrain"'));
    if (szKey === 'landmark') assert.ok(!Text.includes('<symbol'));
    if (szKey === 'terrain') assert.ok(Text.includes('id="region-'), 'embellishments still clip to regions');
    if (szKey === 'embellishment') assert.ok(!Text.includes('<clipPath id="clip-region-'));
  }
  const NoTerrain = SvgExport.Write(Doc, { Layers: { terrain: false, embellishment: false } });
  assert.ok(!NoTerrain.includes('id="region-'));
  const Empty = SvgExport.Write(Doc, { Layers: Object.fromEntries(SvgExport.g_Layers.map(([szKey]) => [szKey, false])) });
  assert.doesNotMatch(Empty, /id="layer-|data-layer=|<text|<symbol/);
});

test('XML escaping handles text and attributes and rejects unrepresentable characters', () => {
  assert.equal(SvgExport.Escape('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  const Text = SvgExport.Write(LocalMap(), { Layers: { landmarkNames: true } });
  assert.match(Text, /A &amp; B &lt;Map&gt; &quot;quoted&quot;/);
  assert.match(Text, /Keep &amp; &lt;town&gt;/);
  assert.match(Text, /A &amp; &lt;B&gt; &quot;quoted&quot; \u03b1 \ud83c\udff0/);
  for (const szText of ['\u0000', '\u000b', '\ud800', '\udfff', '\uffff']) {
    assert.throws(() => SvgExport.Escape(szText), /XML/);
  }
});

test('SVG is well-formed XML with unique ids and resolved internal references', (Context) => {
  const Doc = LocalMap();
  const Global = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const Rich = Model.CreateGlobalMap({ nPanelHexes: 8 });
  Rich.rgnTerrain.set(View.DemoTerrain(Rich.Topo, 3));
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    Model.SetTerrain(Doc, nTile, nTile % 17);
  }
  const Texts = [SvgExport.Write(Doc), SvgExport.Write(Doc, { Layers: { grid: true, landmarkNames: true } }),
    SvgExport.Write(Doc, { Layers: { terrain: false } }),
    SvgExport.Write(Global, { szPanel: Coordinates.PanelIdByName('Eta') }),
    ...['Beta', 'Gamma', 'Delta', 'Iota'].map((szName) => SvgExport.Write(Rich, { szPanel: Coordinates.PanelIdByName(szName) }))];
  const Check = spawnSync('python3', ['-c', `
import json, sys, re, xml.etree.ElementTree as ET
for text in json.load(sys.stdin):
    root = ET.fromstring(text)
    assert root.tag == '{http://www.w3.org/2000/svg}svg'
    ids = [e.attrib['id'] for e in root.iter() if 'id' in e.attrib]
    assert len(ids) == len(set(ids))
    for e in root.iter():
        if 'href' in e.attrib:
            assert e.attrib['href'].startswith('#') and e.attrib['href'][1:] in ids
        for value in e.attrib.values():
            for ref in re.findall(r'url\\(#([^)]*)\\)', value):
                assert ref in ids
    assert len(root.findall('.//{http://www.w3.org/2000/svg}title')) == 1
`], { input: JSON.stringify(Texts), encoding: 'utf8' });
  if (Check.error && Check.error.code === 'ENOENT') {
    Context.skip('Python 3 is unavailable; browser smoke checks also parse with DOMParser');
    return;
  }
  assert.equal(Check.status, 0, Check.stderr || String(Check.error));
});

test('all eight local scales use the same normalized SVG dimensions and label units', () => {
  for (const szSystem of ['regional', 'local']) {
    for (const szScale of Lattice.g_rgszSizes) {
      const Doc = LocalMap(szSystem, szScale);
      const Size = SvgExport.Dimensions(Doc, 'local', 900);
      assert.equal(Size.nWidth, 900);
      assert.ok(Math.abs(Size.nHeight - 900 * Size.dHeight / Size.dWidth) <= 0.5);
      const Text = SvgExport.Write(Doc, { nWidth: 900 });
      const Match = /<text data-id="label1" transform="matrix\(([^)]+)\)"/.exec(Text);
      const Actual = Match[1].split(' ').map(Number);
      const ToSvg = [48, 0, 0, -48, -Size.rgdBounds[0] * 48, Size.rgdBounds[3] * 48];
      const Expected = Projection.ComposeTransforms(View.LabelTransform(View.MapGeometry(Doc), Doc.rgLabels[0]), ToSvg);
      Actual.forEach((dValue, nIndex) => assert.ok(Math.abs(dValue - Expected[nIndex]) <= 1e-6));
      assert.ok(Math.abs(Math.hypot(Actual[0], Actual[1]) - 1) < 1e-6, 'a label unit is one SVG viewBox unit');
    }
  }
});

test('global export is panel-north-up, with seam-transformed curves and label copies', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const szA = Coordinates.PanelIdByName('Gamma'), szB = Coordinates.PanelIdByName('Beta');
  const Tile = Doc.Topo.rgTiles.find((Item) => Item.szPanel === szA
    && Item.nColumn === Doc.Topo.Panels[szA].nColumns - 1 && !Item.fPartial);
  const nOther = Model.Neighbors(Doc, Tile.nIndex).find((nTile) => Doc.Topo.rgTiles[nTile].szPanel === szB);
  Model.AddOverlay(Doc, { szType: 'road', rgnTiles: [Tile.nIndex, nOther] });
  Model.AddLabel(Doc, { nTile: Tile.nIndex, szCategory: 'location', szText: 'Seam label', dRotation: 20 });
  for (const szPanel of [szA, szB]) {
    const Text = SvgExport.Write(Doc, { szPanel });
    const Size = SvgExport.Dimensions(Doc, szPanel);
    const ToSvg = [48 / Doc.Topo.dD, 0, 0, -48 / Doc.Topo.dD, -Size.rgdBounds[0] * 48, Size.rgdBounds[3] * 48];
    const Curve = View.OverlayCurves(Doc.Topo, Doc.rgOverlays[0]).find((Item) => Item.szPanel === szPanel);
    const Match = /<path data-point="0" d="M([^C]+)C([^"]+)"/.exec(Text);
    const Values = `${Match[1]} ${Match[2]}`.trim().split(/\s+/).map(Number);
    const Expected = Curve.rgrgdControl.flatMap((Point) => Projection.ApplyTransform(ToSvg, Point));
    Values.forEach((dValue, nIndex) => assert.ok(Math.abs(dValue - Expected[nIndex]) <= 1e-6));
    assert.match(Text, /Seam label/);
    assert.match(Text, new RegExp(`- ${Projection.Build().Panels[szPanel].szName}</title>`));
  }
  const Remote = SvgExport.Write(Doc, { szPanel: Coordinates.PanelIdByName('Mu') });
  assert.doesNotMatch(Remote, />Seam label</);
});

test('rivers taper from source to mouth along exact cubic sub-curves; trails stay dashed', () => {
  const Doc = LocalMap();
  const Text = SvgExport.Write(Doc);
  const River = /<g id="overlay-river1"[\s\S]*?<\/g>/.exec(Text)[0];
  const Widths = [...River.matchAll(/<path[^>]+stroke-width="([^"]+)"/g)].map((Match) => Number(Match[1]));
  assert.equal(Widths.length, 24);
  assert.ok(Widths.every((dWidth, nIndex) => nIndex === 0 || dWidth > Widths[nIndex - 1]));
  assert.match(Text, /id="overlay-trail1"[^>]+stroke-dasharray="4 3"/);
  const Curve = View.OverlayCurves(View.MapGeometry(Doc), Doc.rgOverlays[2])[0].rgrgdControl;
  const [First, Second] = View.SplitCurve(Curve);
  assert.deepEqual(First[0], Curve[0]);
  assert.deepEqual(Second[3], Curve[3]);
  assert.deepEqual(First[3], Second[0]);
  for (const dT of [0, 0.1, 0.3, 0.5, 0.75, 1]) {
    assert.ok(Util.Distance(View.CubicPoint(First, dT), View.CubicPoint(Curve, dT / 2)) < 1e-12);
    assert.ok(Util.Distance(View.CubicPoint(Second, dT), View.CubicPoint(Curve, (1 + dT) / 2)) < 1e-12);
  }
});

test('partial-tile labels and glyphs retain their anchors and rotation across non-equatorial seams', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  const szOwner = Coordinates.PanelIdByName('Eta');
  const Tile = Doc.Topo.rgTiles.find((Item) => Item.szPanel === szOwner && Item.fPartial);
  Model.AddLabel(Doc, { nTile: Tile.nIndex, szCategory: 'location', szText: 'Partial', dRotation: 35 });
  Model.SetLandmark(Doc, Tile.nIndex, { szType: 'tower' });
  const Panels = [szOwner, ...Projection.Build().Seams.filter((Seam) => Seam.szPanelA === szOwner || Seam.szPanelB === szOwner)
    .map((Seam) => Seam.szPanelA === szOwner ? Seam.szPanelB : Seam.szPanelA)];
  for (const szPanel of Panels) {
    const Text = SvgExport.Write(Doc, { szPanel }), Size = SvgExport.Dimensions(Doc, szPanel);
    const Label = /<text data-id="label1" transform="matrix\(([^)]+)\)"/.exec(Text)[1].split(' ').map(Number);
    const Glyph = new RegExp(`data-tile="${Tile.nIndex}" transform="matrix\\(([^)]+)\\)"`).exec(Text)[1].split(' ').map(Number);
    const SeamTransform = View.PanelTransform(szOwner, szPanel);
    const Anchor = Projection.ApplyTransform(SeamTransform, View.FeatureAnchor(Doc.Topo, Tile.nIndex));
    const Expected = [(Anchor[0] / Doc.Topo.dD - Size.rgdBounds[0]) * 48, (Size.rgdBounds[3] - Anchor[1] / Doc.Topo.dD) * 48];
    for (const Transform of [Label, Glyph]) {
      assert.ok(Util.Distance(Transform.slice(4), Expected) < 1e-6);
    }
    const dAngle = 35 * Math.PI / 180 - Math.atan2(SeamTransform[1], SeamTransform[0]);
    assert.ok(Math.abs(Label[0] - Math.cos(dAngle)) < 1e-6);
    assert.ok(Math.abs(Label[1] - Math.sin(dAngle)) < 1e-6);
    assert.ok(Math.abs(Math.hypot(Glyph[0], Glyph[1]) - 26 / 24) < 1e-6);
  }
});

test('single-point paths export a clipped point and invalid options report errors', () => {
  const Doc = LocalMap();
  Model.AddOverlay(Doc, { szType: 'road', rgnTiles: [0] });
  assert.match(SvgExport.Write(Doc), /<circle cx="[^"]+" cy="[^"]+" r="3"/);
  for (const nWidth of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => SvgExport.Write(Doc, { nWidth }), /width/);
  }
  assert.throws(() => SvgExport.Write(Doc, { szPanel: 'Alpha' }), /panel/);
  assert.throws(() => SvgExport.Write(Doc, { Layers: { grid: 'yes' } }), /layer/);
  assert.throws(() => SvgExport.Write(Doc, { Layers: { unknown: true } }), /layer/);
  for (const Layers of [null, [], false, 'all']) {
    assert.throws(() => SvgExport.Write(Doc, { Layers }), /layers/);
  }
  assert.throws(() => SvgExport.Write(Model.CreateGlobalMap({ nPanelHexes: 4 })), /panel/);
});

test('export filenames identify the selected global panel and preserve the map basename', () => {
  const Global = Model.CreateGlobalMap({ nPanelHexes: 4, szName: 'My world' });
  assert.equal(SvgExport.FileName(Global, Coordinates.PanelIdByName('Alpha')), 'My-world-Alpha.svg');
  const Local = LocalMap();
  assert.equal(SvgExport.FileName(Local), FileFormat.FileName(Local).replace(/\.map\.txt$/, '.svg'));
});
