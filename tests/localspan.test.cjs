'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Lattice, Topology, Coordinates, Model, View, Edit, FileFormat, Regions, SvgExport } = LoadModules();

const g_dMilesPerEdge = Projection.MilesPerEdge(Topology.g_nDefaultPanelHexes);

// A local map anchored at (dEast, dNorth) edge units in szPanel's frame.
function SpanMap(szPanel, dEast, dNorth, nWidth, nHeight, szScale = 'L', Extra = {}) {
  return Model.CreateLocalMap({
    nWidth, nHeight, szSystem: 'regional', szScale,
    Anchor: Coordinates.MakeLocation(szPanel, dEast * g_dMilesPerEdge, dNorth * g_dMilesPerEdge), ...Extra,
  });
}

// Every tile sits on its own panel's global lattice of the same scale, so the grid turns
// to follow each panel: the map looks bent where it meets a seam.
function AssertPanelLattices(Doc) {
  const nRatio = Lattice.ScaleRatio('regional', 'XL', Doc.Local.szScale);
  for (const Tile of Doc.Topo.rgTiles) {
    const Info = Topology.PanelLattice(Tile.szPanel, Doc.Local.nPanelHexes, nRatio);
    const [nQ, nJ] = Topology.LatticeNearest(Info, Tile.rgdCenter[0], Tile.rgdCenter[1]);
    assert.ok(Util.Distance(Topology.LatticeCenter(Info, nQ, nJ), Tile.rgdCenter) < 1e-9, `tile ${Tile.nIndex} is off its panel lattice`);
  }
}

function AssertAdjacentAcross(Doc, szA, szB) {
  const fFound = Doc.Topo.rgTiles.some((Tile) => Tile.szPanel === szA
    && Array.from(Topology.Neighbors(Doc.Topo, Tile.nIndex)).some((nOther) => Doc.Topo.rgTiles[nOther].szPanel === szB));
  assert.ok(fFound, `no ${szA} tile is adjacent to a ${szB} tile`);
}

test('a regional map crossing an equatorial east/west seam keeps whole edge hexes on each side', () => {
  const Doc = SpanMap('Hyz+-', 0.6, 0.2, 30, 10);
  assert.ok(Doc.Topo && Doc.Topo.Span, 'the map spans panels');
  assert.deepEqual([...Doc.Topo.rgszPanels].sort(), ['Hxy++', 'Hyz+-']);
  assert.equal(Doc.nTiles, 30 * 10, 'equatorial seams cut no tiles');
  assert.ok(Doc.Topo.rgTiles.every((Tile) => !Tile.rgPieces));
  AssertPanelLattices(Doc);
  AssertAdjacentAcross(Doc, 'Hyz+-', 'Hxy++');
});

test('a regional map crossing a non-equatorial seam crops partial tiles as the global map does', () => {
  const Doc = SpanMap('Hxz+-', 0.45, 0.3, 40, 30);
  assert.deepEqual([...Doc.Topo.rgszPanels].sort(), ['Hxz+-', 'Sx+']);
  assert.ok(Doc.Topo.rgTiles.some((Tile) => Tile.rgPieces), 'seam tiles are clipped to their panel');
  AssertPanelLattices(Doc);
  AssertAdjacentAcross(Doc, 'Hxz+-', 'Sx+');
  const Flat = SpanMap('Hxz+-', 0.45, 0.3, 40, 30, 'L', { fFlat: true });
  assert.equal(Flat.Topo, null);
  assert.equal(Flat.nTiles, 40 * 30);
});

test('a local map may cross several panel seams', () => {
  const Doc = SpanMap('Hyz+-', 0, 0, 40, 3, 'XL');
  assert.deepEqual([...Doc.Topo.rgszPanels].sort(), ['Hxy++', 'Hxz++', 'Hyz+-']);
  AssertPanelLattices(Doc);
  AssertAdjacentAcross(Doc, 'Hyz+-', 'Hxy++');
  AssertAdjacentAcross(Doc, 'Hxy++', 'Hxz++');
});

