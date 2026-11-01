'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPOSITORY_ROOT, loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection } = loadModules();
const goldenProjection = JSON.parse(fs.readFileSync(
  path.join(REPOSITORY_ROOT, 'doc', 'equilateral-chamfered-cube.json'), 'utf8'));
const TOLERANCE = 1e-9;
const builtProjection = projection.build();

// Deep comparison with numeric tolerance; arrays and objects must match key for key.
function assertMatches(actual, expected, path = '') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path} must be a number`);
    assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${path}: ${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} must be an array`);
    assert.equal(actual.length, expected.length, `${path} length`);
    expected.forEach((item, index) => assertMatches(actual[index], item, `${path}[${index}]`));
  } else if (expected !== null && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), `${path} keys`);
    for (const key of Object.keys(expected)) {
      assertMatches(actual[key], expected[key], `${path}.${key}`);
    }
  } else {
    assert.equal(actual, expected, path);
  }
}

function assertPointClose(actual, expected, message, tolerance = TOLERANCE) {
  assert.ok(util.pointDistance(actual, expected) <= tolerance,
    `${message}: [${actual}] != [${expected}]`);
}

test('solid matches the golden JSON', () => {
  assertMatches(
    Object.entries(builtProjection.vertices).map(([id, point]) => ({ id: id, position: point })),
    goldenProjection.solid.vertices, 'solid.vertices');
  assertMatches(Object.values(builtProjection.edges), goldenProjection.solid.edges, 'solid.edges');
  assertMatches(Object.values(builtProjection.faces), goldenProjection.solid.faces, 'solid.faces');
});

test('net matches the golden JSON', () => {
  assertMatches(Object.values(builtProjection.netVertices), goldenProjection.net.vertices, 'net.vertices');
  assertMatches(Object.values(builtProjection.netEdges), goldenProjection.net.edges, 'net.edges');
  assertMatches(Object.values(builtProjection.netFaces), goldenProjection.net.faces, 'net.faces');
  assert.deepEqual(builtProjection.strip, goldenProjection.net.strip_left_to_right);
});

test('validation passes and matches the golden summary', () => {
  assertMatches(builtProjection.validation, goldenProjection.validation, 'validation');
  const cuts = Object.values(builtProjection.netEdges).filter((edge) => edge.kind === 'cut').length;
  assert.equal(cuts / 2, 31);
});

test('Build is cached and immutable', () => {
  assert.equal(projection.build(), builtProjection);
  assert.ok(Object.isFrozen(builtProjection.frames['Hxz+-'].east3D));
  assert.ok(Object.isFrozen(builtProjection.netVertices.N01.position));
});

test('sector labels and names cover all 18 panels', () => {
  const panels = Object.values(builtProjection.panels);
  assert.equal(panels.length, 18);
  assert.equal(new Set(panels.map((panel) => panel.name)).size, 18);
  const names = Object.fromEntries(panels.map((panel) => [panel.name, panel]));
  assert.equal(names.Eta.id, 'Hxz+-');
  assert.equal(names.Nu.kind, 'square');
});

test('frames are orthonormal, right-handed from outside, and place panels in the net', () => {
  for (const [id, frame] of Object.entries(builtProjection.frames)) {
    const { east3D, north3D, normal3D } = frame;
    for (const axis of [east3D, north3D]) {
      assert.ok(Math.abs(util.vectorLength(axis) - 1) < TOLERANCE, `${id} unit axis`);
      assert.ok(Math.abs(util.dot(axis, normal3D)) < TOLERANCE, `${id} in-plane axis`);
    }
    assert.ok(Math.abs(util.dot(east3D, north3D)) < TOLERANCE, `${id} orthogonal`);
    assertPointClose(east3D, util.cross(north3D, normal3D), `${id} east = north x normal`);
    assertPointClose(util.center(frame.polygon), [0, 0], `${id} origin at panel centre`);
    assert.ok(Math.abs(util.dot(frame.eastNet, frame.northNet)) < TOLERANCE);
    assert.ok(frame.eastNet[0] * frame.northNet[1] - frame.eastNet[1] * frame.northNet[0] > 0,
      `${id} net placement must not reflect`);
    const netFace = builtProjection.netFaces[id];
    frame.polygon.forEach((point, index) => {
      const net = builtProjection.netVertices[netFace.vertices[index]].position;
      assertPointClose(projection.applyTransform(frame.frameToNet, point), net, `${id} placement`);
      assertPointClose(projection.applyTransform(frame.netToFrame, net), point, `${id} inverse`);
      const solid = builtProjection.vertices[frame.vertexIds[index]];
      assertPointClose(projection.frameToSolid(frame, point), solid, `${id} back to solid`);
    });
  }
});

