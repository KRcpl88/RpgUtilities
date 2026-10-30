'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util } = LoadModules();

function AssertClose(rgdActual, rgdExpected, dTolerance = 1e-12) {
  assert.equal(rgdActual.length, rgdExpected.length);
  rgdActual.forEach((dValue, nIndex) => {
    assert.ok(Math.abs(dValue - rgdExpected[nIndex]) <= dTolerance,
      `index ${nIndex}: ${dValue} != ${rgdExpected[nIndex]}`);
  });
}

test('vector helpers', () => {
  AssertClose(Util.Add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  AssertClose(Util.Subtract([4, 5], [1, 7]), [3, -2]);
  AssertClose(Util.Scale([1, -2], 3), [3, -6]);
  assert.equal(Util.Dot([1, 2, 3], [4, 5, 6]), 32);
  AssertClose(Util.Cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(Util.Length([3, 4]), 5);
  assert.equal(Util.Distance([1, 1], [4, 5]), 5);
  AssertClose(Util.Unit([0, 3, 4]), [0, 0.6, 0.8]);
  assert.throws(() => Util.Unit([0, 0]), /zero-length/);
  AssertClose(Util.Center([[0, 0], [2, 0], [2, 2], [0, 2]]), [1, 1]);
});

test('Boundary pairs consecutive items and closes the loop', () => {
  assert.deepEqual(Util.Boundary(['a', 'b', 'c']), [['a', 'b'], ['b', 'c'], ['c', 'a']]);
});

test('Require throws with its message only on failure', () => {
  assert.doesNotThrow(() => Util.Require(true, 'unused'));
  assert.throws(() => Util.Require(false, 'broken invariant'), /broken invariant/);
});

test('CreateRng is deterministic, seed-sensitive, and in [0, 1)', () => {
  const First = Util.CreateRng(42);
  const Second = Util.CreateRng(42);
  const Other = Util.CreateRng(43);
  const rgdFirst = Array.from({ length: 1000 }, First);
  const rgdSecond = Array.from({ length: 1000 }, Second);
  assert.deepEqual(rgdFirst, rgdSecond);
  assert.notDeepEqual(rgdFirst.slice(0, 10), Array.from({ length: 10 }, Other));
  assert.ok(rgdFirst.every((dValue) => dValue >= 0 && dValue < 1));
  const dMean = rgdFirst.reduce((dSum, dValue) => dSum + dValue, 0) / rgdFirst.length;
  assert.ok(Math.abs(dMean - 0.5) < 0.05, `mean ${dMean} should be near 0.5`);
});

test('HashIntegers is stable, order-sensitive, and unsigned 32-bit', () => {
  assert.equal(Util.HashIntegers(3, 7, 11), Util.HashIntegers(3, 7, 11));
  assert.notEqual(Util.HashIntegers(3, 7), Util.HashIntegers(7, 3));
  const nHash = Util.HashIntegers(-5, 123456789);
  assert.ok(Number.isInteger(nHash) && nHash >= 0 && nHash <= 0xFFFFFFFF);
});

test('FormatNumber trims trailing zeros and signed zero', () => {
  assert.equal(Util.FormatNumber(12.5), '12.5');
  assert.equal(Util.FormatNumber(100), '100');
  assert.equal(Util.FormatNumber(100, 0), '100');
  assert.equal(Util.FormatNumber(1 / 3), '0.333333');
  assert.equal(Util.FormatNumber(-0.0000001), '0');
  assert.equal(Util.FormatNumber(-2.25, 1), '-2.3');
});

test('PolygonArea is signed by winding', () => {
  const rgrgdSquare = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(Util.PolygonArea(rgrgdSquare), 4);
  assert.equal(Util.PolygonArea([...rgrgdSquare].reverse()), -4);
});

test('ClipPolygonToConvex and PointInConvex', () => {
  const rgrgdClip = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const rgrgdSubject = [[1, 1], [3, 1], [3, 3], [1, 3]];
  assert.equal(Util.PolygonArea(Util.ClipPolygonToConvex(rgrgdSubject, rgrgdClip)), 1);
  assert.deepEqual(Util.ClipPolygonToConvex([[5, 5], [6, 5], [6, 6]], rgrgdClip), []);
  assert.equal(Util.PolygonArea(Util.ClipPolygonToConvex(rgrgdClip, rgrgdClip)), 4);
  assert.ok(Util.PointInConvex([1, 1], rgrgdClip));
  assert.ok(Util.PointInConvex([2, 1], rgrgdClip));
  assert.ok(!Util.PointInConvex([2.1, 1], rgrgdClip));
});

test('ClipSegmentToConvex returns the inside parameter interval', () => {
  const rgrgdClip = [[0, 0], [2, 0], [2, 2], [0, 2]];
  AssertClose(Util.ClipSegmentToConvex([-1, 1], [3, 1], rgrgdClip), [0.25, 0.75]);
  AssertClose(Util.ClipSegmentToConvex([0.5, 0.5], [1, 1], rgrgdClip), [0, 1]);
  assert.equal(Util.ClipSegmentToConvex([-1, 3], [3, 3], rgrgdClip), null);
});
