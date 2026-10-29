'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { g_szRepositoryRoot, LoadModules } = require('./_load.cjs');

const { Util, Projection } = LoadModules();
const g_Golden = JSON.parse(fs.readFileSync(
  path.join(g_szRepositoryRoot, 'doc', 'equilateral-chamfered-cube.json'), 'utf8'));
const g_dTolerance = 1e-9;
const g_Built = Projection.Build();

// Deep comparison with numeric tolerance; arrays and objects must match key for key.
function AssertMatches(Actual, Expected, szPath = '') {
  if (typeof Expected === 'number') {
    assert.equal(typeof Actual, 'number', `${szPath} must be a number`);
    assert.ok(Math.abs(Actual - Expected) <= g_dTolerance, `${szPath}: ${Actual} != ${Expected}`);
  } else if (Array.isArray(Expected)) {
    assert.ok(Array.isArray(Actual), `${szPath} must be an array`);
    assert.equal(Actual.length, Expected.length, `${szPath} length`);
    Expected.forEach((Item, nIndex) => AssertMatches(Actual[nIndex], Item, `${szPath}[${nIndex}]`));
  } else if (Expected !== null && typeof Expected === 'object') {
    assert.deepEqual(Object.keys(Actual), Object.keys(Expected), `${szPath} keys`);
    for (const szKey of Object.keys(Expected)) {
      AssertMatches(Actual[szKey], Expected[szKey], `${szPath}.${szKey}`);
    }
  } else {
    assert.equal(Actual, Expected, szPath);
  }
}

function AssertPointClose(rgdActual, rgdExpected, szMessage, dTolerance = g_dTolerance) {
  assert.ok(Util.Distance(rgdActual, rgdExpected) <= dTolerance,
    `${szMessage}: [${rgdActual}] != [${rgdExpected}]`);
}

test('solid matches the golden JSON', () => {
  AssertMatches(
    Object.entries(g_Built.Vertices).map(([szId, rgdPoint]) => ({ id: szId, position: rgdPoint })),
    g_Golden.solid.vertices, 'solid.vertices');
  AssertMatches(Object.values(g_Built.Edges), g_Golden.solid.edges, 'solid.edges');
  AssertMatches(Object.values(g_Built.Faces), g_Golden.solid.faces, 'solid.faces');
});

test('net matches the golden JSON', () => {
  AssertMatches(Object.values(g_Built.NetVertices), g_Golden.net.vertices, 'net.vertices');
  AssertMatches(Object.values(g_Built.NetEdges), g_Golden.net.edges, 'net.edges');
  AssertMatches(Object.values(g_Built.NetFaces), g_Golden.net.faces, 'net.faces');
  assert.deepEqual(g_Built.rgszStrip, g_Golden.net.strip_left_to_right);
});

test('validation passes and matches the golden summary', () => {
  AssertMatches(g_Built.Validation, g_Golden.validation, 'validation');
  const rgnCuts = Object.values(g_Built.NetEdges).filter((Edge) => Edge.kind === 'cut').length;
  assert.equal(rgnCuts / 2, 31);
});

test('Build is cached and immutable', () => {
  assert.equal(Projection.Build(), g_Built);
  assert.ok(Object.isFrozen(g_Built.Frames['Hxz+-'].rgdEast3D));
  assert.ok(Object.isFrozen(g_Built.NetVertices.N01.position));
});

test('sector labels and names cover all 18 panels', () => {
  const rgPanels = Object.values(g_Built.Panels);
  assert.equal(rgPanels.length, 18);
  assert.equal(new Set(rgPanels.map((Panel) => Panel.szName)).size, 18);
  const Names = Object.fromEntries(rgPanels.map((Panel) => [Panel.szName, Panel]));
  assert.equal(Names.Eta.szId, 'Hxz+-');
  assert.equal(Names.Nu.szKind, 'square');
});

test('frames are orthonormal, right-handed from outside, and place panels in the net', () => {
  for (const [szId, Frame] of Object.entries(g_Built.Frames)) {
    const { rgdEast3D, rgdNorth3D, rgdNormal3D } = Frame;
    for (const rgdAxis of [rgdEast3D, rgdNorth3D]) {
      assert.ok(Math.abs(Util.Length(rgdAxis) - 1) < g_dTolerance, `${szId} unit axis`);
      assert.ok(Math.abs(Util.Dot(rgdAxis, rgdNormal3D)) < g_dTolerance, `${szId} in-plane axis`);
    }
    assert.ok(Math.abs(Util.Dot(rgdEast3D, rgdNorth3D)) < g_dTolerance, `${szId} orthogonal`);
    AssertPointClose(rgdEast3D, Util.Cross(rgdNorth3D, rgdNormal3D), `${szId} east = north x normal`);
    AssertPointClose(Util.Center(Frame.rgrgdPolygon), [0, 0], `${szId} origin at panel centre`);
    assert.ok(Math.abs(Util.Dot(Frame.rgdEastNet, Frame.rgdNorthNet)) < g_dTolerance);
    assert.ok(Frame.rgdEastNet[0] * Frame.rgdNorthNet[1] - Frame.rgdEastNet[1] * Frame.rgdNorthNet[0] > 0,
      `${szId} net placement must not reflect`);
    const NetFace = g_Built.NetFaces[szId];
    Frame.rgrgdPolygon.forEach((rgdPoint, nIndex) => {
      const rgdNet = g_Built.NetVertices[NetFace.vertices[nIndex]].position;
      AssertPointClose(Projection.ApplyTransform(Frame.rgdFrameToNet, rgdPoint), rgdNet, `${szId} placement`);
      AssertPointClose(Projection.ApplyTransform(Frame.rgdNetToFrame, rgdNet), rgdPoint, `${szId} inverse`);
      const rgdSolid = g_Built.Vertices[Frame.rgszVertices[nIndex]];
      AssertPointClose(Projection.FrameToSolid(Frame, rgdPoint), rgdSolid, `${szId} back to solid`);
    });
  }
});