test('a local map stops short of panel corner vertices instead of tearing around them', () => {
  const Doc = SpanMap('Hxz+-', 0.45, 0.5, 60, 60);
  assert.deepEqual([Doc.Local.nWidth, Doc.Local.nHeight], [29, 60]);
  const Other = SpanMap('Hyz+-', 0.5, 0.6, 20, 6, 'XL');
  assert.deepEqual([Other.Local.nWidth, Other.Local.nHeight], [5, 6]);
  assert.deepEqual(Coordinates.PreviewLocalSpan({
    nWidth: 20, nHeight: 6, szSystem: 'regional', szScale: 'XL',
    Anchor: Coordinates.MakeLocation('Hyz+-', 0.5 * g_dMilesPerEdge, 0.6 * g_dMilesPerEdge),
  }), { nWidth: 5, nHeight: 6, rgszPanels: ['Hyz+-', 'Hxz+-'] });
  // No two kept panels may meet only at a vertex inside the map.
  const Built = Projection.Build();
  for (const Probe of [Doc, Other]) {
    if (!Probe.Topo) {
      continue;
    }
    const Panels = new Set(Probe.Topo.rgszPanels);
    for (const szVertex of Object.keys(Built.Vertices)) {
      const rgszAround = Built.Seams.filter((Seam) => Seam.rgszVertices.includes(szVertex))
        .flatMap((Seam) => [Seam.szPanelA, Seam.szPanelB]).filter((szPanel) => Panels.has(szPanel));
      assert.ok(new Set(rgszAround).size <= 2, `the map wraps around vertex ${szVertex}`);
    }
  }
});

test('yard-scale maps and maps inside one panel stay flat', () => {
  const Yard = Model.CreateLocalMap({
    nWidth: 100, nHeight: 10, szSystem: 'local', szScale: 'XL',
    Anchor: Coordinates.MakeLocation('Hyz+-', 0.8795 * g_dMilesPerEdge - 5, 0),
  });
  assert.equal(Yard.Topo, null);
  assert.equal(Yard.nTiles, 1000);
  const Inside = SpanMap('Hxz+-', 0, 0, 10, 10, 'M');
  assert.equal(Inside.Topo, null);
});

test('span maps write [panel] sections canonically and legacy [local] files stay flat', () => {
  const Doc = SpanMap('Hyz+-', 0.6, 0.2, 30, 10);
  Model.SetTerrain(Doc, 0, 3);
  Model.SetTerrain(Doc, Doc.nTiles - 1, 5);
  const nLast = Doc.nTiles - 1;
  Model.AddOverlay(Doc, { szType: 'road', rgnTiles: Edit.FindPath(Doc, 0, nLast) });
  const szText = FileFormat.Write(Doc);
  assert.match(szText, /\n\[panel /);
  assert.doesNotMatch(szText, /\n\[local\]/);
  const Parsed = FileFormat.Parse(szText);
  assert.ok(Parsed.Topo && Parsed.Topo.Span);
  assert.equal(Parsed.nTiles, Doc.nTiles);
  assert.deepEqual(Array.from(Parsed.rgnTerrain), Array.from(Doc.rgnTerrain));
  assert.equal(FileFormat.Write(Parsed), szText, 'write → parse → write is byte-identical');

  const Flat = SpanMap('Hyz+-', 0.6, 0.2, 30, 10, 'L', { fFlat: true });
  const szFlat = FileFormat.Write(Flat);
  assert.match(szFlat, /\n\[local\]/);
  const ParsedFlat = FileFormat.Parse(szFlat);
  assert.equal(ParsedFlat.Topo, null);
  assert.equal(FileFormat.Write(ParsedFlat), szFlat);
});

test('span maps hit-test every tile and lay out one placement per panel', () => {
  const Doc = SpanMap('Hxz+-', 0.45, 0.3, 40, 30);
  const Geometry = View.MapGeometry(Doc);
  const Layout = View.MapLayout(Doc);
  assert.equal(Layout.szMode, 'span');
  assert.deepEqual(Layout.rgPlacements.map((Placement) => Placement.szPanel).sort(), [...Doc.Topo.rgszPanels].sort());
  for (const Tile of Geometry.rgTiles) {
    const Placement = View.FindPlacement(Layout, Tile.szPanel);
    const rgdWorld = Projection.ApplyTransform(Placement.rgdFrameToWorld, View.FeatureAnchor(Geometry, Tile.nIndex));
    assert.equal(View.HitTest(Geometry, Layout, rgdWorld).nTile, Tile.nIndex);
  }
});

test('span maps export SVG and regions for the whole map', () => {
  const Doc = SpanMap('Hyz+-', 0, 0, 40, 3, 'XL');
  for (let nTile = 0; nTile < Doc.nTiles; nTile += 2) {
    Model.SetTerrain(Doc, nTile, 4);
  }
  const Built = Regions.Build(Doc, 'local');
  assert.ok(Built.rgRegions.length > 0);
  const szSvg = SvgExport.Write(Doc, { szPanel: 'local', nWidth: 800 });
  assert.match(szSvg, /^<\?xml|^<svg/);
  assert.match(szSvg, /<\/svg>\s*$/);
});
