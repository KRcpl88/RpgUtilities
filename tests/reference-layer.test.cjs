'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');
const { Util, Projection, Coordinates, Model, View, SvgExport } = LoadModules();

test('equator segments lie on zero latitude and polar markers lie at true north/south', () => {
  const Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  let nEquators = 0, nNorth = 0, nSouth = 0;
  for (const szPanel of Doc.Topo.rgszPanels) {
    const Reference = View.ReferenceGeometry(Doc, szPanel);
    const Frame = Projection.Build().Frames[szPanel];
    if (Frame.fEquatorial) {
      assert.equal(Reference.rgrgdEquator.length, 2);
      nEquators++;
    } else {
      assert.equal(Reference.rgrgdEquator.length, 0);
    }
    for (const Point of Reference.rgrgdEquator) {
      const True = Coordinates.TrueCoordinates(Coordinates.MakeLocation(szPanel,
        Point[0] * Doc.Topo.dMilesPerEdge, Point[1] * Doc.Topo.dMilesPerEdge), Doc.Topo.dMilesPerEdge);
      assert.ok(Math.abs(True.dLatitude) < 1e-8);
      assert.ok(Util.PointInConvex(Point, Frame.rgrgdPolygon));
    }
    for (const Pole of Reference.rgPoles) {
      const True = Coordinates.TrueCoordinates(Coordinates.MakeLocation(szPanel,
        Pole.rgdPoint[0] * Doc.Topo.dMilesPerEdge, Pole.rgdPoint[1] * Doc.Topo.dMilesPerEdge), Doc.Topo.dMilesPerEdge);
      assert.ok(Math.abs(True.dLatitude - (Pole.szLabel === 'N' ? 90 : -90)) < 1e-6);
      assert.ok(Util.PointInConvex(Pole.rgdPoint, Frame.rgrgdPolygon));
      if (Pole.szLabel === 'N') nNorth++;
      else nSouth++;
    }
  }
  assert.equal(nEquators, 6);
  assert.equal(nNorth, 3);
  assert.equal(nSouth, 3);
});

test('reference layer exports red equators and labeled crosshair circles and can be disabled', () => {
  for (const [szName, szReference] of [['Beta', 'equator'], ['Eta', 'pole-N'], ['Kappa', 'pole-S']]) {
    const Doc = Model.CreatePanelMap({ szPanel: Coordinates.PanelIdByName(szName), nPanelHexes: 4 });
    const Svg = SvgExport.Write(Doc);
    assert.match(Svg, /id="layer-reference"[^>]+stroke="#d32f2f"/);
    assert.ok(Svg.includes(`data-reference="${szReference}"`));
    if (szReference !== 'equator') {
      assert.match(Svg, /<circle[^>]+r="/);
      assert.ok(Svg.includes(`>${szReference.slice(-1)}</text>`));
      assert.match(Svg, /<path d="M[^"]+h[^"]+M[^"]+v/);
      const Size = SvgExport.Dimensions(Doc);
      const WithoutReferences = SvgExport.Dimensions(Doc, Doc.Global.szPanel, 1600, false);
      assert.ok(Size.dHeight > WithoutReferences.dHeight, 'polar symbols have space beyond the panel vertex');
      const Match = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/.exec(Svg);
      const [dX, dY, dRadius] = Match.slice(1).map(Number);
      assert.ok(dX - dRadius * 1.4 >= 0 && dX + dRadius * 1.4 <= Size.dWidth);
      assert.ok(dY - dRadius * 1.4 >= 0 && dY + dRadius * 1.4 <= Size.dHeight);
    }
    assert.doesNotMatch(SvgExport.Write(Doc, { Layers: { reference: false } }), /layer-reference|data-reference=/);
  }
});

test('local reference geometry uses the anchor frame and local hex units', () => {
  for (const szSystem of ['regional', 'local']) {
    const Doc = Model.CreateLocalMap({ nWidth: 7, nHeight: 6, szSystem, szScale: 'XL', nPanelHexes: 4,
      Anchor: Coordinates.ParseUniversal('Beta 0E 0N') });
    const Reference = View.ReferenceGeometry(Doc, 'local');
    assert.equal(Reference.rgrgdEquator.length, 2);
    for (const Point of Reference.rgrgdEquator) {
      assert.ok(Math.abs(Doc.Local.Anchor.dNorth + Point[1] * Doc.Local.dHexMiles) < 1e-8);
    }
    assert.match(SvgExport.Write(Doc), /data-reference="equator"/);
    assert.equal(Reference.rgPoles.length, 0);
  }
});
