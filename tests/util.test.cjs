'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util } = loadModules();

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance,
      `index ${index}: ${value} != ${expected[index]}`);
  });
}

test('vector helpers', () => {
  assertClose(util.add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assertClose(util.subtract([4, 5], [1, 7]), [3, -2]);
  assertClose(util.scale([1, -2], 3), [3, -6]);
  assert.equal(util.dot([1, 2, 3], [4, 5, 6]), 32);
  assertClose(util.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(util.vectorLength([3, 4]), 5);
  assert.equal(util.pointDistance([1, 1], [4, 5]), 5);
  assertClose(util.unit([0, 3, 4]), [0, 0.6, 0.8]);
  assert.throws(() => util.unit([0, 0]), /zero-length/);
  assertClose(util.center([[0, 0], [2, 0], [2, 2], [0, 2]]), [1, 1]);
});

test('Boundary pairs consecutive items and closes the loop', () => {
  assert.deepEqual(util.boundary(['a', 'b', 'c']), [['a', 'b'], ['b', 'c'], ['c', 'a']]);
});

test('Require throws with its message only on failure', () => {
  assert.doesNotThrow(() => util.assertCondition(true, 'unused'));
  assert.throws(() => util.assertCondition(false, 'broken invariant'), /broken invariant/);
});

test('CreateRng is deterministic, seed-sensitive, and in [0, 1)', () => {
  const first = util.createRng(42);
  const second = util.createRng(42);
  const other = util.createRng(43);
  const firstPoint = Array.from({ length: 1000 }, first);
  const secondPoint = Array.from({ length: 1000 }, second);
  assert.deepEqual(firstPoint, secondPoint);
  assert.notDeepEqual(firstPoint.slice(0, 10), Array.from({ length: 10 }, other));
  assert.ok(firstPoint.every((value) => value >= 0 && value < 1));
  const mean = firstPoint.reduce((sum, value) => sum + value, 0) / firstPoint.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean} should be near 0.5`);
});

test('HashIntegers is stable, order-sensitive, and unsigned 32-bit', () => {
  assert.equal(util.hashIntegers(3, 7, 11), util.hashIntegers(3, 7, 11));
  assert.notEqual(util.hashIntegers(3, 7), util.hashIntegers(7, 3));
  const hash = util.hashIntegers(-5, 123456789);
  assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xFFFFFFFF);
});

test('FormatNumber trims trailing zeros and signed zero', () => {
  assert.equal(util.formatNumber(12.5), '12.5');
  assert.equal(util.formatNumber(100), '100');
  assert.equal(util.formatNumber(100, 0), '100');
  assert.equal(util.formatNumber(1 / 3), '0.333333');
  assert.equal(util.formatNumber(-0.0000001), '0');
  assert.equal(util.formatNumber(-2.25, 1), '-2.3');
});

test('PolygonArea is signed by winding', () => {
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(util.polygonArea(square), 4);
  assert.equal(util.polygonArea([...square].reverse()), -4);
});

test('ClipPolygonToConvex and PointInConvex', () => {
  const clip = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const subject = [[1, 1], [3, 1], [3, 3], [1, 3]];
  assert.equal(util.polygonArea(util.clipPolygonToConvex(subject, clip)), 1);
  assert.deepEqual(util.clipPolygonToConvex([[5, 5], [6, 5], [6, 6]], clip), []);
  assert.equal(util.polygonArea(util.clipPolygonToConvex(clip, clip)), 4);
  assert.ok(util.pointInConvex([1, 1], clip));
  assert.ok(util.pointInConvex([2, 1], clip));
  assert.ok(!util.pointInConvex([2.1, 1], clip));
});

test('ClipSegmentToConvex returns the inside parameter interval', () => {
  const clip = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assertClose(util.clipSegmentToConvex([-1, 1], [3, 1], clip), [0.25, 0.75]);
  assertClose(util.clipSegmentToConvex([0.5, 0.5], [1, 1], clip), [0, 1]);
  assert.equal(util.clipSegmentToConvex([-1, 3], [3, 3], clip), null);
});
