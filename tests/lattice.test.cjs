'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Lattice: lattice } = loadModules();

function assertPointClose(actual, expected, message, tolerance = 1e-9) {
  assert.ok(util.pointDistance(actual, expected) <= tolerance, `${message}: [${actual}] != [${expected}]`);
}

test('scales and ratios follow prompt.md', () => {
  assert.equal(lattice.scaleDistance('regional', 'XL'), 216);
  assert.equal(lattice.scaleDistance('local', 'XL'), 600);
  assert.equal(lattice.scaleRatio('regional', 'XL', 'L'), 6);
  assert.equal(lattice.scaleRatio('regional', 'XL', 'S'), 216);
  assert.equal(lattice.scaleRatio('local', 'L', 'M'), 10);
  assert.equal(lattice.scaleRatio('local', 'XL', 'L'), 6);
  assert.equal(lattice.scaleRatio('regional', 'M', 'M'), 1);
  assert.throws(() => lattice.scaleRatio('regional', 'S', 'M'), /even ratio/);
  assert.throws(() => lattice.scaleDistance('regional', 'XXL'), /Unknown scale/);
  assert.equal(lattice.scaleMiles('local', 'S'), 1 / 1760);
});

test('hex sizes: d between centres, w = d·√3/2 between columns', () => {
  const d = 2;
  assert.ok(Math.abs(lattice.columnSpacing(d) - Math.sqrt(3)) < 1e-15);
  const hex = lattice.hexPolygon([0, 0], d);
  assert.ok(Math.abs(util.polygonArea(hex) - lattice.hexArea(d)) < 1e-12, 'counter-clockwise area');
  // Flat top: the two north vertices share a y coordinate, half of d above the centre.
  assert.ok(Math.abs(hex[1][1] - hex[2][1]) < 1e-12);
  assert.ok(Math.abs(hex[1][1] - d / 2) < 1e-12);
});

test('offset, axial and cube round trips, including negatives', () => {
  for (let q = -7; q <= 7; q++) {
    for (let j = -7; j <= 7; j++) {
      const axial = lattice.offsetToAxial(q, j);
      assert.deepEqual(lattice.axialToOffset(...axial), [q, j]);
      const cube = lattice.axialToCube(...axial);
      assert.equal(cube[0] + cube[1] + cube[2], 0);
      assert.deepEqual(lattice.cubeToAxial(...cube), axial);
      const point = lattice.offsetToPoint(q, j, 3);
      assert.deepEqual(lattice.pointToOffset(point[0], point[1], 3), [q, j]);
    }
  }
});

test('odd columns are shifted half a hex north', () => {
  assertPointClose(lattice.offsetToPoint(0, 0, 1), [0, 0], 'even column');
  assertPointClose(lattice.offsetToPoint(1, 0, 1), [Math.sqrt(3) / 2, 0.5], 'odd column');
  assertPointClose(lattice.offsetToPoint(-1, 0, 1), [-Math.sqrt(3) / 2, 0.5], 'negative odd column');
});

test('point → hex hit test agrees with the hex polygons', () => {
  const random = util.createRng(7);
  const d = 1.5;
  for (let trial = 0; trial < 2000; trial++) {
    const point = [(random() - 0.5) * 30, (random() - 0.5) * 30];
    const [q, j] = lattice.pointToOffset(point[0], point[1], d);
    const hex = lattice.hexPolygon(lattice.offsetToPoint(q, j, d), d);
    assert.ok(util.pointInConvex(point, hex, 1e-9), `point ${point} must be inside hex ${q},${j}`);
  }
});

test('neighbours are one step away, symmetric, and share an edge', () => {
  const d = 1;
  for (const [q, j] of [[0, 0], [1, 0], [-3, 2], [4, -5]]) {
    const center = lattice.offsetToPoint(q, j, d);
    lattice.offsetNeighbors(q, j).forEach(([otherQ, otherJ], direction) => {
      assert.equal(lattice.offsetDistance(q, j, otherQ, otherJ), 1);
      const other = lattice.offsetToPoint(otherQ, otherJ, d);
      assert.ok(Math.abs(util.pointDistance(center, other) - d) < 1e-12);
      assert.deepEqual(lattice.offsetNeighbor(otherQ, otherJ, lattice.oppositeDirection(direction)), [q, j]);
      const [startPoint, end] = lattice.sharedEdge(center, d, direction);
      const [otherStart, otherEnd] = lattice.sharedEdge(other, d, lattice.oppositeDirection(direction));
      assertPointClose(startPoint, otherEnd, 'shared edge start');
      assertPointClose(end, otherStart, 'shared edge end');
    });
  }
  // N is +y, NE is up and to the right.
  assert.deepEqual(lattice.offsetNeighbor(0, 0, 0), [0, 1]);
  assert.deepEqual(lattice.offsetNeighbor(0, 0, 1), [1, 0]);
  assert.deepEqual(lattice.offsetNeighbor(1, 0, 2), [2, 0]);
});

test('coarse hexes nest exactly in finer lattices of the same system', () => {
  for (const ratio of [6, 10, 36, 216]) {
    const coarse = 1;
    const fine = coarse / ratio;
    for (const [q, j] of [[0, 0], [1, 0], [-1, 2], [3, -4], [-5, -1]]) {
      const [fineQ, fineJ] = lattice.nestOffset(q, j, ratio);
      assertPointClose(lattice.offsetToPoint(fineQ, fineJ, fine), lattice.offsetToPoint(q, j, coarse),
        `ratio ${ratio} hex ${q},${j}`, 1e-12);
    }
  }
  assert.throws(() => lattice.nestOffset(0, 0, 3), /even/);
});
