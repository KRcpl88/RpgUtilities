'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Projection, Coordinates, Model } = LoadModules();
const g_Built = Projection.Build();
const g_dEdgeMiles = Projection.MilesPerEdge(24);

function TrueAtFrame(szPanel, rgdFrame) {
  return Coordinates.TrueCoordinates(Coordinates.MakeLocation(szPanel, rgdFrame[0] * g_dEdgeMiles, rgdFrame[1] * g_dEdgeMiles), g_dEdgeMiles);
}

function LongitudeDelta(dA, dB) {
  return ((dB - dA + 540) % 360) - 180;
}

test('panel centres: eta on the prime meridian, equatorial panels clockwise (westward) from it', () => {
  const Eta = TrueAtFrame(Coordinates.PanelIdByName('Eta'), [0, 0]);
  assert.ok(Math.abs(Eta.dLongitude) < 1e-9);
  assert.ok(Math.abs(Eta.dLatitude - Math.atan(Math.SQRT2) * 180 / Math.PI) < 1e-9);
  const Expected = { Alpha: -30, Beta: -90, Gamma: -150, Delta: 150, Epsilon: 90, Zeta: 30 };
  for (const [szName, dLongitude] of Object.entries(Expected)) {
    const True = TrueAtFrame(Coordinates.PanelIdByName(szName), [0, 0]);
    assert.ok(Math.abs(True.dLatitude) < 1e-9, szName);
    assert.ok(Math.abs(LongitudeDelta(True.dLongitude, dLongitude)) < 1e-9, `${szName} ${True.dLongitude}`);
  }
  for (const [szName, dSign] of [['Theta', 1], ['Iota', 1], ['Kappa', -1], ['Lambda', -1], ['Mu', -1]]) {
    assert.equal(Math.sign(TrueAtFrame(Coordinates.PanelIdByName(szName), [0, 0]).dLatitude), dSign, szName);
  }
});

test('the polar vertices are at ±90° latitude from every panel that touches them', () => {
  for (const [szVertex, rgdVertex] of Object.entries(g_Built.Vertices)) {
    const dSin = Util.Dot(Util.Unit(rgdVertex), Projection.g_North);
    if (Math.abs(Math.abs(dSin) - 1) > 1e-9) {
      continue;
    }
    const rgszFaces = Object.values(g_Built.Faces).filter((Face) => Face.vertices.includes(szVertex)).map((Face) => Face.id);
    assert.equal(rgszFaces.length, 3);
    for (const szPanel of rgszFaces) {
      const True = TrueAtFrame(szPanel, Projection.SolidToFrame(g_Built.Frames[szPanel], rgdVertex));
      assert.ok(Math.abs(Math.abs(True.dLatitude) - 90) < 1e-6);
      assert.equal(True.dNorthBearing, null);
    }
  }
});

test('equatorial panels: the panel equator is the true equator and true north is panel north', () => {
  for (const szPanel of g_Built.rgszEquatorialWestToEast) {
    for (const rgdFrame of [[-0.4, 0], [0.3, 0], [0.2, 0.5], [-0.3, -0.6]]) {
      const True = TrueAtFrame(szPanel, rgdFrame);
      if (rgdFrame[1] === 0) {
        assert.ok(Math.abs(True.dLatitude) < 1e-9);
      }
      assert.ok(Math.abs(True.dNorthBearing) < 1e-9);
    }
  }
});

test('true coordinates are continuous across every seam', () => {
  for (const Edge of Object.values(g_Built.Edges)) {
    const [rgdA, rgdB] = Edge.vertices.map((szId) => g_Built.Vertices[szId]);
    for (const dT of [0.2, 0.5, 0.8]) {
      const rgdPoint = rgdA.map((dValue, nAxis) => dValue + (rgdB[nAxis] - dValue) * dT);
      const [First, Second] = Edge.faces.map((szPanel) => TrueAtFrame(szPanel, Projection.SolidToFrame(g_Built.Frames[szPanel], rgdPoint)));
      assert.ok(Math.abs(First.dLatitude - Second.dLatitude) < 1e-9, Edge.id);
      assert.ok(Math.abs(LongitudeDelta(First.dLongitude, Second.dLongitude)) < 1e-9, Edge.id);
    }
  }
});

test('true longitude grows eastward, latitude northward, and the bearing points along the meridian', () => {
  const dStep = 1e-4;
  for (const szPanel of Object.keys(g_Built.Frames)) {
    for (const rgdFrame of [[0, 0], [0.35, 0.2], [-0.25, -0.3]]) {
      const True = TrueAtFrame(szPanel, rgdFrame);
      const East = TrueAtFrame(szPanel, [rgdFrame[0] + dStep, rgdFrame[1]]);
      const North = TrueAtFrame(szPanel, [rgdFrame[0], rgdFrame[1] + dStep]);
      assert.ok(LongitudeDelta(True.dLongitude, East.dLongitude) > 0, szPanel);
      assert.ok(North.dLatitude > True.dLatitude, szPanel);
      const dRadians = True.dNorthBearing * Math.PI / 180;
      const Along = TrueAtFrame(szPanel, [rgdFrame[0] + dStep * Math.sin(dRadians), rgdFrame[1] + dStep * Math.cos(dRadians)]);
      assert.ok(Along.dLatitude > True.dLatitude, szPanel);
      assert.ok(Math.abs(LongitudeDelta(True.dLongitude, Along.dLongitude)) < 1e-9, `${szPanel} ${rgdFrame}`);
    }
  }
});

test('Model.TrueCoordinates covers global tiles and local maps via their anchor', () => {
  const Global = Model.CreateGlobalMap({ nPanelHexes: 4, szTileScale: 'XL' });
  const nTile = 7;
  const Expected = Coordinates.TrueCoordinates(Model.TileToUniversal(Global, nTile), Global.Topo.dMilesPerEdge);
  assert.deepEqual(Model.TrueCoordinates(Global, nTile), Expected);
  const Local = Model.CreateLocalMap({ nWidth: 5, nHeight: 4, szSystem: 'regional', szScale: 'M', Anchor: Coordinates.ParseUniversal('Alpha 100E 50N') });
  assert.deepEqual(Model.TrueCoordinates(Local, 0), Coordinates.TrueCoordinates(Local.Local.Anchor, Projection.MilesPerEdge(24)));
  const Far = Model.TrueCoordinates(Local, 19);
  assert.ok(Far.dLatitude < Model.TrueCoordinates(Local, 0).dLatitude);
  assert.ok(Far.dLongitude > Model.TrueCoordinates(Local, 0).dLongitude);
});

test('format true coordinates and choose decimals from the hex size', () => {
  assert.equal(Coordinates.FormatTrue({ dLatitude: 35.26439, dLongitude: -30 }, 2), '35.26°N 30.00°W');
  assert.equal(Coordinates.FormatTrue({ dLatitude: -0.0001, dLongitude: 0.0001 }, 2), '0.00°N 0.00°E');
  assert.equal(Coordinates.TrueDecimals(216, g_dEdgeMiles), 1);
  assert.ok(Coordinates.TrueDecimals(0.01, g_dEdgeMiles) > Coordinates.TrueDecimals(6, g_dEdgeMiles));
  assert.ok(Coordinates.TrueDecimals(1e-9, g_dEdgeMiles) <= 9);
});