test('equatorial panels: north is +y in the net, on one equator, west to east', () => {
  const rgszEquatorial = g_Built.rgszEquatorialWestToEast;
  assert.deepEqual(rgszEquatorial.map((szId) => g_Built.Panels[szId].szName),
    ['Epsilon', 'Delta', 'Gamma', 'Beta', 'Alpha', 'Zeta']);
  assert.equal(Object.values(g_Built.Panels).filter((Panel) => Panel.fEquatorial).length, 6);
  for (const szId of rgszEquatorial) {
    const Frame = g_Built.Frames[szId];
    AssertPointClose(Frame.rgdNorth3D, Projection.g_North, `${szId} panel north is true north`);
    AssertPointClose(Frame.rgdNorthNet, [0, 1], `${szId} north is +y`);
    AssertPointClose(Frame.rgdEastNet, [1, 0], `${szId} east is +x`);
    assert.ok(Math.abs(Frame.rgdOriginNet[1] - 0.122008) < 1e-6, `${szId} equator`);
    assert.equal(Frame.szNorthVertex, null);
    // Two edges run north-south, one at each east/west extreme.
    const rgdEast = Frame.rgrgdPolygon.map((rgdPoint) => rgdPoint[0]);
    const dHalf = g_Built.dEquatorialWidth / 2;
    assert.ok(Math.abs(Math.max(...rgdEast) - dHalf) < g_dTolerance);
    assert.ok(Math.abs(Math.min(...rgdEast) + dHalf) < g_dTolerance);
    assert.equal(rgdEast.filter((dValue) => Math.abs(Math.abs(dValue) - dHalf) < g_dTolerance).length, 4);
  }
  assert.ok(Math.abs(g_Built.dEquatorialWidth - 1.759306) < 1e-6);
});

test('other panels: north runs through opposite north and south vertices', () => {
  const Expected = { Eta: 'V05', Theta: 'V05', Iota: 'V05', Kappa: 'V04', Lambda: 'V04', Mu: 'V04' };
  for (const Panel of Object.values(g_Built.Panels).filter((Item) => !Item.fEquatorial)) {
    const { Frame } = Panel;
    const dAlong = Util.Dot(Projection.g_North, Frame.rgdNormal3D);
    const rgdProjected = Util.Unit(Util.Subtract(Projection.g_North, Util.Scale(Frame.rgdNormal3D, dAlong)));
    AssertPointClose(Frame.rgdNorth3D, rgdProjected, `${Panel.szName} projected north`);
    const nNorth = Frame.rgszVertices.indexOf(Frame.szNorthVertex);
    const nSouth = Frame.rgszVertices.indexOf(Frame.szSouthVertex);
    assert.equal(Math.abs(nNorth - nSouth), Frame.rgszVertices.length / 2, `${Panel.szName} opposite vertices`);
    assert.ok(Math.abs(Frame.rgrgdPolygon[nNorth][0]) < g_dTolerance);
    assert.ok(Math.abs(Frame.rgrgdPolygon[nSouth][0]) < g_dTolerance);
    assert.ok(Frame.rgrgdPolygon[nNorth][1] > 0 && Frame.rgrgdPolygon[nSouth][1] < 0);
    if (Panel.szName in Expected) {
      assert.equal(Frame.szNorthVertex === Expected[Panel.szName] || Frame.szSouthVertex === Expected[Panel.szName],
        true, `${Panel.szName} pole vertex`);
    }
  }
  assert.equal(g_Built.Panels['Hxz+-'].Frame.szNorthVertex, 'V05');
  assert.equal(g_Built.Panels['Hxy-+'].Frame.szSouthVertex, 'V04');
});

