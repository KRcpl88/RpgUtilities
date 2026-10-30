'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Lattice, Coordinates, Model, Terrain, View, Regions, FileFormat, SvgExport } = LoadModules();

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

function ShoreMap(szShape) {
  const Doc = Model.CreateLocalMap({ nWidth: 13, nHeight: 12, szSystem: 'local', szScale: 'M',
    Anchor: Coordinates.ParseUniversal('Eta 0E 0N') });
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    const [nX, nY] = Model.LocalTileXY(Doc, nTile);
    const nDistance = Math.max(Math.abs(nX - 6), Math.abs(nY - 5));
    const fLand = szShape === 'island' ? nDistance < 3
      : szShape === 'lake' ? nDistance >= 2
        : szShape === 'ring' ? nDistance >= 2 && nDistance <= 3
          : szShape === 'channel' ? nX !== 6 : nX > 5;
    Model.SetTerrain(Doc, nTile, fLand ? 4 + nY % 13 : nY % 4);
  }
  return Doc;
}

test('SVG shorelines interpolate displaced edge midpoints only, with smooth joins and no corner constraints', () => {
  let fLandward = false, fWaterward = false;
  let dMaxOffset = 0;
  for (const szShape of ['island', 'lake', 'ring', 'channel', 'coast']) {
    const Doc = ShoreMap(szShape), Data = Regions.Build(Doc), Before = FileFormat.Write(Doc);
    const Shore = SvgExport.BuildShorelines(Data);
    for (const Path of Data.rgShorelines) {
      const Spline = Shore.Paths.get(Path), nEdges = Path.rgrgdPoints.length - 1;
      assert.equal(Spline.length, nEdges + (Path.fClosed ? 0 : 1), 'one segment between successive midpoints, plus open end caps');
      for (let nIndex = 0; nIndex + 1 < Path.rgrgdPoints.length; nIndex++) {
        const A = Path.rgrgdPoints[nIndex], B = Path.rgrgdPoints[nIndex + 1];
        const Curves = Shore.Edges.get(A).get(B);
        assert.equal(Curves.length, 2, 'fill pieces meet at the edge midpoint sample');
        assert.deepEqual(Curves[0][3], Curves[1][0]);
        assert.deepEqual(Curves[0][0], Shore.Vertices.get(A));
        assert.deepEqual(Curves[1][3], Shore.Vertices.get(B));
        assert.deepEqual(Shore.Edges.get(B).get(A), Curves.map((Curve) => [...Curve].reverse()).reverse());
        const Tangent = Util.Unit(Util.Subtract(B, A)), Normal = [-Tangent[1], Tangent[0]];
        const Delta = Util.Subtract(Curves[0][3], Util.Scale(Util.Add(A, B), 0.5));
        const dOffset = Util.Dot(Delta, Normal);
        dMaxOffset = Math.max(dMaxOffset, Math.abs(dOffset));
        fLandward ||= dOffset > 0.01;
        fWaterward ||= dOffset < -0.01;
        assert.ok(Math.abs(Util.Dot(Delta, Tangent)) < 1e-10, 'the sample moves only along the centre-to-face ray');
        assert.ok(Math.abs(dOffset) <= 0.30 * 2 / Math.sqrt(3) + 1e-10, 'midpoint displacement is bounded by 30% of hex width');
        assert.deepEqual(Spline[Path.fClosed ? nIndex : nIndex + 1][0], Curves[0][3]);
        const Next = nIndex + 2 < Path.rgrgdPoints.length ? Path.rgrgdPoints[nIndex + 2]
          : Path.fClosed ? Path.rgrgdPoints[1] : null;
        for (const [First, Second] of [[Curves[0], Curves[1]],
          ...(Next ? [[Curves[1], Shore.Edges.get(B).get(Next)[0]]] : [])]) {
          assert.ok(Util.Distance(Util.Unit(Util.Subtract(First[3], First[2])),
            Util.Unit(Util.Subtract(Second[1], Second[0]))) < 1e-10, 'fill subdivisions keep the spline tangent');
        }
        if (Next) {
          const dT = Util.Distance(A, B) / (Util.Distance(A, B) + Util.Distance(B, Next));
          const [First, Second] = View.SplitCurve(Spline[Path.fClosed ? nIndex : nIndex + 1], dT);
          assert.deepEqual(Curves[1], First, 'the corner junction is derived from the unconstrained midpoint spline');
          assert.deepEqual(Shore.Edges.get(B).get(Next)[0], Second);
          assert.ok(Spline.every((Curve) => Util.Distance(Curve[0], B) > 1e-8),
            'no interior hex corner is an interpolation point');
        }
      }
      for (let nIndex = 0; nIndex < Spline.length - (Path.fClosed ? 0 : 1); nIndex++) {
        const First = Spline[nIndex], Second = Spline[(nIndex + 1) % Spline.length];
        assert.deepEqual(First[3], Second[0]);
        assert.ok(Util.Distance(Util.Subtract(First[3], First[2]), Util.Subtract(Second[1], Second[0])) < 1e-10,
          'successive midpoint segments have matching derivatives, including the closed join');
      }
      if (!Path.fClosed) {
        assert.deepEqual(Shore.Vertices.get(Path.rgrgdPoints[0]), Path.rgrgdPoints[0]);
        assert.deepEqual(Shore.Vertices.get(Path.rgrgdPoints.at(-1)), Path.rgrgdPoints.at(-1));
      }
    }
    assert.equal(FileFormat.Write(Doc), Before);
  }
  assert.ok(fLandward && fWaterward, 'the shoreline wanders to both sides of the hex boundary');
  assert.ok(dMaxOffset > 0.25 * 2 / Math.sqrt(3), 'full edges can use the expanded 30% range, not the former small-edge cap');
});