test('equatorial panels: north is +y in the net, on one equator, west to east', () => {
  const equatorialIds = builtProjection.equatorialWestToEast;
  assert.deepEqual(equatorialIds.map((id) => builtProjection.panels[id].name),
    ['Epsilon', 'Delta', 'Gamma', 'Beta', 'Alpha', 'Zeta']);
  assert.equal(Object.values(builtProjection.panels).filter((panel) => panel.isEquatorial).length, 6);
  for (const id of equatorialIds) {
    const frame = builtProjection.frames[id];
    assertPointClose(frame.north3D, projection.NORTH, `${id} panel north is true north`);
    assertPointClose(frame.northNet, [0, 1], `${id} north is +y`);
    assertPointClose(frame.eastNet, [1, 0], `${id} east is +x`);
    assert.ok(Math.abs(frame.originNet[1] - 0.122008) < 1e-6, `${id} equator`);
    assert.equal(frame.northVertex, null);
    // Two edges run north-south, one at each east/west extreme.
    const east = frame.polygon.map((point) => point[0]);
    const half = builtProjection.equatorialWidth / 2;
    assert.ok(Math.abs(Math.max(...east) - half) < TOLERANCE);
    assert.ok(Math.abs(Math.min(...east) + half) < TOLERANCE);
    assert.equal(east.filter((value) => Math.abs(Math.abs(value) - half) < TOLERANCE).length, 4);
  }
  assert.ok(Math.abs(builtProjection.equatorialWidth - 1.759306) < 1e-6);
});

test('other panels: north runs through opposite north and south vertices', () => {
  const expected = { Eta: 'V05', Theta: 'V05', Iota: 'V05', Kappa: 'V04', Lambda: 'V04', Mu: 'V04' };
  for (const panel of Object.values(builtProjection.panels).filter((item) => !item.isEquatorial)) {
    const { frame } = panel;
    const along = util.dot(projection.NORTH, frame.normal3D);
    const projected = util.unit(util.subtract(projection.NORTH, util.scale(frame.normal3D, along)));
    assertPointClose(frame.north3D, projected, `${panel.name} projected north`);
    const north = frame.vertexIds.indexOf(frame.northVertex);
    const south = frame.vertexIds.indexOf(frame.southVertex);
    assert.equal(Math.abs(north - south), frame.vertexIds.length / 2, `${panel.name} opposite vertices`);
    assert.ok(Math.abs(frame.polygon[north][0]) < TOLERANCE);
    assert.ok(Math.abs(frame.polygon[south][0]) < TOLERANCE);
    assert.ok(frame.polygon[north][1] > 0 && frame.polygon[south][1] < 0);
    if (panel.name in expected) {
      assert.equal(frame.northVertex === expected[panel.name] || frame.southVertex === expected[panel.name],
        true, `${panel.name} pole vertex`);
    }
  }
  assert.equal(builtProjection.panels['Hxz+-'].frame.northVertex, 'V05');
  assert.equal(builtProjection.panels['Hxy-+'].frame.southVertex, 'V04');
});

