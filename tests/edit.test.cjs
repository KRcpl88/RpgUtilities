'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Projection: projection, Topology: topology, Terrain: terrain, Model: model, History: history, View: view, Edit: edit } = loadModules();

const mapFixture = model.createGlobalMap({ panelHexes: 24, tileScale: 'XL', name: 'Edit test' });
const topologyFixture = mapFixture.topo;
const WATER = terrain.byKey('water').id;
const FOREST = terrain.byKey('forest').id;
const MOUNTAIN = terrain.byKey('mountains').id;

function panelTiles(panelId) {
  const info = topologyFixture.panels[panelId];
  return Array.from({ length: info.tileCount }, (_, index) => info.firstTile + index);
}

function firstEquatorialPanel() {
  return Object.keys(topologyFixture.panels).find((panelId) => topologyFixture.panels[panelId].lattice.isEquatorial);
}

// The tile nearest the mean of its panel's tile centres.
function centralTile(panelId) {
  const tileIndices = panelTiles(panelId);
  const mean = [0, 0];
  tileIndices.forEach((tileIndex) => {
    mean[0] += topologyFixture.tiles[tileIndex].center[0] / tileIndices.length;
    mean[1] += topologyFixture.tiles[tileIndex].center[1] / tileIndices.length;
  });
  let bestIndex = tileIndices[0];
  let bestDistance = Infinity;
  for (const tileIndex of tileIndices) {
    const [x, y] = topologyFixture.tiles[tileIndex].center;
    const distance = Math.hypot(x - mean[0], y - mean[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = tileIndex;
    }
  }
  return bestIndex;
}

// Breadth-first step counts from start.
function distances(start, max) {
  const steps = new Map([[start, 0]]);
  let ring = [start];
  for (let step = 1; step <= max; step++) {
    const next = [];
    for (const tileIndex of ring) {
      for (const otherIndex of topology.neighbors(topologyFixture, tileIndex)) {
        if (!steps.has(otherIndex)) {
          steps.set(otherIndex, step);
          next.push(otherIndex);
        }
      }
    }
    ring = next;
  }
  return steps;
}

function resetTerrain(doc, id = WATER) {
  doc.terrainIds.fill(id);
  doc.revision++;
}

function worldCenter(layout, tileIndex) {
  const tile = topologyFixture.tiles[tileIndex];
  return projection.applyTransform(view.findPlacement(layout, tile.panelId).frameToWorld, tile.center);
}

test('brush footprint is a hex of 3r(r+1)+1 tiles at an interior tile', () => {
  const center = centralTile(firstEquatorialPanel());
  for (let radius = 0; radius <= edit.MAX_BRUSH_RADIUS; radius++) {
    const tileIndices = edit.brushTiles(mapFixture, center, radius);
    assert.equal(tileIndices.length, 3 * radius * (radius + 1) + 1, `radius ${radius}`);
    assert.equal(new Set(tileIndices).size, tileIndices.length, 'no duplicates');
    assert.equal(tileIndices[0], center, 'centre first');
  }
});

test('brush tiles are exactly the tiles within r steps, nearest first, across seams', () => {
  const panelId = firstEquatorialPanel();
  const info = topologyFixture.panels[panelId];
  // The easternmost tile of the panel sits on the seam with its east neighbour.
  const edge = panelTiles(panelId).reduce((bestIndex, tileIndex) =>
    topologyFixture.tiles[tileIndex].center[0] > topologyFixture.tiles[bestIndex].center[0] ? tileIndex : bestIndex);
  for (const radius of [1, 3]) {
    const steps = distances(edge, radius);
    const tileIndices = edit.brushTiles(mapFixture, edge, radius);
    assert.deepEqual(new Set(tileIndices), new Set(steps.keys()));
    for (let index = 1; index < tileIndices.length; index++) {
      assert.ok(steps.get(tileIndices[index - 1]) <= steps.get(tileIndices[index]), 'ordered by distance');
    }
    assert.ok(tileIndices.some((tileIndex) => topologyFixture.tiles[tileIndex].panelId === info.eastPanel), `radius ${radius} crosses the seam`);
  }
});

test('brush radius is validated', () => {
  for (const bad of [-1, 1.5, edit.MAX_BRUSH_RADIUS + 1, NaN]) {
    assert.throws(() => edit.brushTiles(mapFixture, 0, bad));
    assert.throws(() => edit.beginStroke(history.create(mapFixture), FOREST, bad));
  }
  assert.throws(() => edit.brushTiles(mapFixture, -1, 1));
  assert.throws(() => edit.brushTiles(mapFixture, mapFixture.tileCount, 1));
});

test('flood region covers the whole world, a blob, and crosses seams', () => {
  const doc = model.createGlobalMap({ panelHexes: 24, tileScale: 'XL', name: 'Flood' });
  resetTerrain(doc);
  assert.equal(edit.floodRegion(doc, 0).length, doc.tileCount);

  const panelId = firstEquatorialPanel();
  const edge = panelTiles(panelId).reduce((bestIndex, tileIndex) =>
    topologyFixture.tiles[tileIndex].center[0] > topologyFixture.tiles[bestIndex].center[0] ? tileIndex : bestIndex);
  const blob = edit.brushTiles(doc, edge, 3);
  blob.forEach((tileIndex) => model.setTerrain(doc, tileIndex, FOREST));
  const region = edit.floodRegion(doc, edge);
  assert.deepEqual(new Set(region), new Set(blob));
  assert.ok(new Set(region.map((tileIndex) => doc.topo.tiles[tileIndex].panelId)).size > 1, 'region spans panels');
  assert.equal(edit.floodRegion(doc, 0).length, doc.tileCount - blob.length);
});

test('segment tiles include every tile hit by dense sampling, in order', () => {
  const layout = view.buildNetLayout();
  const panelId = firstEquatorialPanel();
  const fromIndex = centralTile(panelId);
  const toIndex = centralTile(topologyFixture.panels[panelId].eastPanel);
  const from = worldCenter(layout, fromIndex);
  const to = worldCenter(layout, toIndex);
  const tileIndices = edit.segmentTiles(topologyFixture, layout, from, to);
  assert.equal(tileIndices[0], fromIndex);
  assert.equal(tileIndices[tileIndices.length - 1], toIndex);
  for (let index = 1; index < tileIndices.length; index++) {
    assert.notEqual(tileIndices[index], tileIndices[index - 1], 'no consecutive repeats');
  }
  const included = new Set(tileIndices);
  const sampleCount = 4000;
  for (let step = 0; step <= sampleCount; step++) {
    const t = step / sampleCount;
    const hit = view.hitTest(topologyFixture, layout, [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
    if (hit) {
      assert.ok(included.has(hit.tileIndex), `tile ${hit.tileIndex} at t=${t}`);
    }
  }
  // Consecutive tiles touch (the path is connected).
  for (let index = 1; index < tileIndices.length; index++) {
    assert.ok(Array.from(topology.neighbors(topologyFixture, tileIndices[index - 1])).includes(tileIndices[index]), `step ${index}`);
  }
  assert.deepEqual(edit.segmentTiles(topologyFixture, layout, from, from), [fromIndex]);
});

test('a brush stroke is one undoable command', () => {
  const doc = model.createGlobalMap({ panelHexes: 24, tileScale: 'XL', name: 'Stroke' });
  resetTerrain(doc);
  const hist = history.create(doc);
  const layout = view.buildNetLayout();
  const panelId = firstEquatorialPanel();
  const from = worldCenter(layout, centralTile(panelId));
  const to = worldCenter(layout, centralTile(topologyFixture.panels[panelId].eastPanel));
  const before = doc.terrainIds.slice();

  const stroke = edit.beginStroke(hist, FOREST, 2);
  assert.equal(history.canUndo(hist), false, 'no undo mid-stroke');
  const firstTiles = edit.strokeTo(stroke, layout, from);
  assert.equal(firstTiles.length, 19);
  const secondTiles = edit.strokeTo(stroke, layout, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  const third = edit.strokeTo(stroke, layout, to);
  assert.deepEqual(edit.strokeTo(stroke, layout, to), [], 'repainting a centre changes nothing');
  const all = [...firstTiles, ...secondTiles, ...third];
  assert.equal(new Set(all).size, all.length, 'each tile changes once');
  all.forEach((tileIndex) => assert.equal(doc.terrainIds[tileIndex], FOREST));
  const command = edit.endStroke(stroke);
  assert.equal(command.label, 'Paint Forest');
  assert.deepEqual(new Set(edit.commandTiles(command)), new Set(all));
  const after = doc.terrainIds.slice();

  assert.equal(history.undo(hist), command);
  assert.deepEqual(doc.terrainIds, before);
  assert.equal(history.canUndo(hist), false, 'the stroke was a single command');
  history.redo(hist);
  assert.deepEqual(doc.terrainIds, after);
});

test('an empty stroke records nothing', () => {
  const doc = model.createGlobalMap({ panelHexes: 4, tileScale: 'XL', name: 'Empty' });
  resetTerrain(doc);
  const hist = history.create(doc);
  const layout = view.buildNetLayout();
  const stroke = edit.beginStroke(hist, WATER, 1);
  assert.deepEqual(edit.strokeTo(stroke, layout, worldCenter(layout, 0)), []);
  assert.equal(edit.endStroke(stroke), null);
  assert.equal(history.canUndo(hist), false);
});

test('fill replaces one connected region as one command', () => {
  const doc = model.createGlobalMap({ panelHexes: 24, tileScale: 'XL', name: 'Fill' });
  resetTerrain(doc);
  const hist = history.create(doc);
  const center = centralTile(firstEquatorialPanel());
  // A mountain ring at distance 3 encloses a 19-tile water pocket (distance ≤ 2).
  const steps = distances(center, 3);
  const ring = [...steps.keys()].filter((tileIndex) => steps.get(tileIndex) === 3);
  ring.forEach((tileIndex) => model.setTerrain(doc, tileIndex, MOUNTAIN));
  const before = doc.terrainIds.slice();

  const { command, tileIndices } = edit.fill(hist, center, FOREST);
  assert.equal(command.label, 'Fill Forest');
  assert.equal(tileIndices.length, 19);
  assert.deepEqual(new Set(edit.commandTiles(command)), new Set(tileIndices));
  ring.forEach((tileIndex) => assert.equal(doc.terrainIds[tileIndex], MOUNTAIN));
  assert.equal(doc.terrainIds.filter((id) => id === FOREST).length, 19);

  const again = edit.fill(hist, center, FOREST);
  assert.equal(again.command, null, 'same terrain is a no-op');
  assert.deepEqual(again.tileIndices, []);

  history.undo(hist);
  assert.deepEqual(doc.terrainIds, before);
  assert.throws(() => edit.fill(hist, center, 999));
});

test('CommandTiles of null is empty', () => {
  assert.deepEqual(edit.commandTiles(null), []);
});