function SvgSegments(szPath) {
  let Current, Start;
  const Segments = [];
  for (const Match of szPath.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const Values = Match[2].trim().split(/\s+/).filter(Boolean).map(Number);
    if (Match[1] === 'M') {
      Current = Start = Values;
    } else if (Match[1] === 'L') {
      Segments.push([Current, Values]);
      Current = Values;
    } else if (Match[1] === 'C') {
      const Curve = [Current, Values.slice(0, 2), Values.slice(2, 4), Values.slice(4, 6)];
      Segments.push(Curve);
      Current = Curve[3];
    } else {
      Segments.push([Current, Start]);
      Current = Start;
    }
  }
  return Segments;
}

function ContainsSegments(Segments, Point) {
  let fInside = false;
  for (const Segment of Segments) {
    const Points = Segment.length === 4 ? View.FlattenCurve(Segment, 0.002) : Segment;
    for (let nIndex = 0; nIndex + 1 < Points.length; nIndex++) {
      const A = Points[nIndex], B = Points[nIndex + 1];
      if ((A[1] > Point[1]) !== (B[1] > Point[1])
        && Point[0] < A[0] + (Point[1] - A[1]) * (B[0] - A[0]) / (B[1] - A[1])) {
        fInside = !fInside;
      }
    }
  }
  return fInside;
}