test('seams: 48 proper isometries that unfold neighbours across the shared edge', () => {
  assert.equal(builtProjection.seams.length, 48);
  for (const seam of builtProjection.seams) {
    const frameA = builtProjection.frames[seam.panelA];
    const frameB = builtProjection.frames[seam.panelB];
    const [a, b, c, d] = seam.aToB;
    assert.ok(Math.abs(a * d - b * c - 1) < TOLERANCE, `${seam.edge} is a rotation`);
    const roundTrip = projection.composeTransforms(seam.aToB, seam.bToA);
    assertPointClose(roundTrip, [1, 0, 0, 1, 0, 0], `${seam.edge} A→B→A is the identity`);
    for (const vertexId of seam.vertexIds) {
      const solid = builtProjection.vertices[vertexId];
      const inA = projection.solidToFrame(frameA, solid);
      const inB = projection.solidToFrame(frameB, solid);
      assertPointClose(projection.applyTransform(seam.aToB, inA), inB, `${seam.edge} endpoint`);
    }
    // B's centre, unfolded into A, lies across the shared edge from A's centre.
    const [startPoint, end] = seam.vertexIds.map((id) =>
      projection.solidToFrame(frameA, builtProjection.vertices[id]));
    const direction = util.subtract(end, startPoint);
    const side = (point) => {
      const relative = util.subtract(point, startPoint);
      return direction[0] * relative[1] - direction[1] * relative[0];
    };
    const centerB = projection.applyTransform(seam.bToA, [0, 0]);
    assert.ok(side([0, 0]) * side(centerB) < 0, `${seam.edge} unfolds to the far side`);
    // Folds in the net agree with the seam transforms.
    const netFold = Object.values(builtProjection.netEdges).find((edge) =>
      edge.solid_edge === seam.edge && edge.kind === 'fold');
    if (netFold) {
      const netAToB = projection.composeTransforms(frameA.frameToNet, frameB.netToFrame);
      assertPointClose(netAToB, seam.aToB, `${seam.edge} matches the net fold`, 1e-9);
    }
  }
  assert.equal(projection.findSeam('Hxz+-', 'Hyz+-').edge,
    builtProjection.seams.find((seam) => [seam.panelA, seam.panelB].sort().join() === ['Hxz+-', 'Hyz+-'].sort().join()).edge);
  assert.equal(projection.findSeam('Hxz+-', 'Hxy-+'), null);
});

test('equatorial strip wraps: Zeta continues into Epsilon with no rotation', () => {
  const strip = builtProjection.equatorialWestToEast;
  for (let index = 0; index < strip.length; index++) {
    const westPanel = strip[index];
    const eastPanel = strip[(index + 1) % strip.length];
    const seam = projection.findSeam(westPanel, eastPanel);
    assert.ok(seam, `${westPanel} borders ${eastPanel}`);
    const westToEast = seam.panelA === westPanel ? seam.aToB : seam.bToA;
    assertPointClose(westToEast.slice(0, 4), [1, 0, 0, 1], `${westPanel}→${eastPanel} keeps north`);
    assert.ok(Math.abs(westToEast[4] + builtProjection.equatorialWidth) < TOLERANCE);
    assert.ok(Math.abs(westToEast[5]) < TOLERANCE, 'the equator is continuous');
  }
});

test('MilesPerEdge follows the XL panel size', () => {
  const miles = projection.getMilesPerEdge(24);
  assert.ok(Math.abs(miles * builtProjection.equatorialWidth - 24 * 216 * Math.sqrt(3) / 2) < 1e-6);
  assert.ok(Math.abs(miles - 2551.8) < 0.1);
  assert.ok(Math.abs(miles * builtProjection.equatorialWidth * 6 - 26900) < 100, 'equatorial circumference');
  assert.throws(() => projection.getMilesPerEdge(23), /even/);
});

test('transform helpers compose and invert', () => {
  const t = projection.rigidFromSegments([0, 0], [1, 0], [2, 3], [2, 4]);
  assertPointClose(projection.applyTransform(t, [1, 0]), [2, 4], 'rigid endpoint');
  assertPointClose(projection.applyTransform(t, [0, 1]), [1, 3], 'rotated +90°');
  const identity = projection.composeTransforms(t, projection.invertTransform(t));
  assertPointClose(identity, [1, 0, 0, 1, 0, 0], 'inverse');
});
