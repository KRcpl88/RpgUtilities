'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Lattice } = LoadModules();

function AssertPointClose(rgdActual, rgdExpected, szMessage, dTolerance = 1e-9) {
  assert.ok(Util.Distance(rgdActual, rgdExpected) <= dTolerance, `${szMessage}: [${rgdActual}] != [${rgdExpected}]`);
}

test('scales and ratios follow prompt.md', () => {
  assert.equal(Lattice.ScaleDistance('regional', 'XL'), 216);
  assert.equal(Lattice.ScaleDistance('local', 'XL'), 600);
  assert.equal(Lattice.ScaleRatio('regional', 'XL', 'L'), 6);
  assert.equal(Lattice.ScaleRatio('regional', 'XL', 'S'), 216);
  assert.equal(Lattice.ScaleRatio('local', 'L', 'M'), 10);
  assert.equal(Lattice.ScaleRatio('local', 'XL', 'L'), 6);
  assert.equal(Lattice.ScaleRatio('regional', 'M', 'M'), 1);
  assert.throws(() => Lattice.ScaleRatio('regional', 'S', 'M'), /even ratio/);
  assert.throws(() => Lattice.ScaleDistance('regional', 'XXL'), /Unknown scale/);
  assert.equal(Lattice.ScaleMiles('local', 'S'), 1 / 1760);
});

test('hex sizes: d between centres, w = d·√3/2 between columns', () => {
  const dD = 2;
  assert.ok(Math.abs(Lattice.ColumnSpacing(dD) - Math.sqrt(3)) < 1e-15);
  const rgrgdHex = Lattice.HexPolygon([0, 0], dD);
  assert.ok(Math.abs(Util.PolygonArea(rgrgdHex) - Lattice.HexArea(dD)) < 1e-12, 'counter-clockwise area');
  // Flat top: the two north vertices share a y coordinate, half of d above the centre.
  assert.ok(Math.abs(rgrgdHex[1][1] - rgrgdHex[2][1]) < 1e-12);
  assert.ok(Math.abs(rgrgdHex[1][1] - dD / 2) < 1e-12);
});

test('offset, axial and cube round trips, including negatives', () => {
  for (let nQ = -7; nQ <= 7; nQ++) {
    for (let nJ = -7; nJ <= 7; nJ++) {
      const rgnAxial = Lattice.OffsetToAxial(nQ, nJ);
      assert.deepEqual(Lattice.AxialToOffset(...rgnAxial), [nQ, nJ]);
      const rgnCube = Lattice.AxialToCube(...rgnAxial);
      assert.equal(rgnCube[0] + rgnCube[1] + rgnCube[2], 0);
      assert.deepEqual(Lattice.CubeToAxial(...rgnCube), rgnAxial);
      const rgdPoint = Lattice.OffsetToPoint(nQ, nJ, 3);
      assert.deepEqual(Lattice.PointToOffset(rgdPoint[0], rgdPoint[1], 3), [nQ, nJ]);
    }
  }
});

test('odd columns are shifted half a hex north', () => {
  AssertPointClose(Lattice.OffsetToPoint(0, 0, 1), [0, 0], 'even column');
  AssertPointClose(Lattice.OffsetToPoint(1, 0, 1), [Math.sqrt(3) / 2, 0.5], 'odd column');
  AssertPointClose(Lattice.OffsetToPoint(-1, 0, 1), [-Math.sqrt(3) / 2, 0.5], 'negative odd column');
});

test('point → hex hit test agrees with the hex polygons', () => {
  const Random = Util.CreateRng(7);
  const dD = 1.5;
  for (let nTrial = 0; nTrial < 2000; nTrial++) {
    const rgdPoint = [(Random() - 0.5) * 30, (Random() - 0.5) * 30];
    const [nQ, nJ] = Lattice.PointToOffset(rgdPoint[0], rgdPoint[1], dD);
    const rgrgdHex = Lattice.HexPolygon(Lattice.OffsetToPoint(nQ, nJ, dD), dD);
    assert.ok(Util.PointInConvex(rgdPoint, rgrgdHex, 1e-9), `point ${rgdPoint} must be inside hex ${nQ},${nJ}`);
  }
});

test('neighbours are one step away, symmetric, and share an edge', () => {
  const dD = 1;
  for (const [nQ, nJ] of [[0, 0], [1, 0], [-3, 2], [4, -5]]) {
    const rgdCenter = Lattice.OffsetToPoint(nQ, nJ, dD);
    Lattice.OffsetNeighbors(nQ, nJ).forEach(([nOtherQ, nOtherJ], nDirection) => {
      assert.equal(Lattice.OffsetDistance(nQ, nJ, nOtherQ, nOtherJ), 1);
      const rgdOther = Lattice.OffsetToPoint(nOtherQ, nOtherJ, dD);
      assert.ok(Math.abs(Util.Distance(rgdCenter, rgdOther) - dD) < 1e-12);
      assert.deepEqual(Lattice.OffsetNeighbor(nOtherQ, nOtherJ, Lattice.OppositeDirection(nDirection)), [nQ, nJ]);
      const [rgdStart, rgdEnd] = Lattice.SharedEdge(rgdCenter, dD, nDirection);
      const [rgdOtherStart, rgdOtherEnd] = Lattice.SharedEdge(rgdOther, dD, Lattice.OppositeDirection(nDirection));
      AssertPointClose(rgdStart, rgdOtherEnd, 'shared edge start');
      AssertPointClose(rgdEnd, rgdOtherStart, 'shared edge end');
    });
  }
  // N is +y, NE is up and to the right.
  assert.deepEqual(Lattice.OffsetNeighbor(0, 0, 0), [0, 1]);
  assert.deepEqual(Lattice.OffsetNeighbor(0, 0, 1), [1, 0]);
  assert.deepEqual(Lattice.OffsetNeighbor(1, 0, 2), [2, 0]);
});

test('coarse hexes nest exactly in finer lattices of the same system', () => {
  for (const nRatio of [6, 10, 36, 216]) {
    const dCoarse = 1;
    const dFine = dCoarse / nRatio;
    for (const [nQ, nJ] of [[0, 0], [1, 0], [-1, 2], [3, -4], [-5, -1]]) {
      const [nFineQ, nFineJ] = Lattice.NestOffset(nQ, nJ, nRatio);
      AssertPointClose(Lattice.OffsetToPoint(nFineQ, nFineJ, dFine), Lattice.OffsetToPoint(nQ, nJ, dCoarse),
        `ratio ${nRatio} hex ${nQ},${nJ}`, 1e-12);
    }
  }
  assert.throws(() => Lattice.NestOffset(0, 0, 3), /even/);
});