test('SVG land and water fills share the exact shoreline, including mixed terrains and narrow channels', () => {
  for (const szShape of ['island', 'lake', 'ring', 'channel', 'coast']) {
    const Doc = ShoreMap(szShape), Data = Regions.Build(Doc), Shore = SvgExport.BuildShorelines(Data);
    const Text = SvgExport.Write(Doc, { Layers: { embellishment: false } });
    const Size = SvgExport.Dimensions(Doc);
    const ToSvg = [48, 0, 0, -48, -Size.rgdBounds[0] * 48, Size.rgdBounds[3] * 48];
    const Paths = [...Text.matchAll(/<path id="region-(\d+)"[^>]+d="([^"]+)"/g)]
      .map((Match) => SvgSegments(Match[2]));
    const FlatPaths = Paths.map((Segments) => Segments.flatMap((Segment) => {
      const Points = Segment.length === 4 ? View.FlattenCurve(Segment, 0.002) : Segment;
      return Points.slice(1).map((Point, nIndex) => [Points[nIndex], Point]);
    }));
    const Keys = Paths.map((Segments) => new Set(Segments.filter((Segment) => Segment.length === 4).map(JSON.stringify)));
    const CoastGroup = /<g id="layer-shoreline"[^>]*>([\s\S]*?)<\/g>/.exec(Text)[1];
    const CoastKeys = new Set([...CoastGroup.matchAll(/<path d="([^"]+)"/g)]
      .flatMap((Match) => SvgSegments(Match[1]).filter((Segment) => Segment.length === 4).map(JSON.stringify)));
    for (const Edge of Data.rgEdges) {
      if (Edge.rgnCells.length !== 2) continue;
      const Cells = Edge.rgnCells.map((nCell) => Data.rgCells[nCell]);
      if (Terrain.IsWater(Cells[0].nTerrainId) === Terrain.IsWater(Cells[1].nTerrainId)) continue;
      const fFirstLand = !Terrain.IsWater(Cells[0].nTerrainId);
      const A = Data.rgrgdPoints[fFirstLand ? Edge.nA : Edge.nB];
      const B = Data.rgrgdPoints[fFirstLand ? Edge.nB : Edge.nA];
      const Land = Cells[fFirstLand ? 0 : 1], Water = Cells[fFirstLand ? 1 : 0];
      const Curves = Shore.Edges.get(A).get(B);
      for (const Curve of Curves) {
        const Mapped = Curve.map((Point) => Projection.ApplyTransform(ToSvg, Point)
          .map((dValue) => Number(Util.FormatNumber(dValue))));
        assert.ok(Keys[Land.nRegion].has(JSON.stringify(Mapped)));
        assert.ok(Keys[Water.nRegion].has(JSON.stringify([...Mapped].reverse())));
      }
      const Tangent = Util.Unit(Util.Subtract(B, A)), Normal = [-Tangent[1], Tangent[0]];
      for (const [dSign, Expected] of [[1, Land], [-1, Water]]) {
        const Point = Projection.ApplyTransform(ToSvg, Util.Add(Curves[0][3], Util.Scale(Normal, dSign * 0.012)));
        const Owners = FlatPaths.flatMap((Segments, nRegion) => ContainsSegments(Segments, Point) ? [nRegion] : []);
        assert.deepEqual(Owners, [Expected.nRegion], `${szShape}: only the adjacent terrain colours its side of the coast`);
      }
    }
    for (const Curves of Shore.Paths.values()) {
      for (const Curve of Curves) {
        const Mapped = Curve.map((Point) => Projection.ApplyTransform(ToSvg, Point)
          .map((dValue) => Number(Util.FormatNumber(dValue))));
        assert.ok(CoastKeys.has(JSON.stringify(Mapped)), 'the stroke exports the unsplit midpoint spline');
      }
    }
    const Polygons = Data.rgCells.map((Cell) => Cell.rgnVertices.map((nVertex) => Data.rgrgdPoints[nVertex]));
    for (let nX = 0; nX < 24; nX++) {
      for (let nY = 0; nY < 24; nY++) {
        const Point = [Data.rgdBounds[0] + (nX + 0.317) / 24 * (Data.rgdBounds[2] - Data.rgdBounds[0]),
          Data.rgdBounds[1] + (nY + 0.641) / 24 * (Data.rgdBounds[3] - Data.rgdBounds[1])];
        if (!Polygons.some((Polygon) => Util.PointInConvex(Point, Polygon))) continue;
        const Mapped = Projection.ApplyTransform(ToSvg, Point);
        const nOwners = FlatPaths.filter((Segments) => ContainsSegments(Segments, Mapped)).length;
        assert.equal(nOwners, 1, `${szShape}: midpoint smoothing leaves no fill gaps or overlaps near junctions`);
      }
    }
  }
});

test('SVG shoreline colour adjustments and embellishment clips follow the existing layer switches', () => {
  const Doc = ShoreMap('island');
  const On = SvgExport.Write(Doc), Off = SvgExport.Write(Doc, { Layers: { shoreline: false } });
  assert.match(On, /<path id="region-\d+"[^>]+d="[^"]*C/);
  assert.doesNotMatch(Off, /<path id="region-\d+"[^>]+d="[^"]*C|id="layer-shoreline"/);
  const NoColours = SvgExport.Write(Doc, { Layers: { terrain: false, embellishment: false } });
  assert.doesNotMatch(NoColours, /id="layer-terrain"|id="region-/);
  assert.match(NoColours, /<g id="layer-shoreline" fill="none"[\s\S]*?<path d="[^"]*C/);
  assert.match(On, /<clipPath id="clip-region-\d+"><use href="#region-\d+"\/>/);
  const Wider = SvgExport.Write(Doc, { nWidth: 2400 });
  assert.equal(On.replace(/width="\d+" height="\d+"/, ''), Wider.replace(/width="\d+" height="\d+"/, ''));
});