test('seams: 48 proper isometries that unfold neighbours across the shared edge', () => {
  assert.equal(g_Built.Seams.length, 48);
  for (const Seam of g_Built.Seams) {
    const FrameA = g_Built.Frames[Seam.szPanelA];
    const FrameB = g_Built.Frames[Seam.szPanelB];
    const [a, b, c, d] = Seam.rgdAToB;
    assert.ok(Math.abs(a * d - b * c - 1) < g_dTolerance, `${Seam.szEdge} is a rotation`);
    const rgdRoundTrip = Projection.ComposeTransforms(Seam.rgdAToB, Seam.rgdBToA);
    AssertPointClose(rgdRoundTrip, [1, 0, 0, 1, 0, 0], `${Seam.szEdge} A→B→A is the identity`);
    for (const szVertex of Seam.rgszVertices) {
      const rgdSolid = g_Built.Vertices[szVertex];
      const rgdInA = Projection.SolidToFrame(FrameA, rgdSolid);
      const rgdInB = Projection.SolidToFrame(FrameB, rgdSolid);
      AssertPointClose(Projection.ApplyTransform(Seam.rgdAToB, rgdInA), rgdInB, `${Seam.szEdge} endpoint`);
    }
    // B's centre, unfolded into A, lies across the shared edge from A's centre.
    const [rgdStart, rgdEnd] = Seam.rgszVertices.map((szId) =>
      Projection.SolidToFrame(FrameA, g_Built.Vertices[szId]));
    const rgdDirection = Util.Subtract(rgdEnd, rgdStart);
    const Side = (rgdPoint) => {
      const rgdRelative = Util.Subtract(rgdPoint, rgdStart);
      return rgdDirection[0] * rgdRelative[1] - rgdDirection[1] * rgdRelative[0];
    };
    const rgdCenterB = Projection.ApplyTransform(Seam.rgdBToA, [0, 0]);
    assert.ok(Side([0, 0]) * Side(rgdCenterB) < 0, `${Seam.szEdge} unfolds to the far side`);
    // Folds in the net agree with the seam transforms.
    const NetFold = Object.values(g_Built.NetEdges).find((Edge) =>
      Edge.solid_edge === Seam.szEdge && Edge.kind === 'fold');
    if (NetFold) {
      const rgdNetAToB = Projection.ComposeTransforms(FrameA.rgdFrameToNet, FrameB.rgdNetToFrame);
      AssertPointClose(rgdNetAToB, Seam.rgdAToB, `${Seam.szEdge} matches the net fold`, 1e-9);
    }
  }
  assert.equal(Projection.FindSeam('Hxz+-', 'Hyz+-').szEdge,
    g_Built.Seams.find((Seam) => [Seam.szPanelA, Seam.szPanelB].sort().join() === ['Hxz+-', 'Hyz+-'].sort().join()).szEdge);
  assert.equal(Projection.FindSeam('Hxz+-', 'Hxy-+'), null);
});

test('equatorial strip wraps: Zeta continues into Epsilon with no rotation', () => {
  const rgszStrip = g_Built.rgszEquatorialWestToEast;
  for (let nIndex = 0; nIndex < rgszStrip.length; nIndex++) {
    const szWest = rgszStrip[nIndex];
    const szEast = rgszStrip[(nIndex + 1) % rgszStrip.length];
    const Seam = Projection.FindSeam(szWest, szEast);
    assert.ok(Seam, `${szWest} borders ${szEast}`);
    const rgdWestToEast = Seam.szPanelA === szWest ? Seam.rgdAToB : Seam.rgdBToA;
    AssertPointClose(rgdWestToEast.slice(0, 4), [1, 0, 0, 1], `${szWest}→${szEast} keeps north`);
    assert.ok(Math.abs(rgdWestToEast[4] + g_Built.dEquatorialWidth) < g_dTolerance);
    assert.ok(Math.abs(rgdWestToEast[5]) < g_dTolerance, 'the equator is continuous');
  }
});

test('MilesPerEdge follows the XL panel size', () => {
  const dMiles = Projection.MilesPerEdge(24);
  assert.ok(Math.abs(dMiles * g_Built.dEquatorialWidth - 24 * 216 * Math.sqrt(3) / 2) < 1e-6);
  assert.ok(Math.abs(dMiles - 2551.8) < 0.1);
  assert.ok(Math.abs(dMiles * g_Built.dEquatorialWidth * 6 - 26900) < 100, 'equatorial circumference');
  assert.throws(() => Projection.MilesPerEdge(23), /even/);
});

test('transform helpers compose and invert', () => {
  const rgdT = Projection.RigidFromSegments([0, 0], [1, 0], [2, 3], [2, 4]);
  AssertPointClose(Projection.ApplyTransform(rgdT, [1, 0]), [2, 4], 'rigid endpoint');
  AssertPointClose(Projection.ApplyTransform(rgdT, [0, 1]), [1, 3], 'rotated +90°');
  const rgdIdentity = Projection.ComposeTransforms(rgdT, Projection.InvertTransform(rgdT));
  AssertPointClose(rgdIdentity, [1, 0, 0, 1, 0, 0], 'inverse');
});
