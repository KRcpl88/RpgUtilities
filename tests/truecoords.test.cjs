'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection, Coordinates: coordinates, Model: model } = loadModules();
const builtProjection = projection.build();
const EDGE_MILES = projection.getMilesPerEdge(24);

function trueAtFrame(panelId, framePoint) {
  return coordinates.trueCoordinates(coordinates.makeLocation(panelId, framePoint[0] * EDGE_MILES, framePoint[1] * EDGE_MILES), EDGE_MILES);
}

function longitudeDelta(componentA, componentB) {
  return ((componentB - componentA + 540) % 360) - 180;
}

test('panel centres: eta on the prime meridian, equatorial panels clockwise (westward) from it', () => {
  const eta = trueAtFrame(coordinates.panelIdByName('Eta'), [0, 0]);
  assert.ok(Math.abs(eta.longitude) < 1e-9);
  assert.ok(Math.abs(eta.latitude - Math.atan(Math.SQRT2) * 180 / Math.PI) < 1e-9);
  const expected = { Alpha: -30, Beta: -90, Gamma: -150, Delta: 150, Epsilon: 90, Zeta: 30 };
  for (const [name, longitude] of Object.entries(expected)) {
    const trueLocation = trueAtFrame(coordinates.panelIdByName(name), [0, 0]);
    assert.ok(Math.abs(trueLocation.latitude) < 1e-9, name);
    assert.ok(Math.abs(longitudeDelta(trueLocation.longitude, longitude)) < 1e-9, `${name} ${trueLocation.longitude}`);
  }
  for (const [name, sign] of [['Theta', 1], ['Iota', 1], ['Kappa', -1], ['Lambda', -1], ['Mu', -1]]) {
    assert.equal(Math.sign(trueAtFrame(coordinates.panelIdByName(name), [0, 0]).latitude), sign, name);
  }
});

test('the polar vertices are at ±90° latitude from every panel that touches them', () => {
  for (const [vertexId, vertex] of Object.entries(builtProjection.vertices)) {
    const sin = util.dot(util.unit(vertex), projection.NORTH);
    if (Math.abs(Math.abs(sin) - 1) > 1e-9) {
      continue;
    }
    const faceIds = Object.values(builtProjection.faces).filter((face) => face.vertices.includes(vertexId)).map((face) => face.id);
    assert.equal(faceIds.length, 3);
    for (const panelId of faceIds) {
      const trueLocation = trueAtFrame(panelId, projection.solidToFrame(builtProjection.frames[panelId], vertex));
      assert.ok(Math.abs(Math.abs(trueLocation.latitude) - 90) < 1e-6);
      assert.equal(trueLocation.northBearing, null);
    }
  }
});

test('equatorial panels: the panel equator is the true equator and true north is panel north', () => {
  for (const panelId of builtProjection.equatorialWestToEast) {
    for (const framePoint of [[-0.4, 0], [0.3, 0], [0.2, 0.5], [-0.3, -0.6]]) {
      const trueLocation = trueAtFrame(panelId, framePoint);
      if (framePoint[1] === 0) {
        assert.ok(Math.abs(trueLocation.latitude) < 1e-9);
      }
      assert.ok(Math.abs(trueLocation.northBearing) < 1e-9);
    }
  }
});

test('true coordinates are continuous across every seam', () => {
  for (const edge of Object.values(builtProjection.edges)) {
    const [pointA, pointB] = edge.vertices.map((id) => builtProjection.vertices[id]);
    for (const t of [0.2, 0.5, 0.8]) {
      const point = pointA.map((value, axis) => value + (pointB[axis] - value) * t);
      const [first, second] = edge.faces.map((panelId) => trueAtFrame(panelId, projection.solidToFrame(builtProjection.frames[panelId], point)));
      assert.ok(Math.abs(first.latitude - second.latitude) < 1e-9, edge.id);
      assert.ok(Math.abs(longitudeDelta(first.longitude, second.longitude)) < 1e-9, edge.id);
    }
  }
});

test('true longitude grows eastward, latitude northward, and the bearing points along the meridian', () => {
  const step = 1e-4;
  for (const panelId of Object.keys(builtProjection.frames)) {
    for (const framePoint of [[0, 0], [0.35, 0.2], [-0.25, -0.3]]) {
      const trueLocation = trueAtFrame(panelId, framePoint);
      const east = trueAtFrame(panelId, [framePoint[0] + step, framePoint[1]]);
      const north = trueAtFrame(panelId, [framePoint[0], framePoint[1] + step]);
      assert.ok(longitudeDelta(trueLocation.longitude, east.longitude) > 0, panelId);
      assert.ok(north.latitude > trueLocation.latitude, panelId);
      const radians = trueLocation.northBearing * Math.PI / 180;
      const along = trueAtFrame(panelId, [framePoint[0] + step * Math.sin(radians), framePoint[1] + step * Math.cos(radians)]);
      assert.ok(along.latitude > trueLocation.latitude, panelId);
      assert.ok(Math.abs(longitudeDelta(trueLocation.longitude, along.longitude)) < 1e-9, `${panelId} ${framePoint}`);
    }
  }
});

test('Model.TrueCoordinates covers global tiles and local maps via their anchor', () => {
  const global = model.createGlobalMap({ panelHexes: 4, tileScale: 'XL' });
  const tileIndex = 7;
  const expected = coordinates.trueCoordinates(model.tileToUniversal(global, tileIndex), global.topo.milesPerEdge);
  assert.deepEqual(model.trueCoordinates(global, tileIndex), expected);
  const local = model.createLocalMap({ width: 5, height: 4, systemName: 'regional', scaleName: 'M', anchor: coordinates.parseUniversal('Alpha 100E 50N') });
  assert.deepEqual(model.trueCoordinates(local, 0), coordinates.trueCoordinates(local.local.anchor, projection.getMilesPerEdge(24)));
  const far = model.trueCoordinates(local, 19);
  assert.ok(far.latitude < model.trueCoordinates(local, 0).latitude);
  assert.ok(far.longitude > model.trueCoordinates(local, 0).longitude);
});

test('format true coordinates and choose decimals from the hex size', () => {
  assert.equal(coordinates.formatTrue({ latitude: 35.26439, longitude: -30 }, 2), '35.26°N 30.00°W');
  assert.equal(coordinates.formatTrue({ latitude: -0.0001, longitude: 0.0001 }, 2), '0.00°N 0.00°E');
  assert.equal(coordinates.trueDecimals(216, EDGE_MILES), 1);
  assert.ok(coordinates.trueDecimals(0.01, EDGE_MILES) > coordinates.trueDecimals(6, EDGE_MILES));
  assert.ok(coordinates.trueDecimals(1e-9, EDGE_MILES) <= 9);
});