test('clipped global and span shorelines retain endpoint anchors and bound midpoint offsets', () => {
  const Span = Model.CreateLocalMap({ nWidth: 40, nHeight: 30, szSystem: 'regional', szScale: 'L',
    Anchor: Coordinates.MakeLocation('Hxz+-', 0.45 * Projection.MilesPerEdge(24), 0.3 * Projection.MilesPerEdge(24)) });
  assert.ok(Span.Topo.Span);
  for (const Doc of [Model.CreateGlobalMap({ nPanelHexes: 4 }), Span]) {
    Doc.rgnTerrain.set(View.DemoTerrain(Doc.Topo, 3));
    for (const szPanel of Doc.Local ? ['local'] : Object.keys(Projection.Build().Panels)) {
      const Data = Regions.Build(Doc, szPanel), Shore = SvgExport.BuildShorelines(Data);
      for (const Edge of Data.rgEdges) {
        const A = Data.rgrgdPoints[Edge.nA], B = Data.rgrgdPoints[Edge.nB];
        const Curves = Shore.Edges.get(A)?.get(B);
        const fCoast = Edge.rgnCells.length === 2
          && Terrain.IsWater(Data.rgCells[Edge.rgnCells[0]].nTerrainId) !== Terrain.IsWater(Data.rgCells[Edge.rgnCells[1]].nTerrainId);
        assert.equal(!!Curves, fCoast, 'only a shared water/land edge gets shoreline curves');
        if (Curves) {
          const Delta = Util.Subtract(Curves[0][3], Util.Scale(Util.Add(A, B), 0.5));
          assert.ok(Util.Length(Delta) <= SvgExport.g_dShoreDeviation * Math.min(1, Util.Distance(A, B) * Math.sqrt(3)) + 1e-10);
          assert.ok(Math.abs(Util.Dot(Delta, Util.Unit(Util.Subtract(B, A)))) < 1e-10);
        }
      }
      for (const Path of Data.rgShorelines.filter((Item) => !Item.fClosed)) {
        assert.deepEqual(Shore.Vertices.get(Path.rgrgdPoints[0]), Path.rgrgdPoints[0]);
        assert.deepEqual(Shore.Vertices.get(Path.rgrgdPoints.at(-1)), Path.rgrgdPoints.at(-1));
      }
      assert.doesNotMatch(SvgExport.Write(Doc, { szPanel }), /(?:NaN|Infinity|undefined)/);
    }
  }
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
      // Local maps that span a seam draw in their anchor panel's frame (edge units).
      const Geometry = View.MapGeometry(Doc);
      const rgdToHex = Geometry.Span
        ? Projection.ComposeTransforms(View.FeatureCopies(Geometry, View.MapLayout(Doc), Doc.rgLabels[0].nTile)[0].rgdFrameToWorld,
          [1 / Geometry.dD, 0, 0, 1 / Geometry.dD, 0, 0])
        : [1, 0, 0, 1, 0, 0];
      const Expected = Projection.ComposeTransforms(View.LabelTransform(Geometry, Doc.rgLabels[0]), Projection.ComposeTransforms(rgdToHex, ToSvg));
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

test('export size estimates bound the written terrain and drop with embellishments off', () => {
  const { Terrain } = LoadModules();
  const Global = Model.CreateGlobalMap({ nPanelHexes: 4, szTileScale: 'XL' });
  const Water = SvgExport.Estimate(Global, 'Hyz+-');
  assert.equal(Water.nTiles, Global.Topo.Panels['Hyz+-'].nTileCount);
  assert.equal(Water.nEmbellished, 0);
  for (const Type of Terrain.g_rgTerrains.filter((Item) => Item.Embellish)) {
    Global.rgnTerrain.fill(Type.nId);
    const Estimate = SvgExport.Estimate(Global, 'Hyz+-');
    assert.equal(Estimate.nEmbellished, Estimate.nTiles, Type.szKey);
    assert.ok(Estimate.nBytes >= SvgExport.Write(Global, { szPanel: 'Hyz+-' }).length, Type.szKey);
    assert.ok(SvgExport.Estimate(Global, 'Hyz+-', false).nBytes < Estimate.nBytes);
  }
  const Local = LocalMap();
  const LocalEstimate = SvgExport.Estimate(Local);
  assert.equal(LocalEstimate.nTiles, Local.nTiles);
  assert.equal(LocalEstimate.nEmbellished, [...Local.rgnTerrain].filter((nId) => Terrain.ById(nId).Embellish).length);
  const Coast = ShoreMap('channel');
  assert.ok(SvgExport.Estimate(Coast, 'local', false).nBytes
    >= SvgExport.Write(Coast, { Layers: { embellishment: false } }).length, 'curved coast geometry is included');
  assert.throws(() => SvgExport.Estimate(Global, 'nowhere'));
});
