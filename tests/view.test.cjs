'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection, Lattice: lattice, Terrain: terrain, Model: model, View: view } = loadModules();

const EPSILON = 1e-9;
const mapFixture = model.createGlobalMap({ panelHexes: 4, tileScale: 'XL', name: 'Test' });
const topologyFixture = mapFixture.topo;

function assertClose(actual, expected, message, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

function centroid(polygon) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.length; index++) {
    const [x0, y0] = polygon[index];
    const [x1, y1] = polygon[(index + 1) % polygon.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  return [x / (3 * area), y / (3 * area)];
}

function hexVertices(center) {
  const radius = lattice.hexRadius(topologyFixture.d);
  return [0, 1, 2, 3, 4, 5].map((index) => [
    center[0] + radius * Math.cos(index * Math.PI / 3),
    center[1] + radius * Math.sin(index * Math.PI / 3),
  ]);
}

// Points (in the tile's own panel frame) that must hit the tile: the centre of a whole
// hex, or the centroid of each piece lying in the owning panel.
function probePoints(tile) {
  if (!tile.pieces) {
    return [tile.center];
  }
  return tile.pieces.filter((piece) => piece.panelId === tile.panelId).map((piece) => centroid(piece.polygon));
}

test('camera world ↔ screen round trips and matches its transform', () => {
  const camera = view.createCamera(640, 480);
  view.centerOn(camera, [1.25, -0.75]);
  camera.scale = 137;
  const t = view.worldToScreenTransform(camera);
  for (const world of [[0, 0], [1.25, -0.75], [3, 2], [-4.5, 0.1]]) {
    const screen = view.worldToScreen(camera, world);
    const back = view.screenToWorld(camera, screen);
    assertClose(back[0], world[0], 'x');
    assertClose(back[1], world[1], 'y');
    const viaT = projection.applyTransform(t, world);
    assertClose(viaT[0], screen[0], 'tx');
    assertClose(viaT[1], screen[1], 'ty');
  }
  assert.deepEqual(view.worldToScreen(camera, [1.25, -0.75]), [320, 240]);
  // y is up in world, down on screen.
  assert.ok(view.worldToScreen(camera, [1.25, 0])[1] < 240);
});

test('ZoomAt keeps the cursor point fixed and clamps the scale', () => {
  const camera = view.createCamera(800, 600);
  const cursor = [123, 456];
  const before = view.screenToWorld(camera, cursor);
  view.zoomAt(camera, cursor, 3.5);
  assertClose(camera.scale, 350, 'scale');
  const after = view.screenToWorld(camera, cursor);
  assertClose(after[0], before[0], 'x');
  assertClose(after[1], before[1], 'y');
  view.zoomAt(camera, cursor, 1e12);
  assert.equal(camera.scale, view.MAX_SCALE);
  view.zoomAt(camera, cursor, 1e-12);
  assert.equal(camera.scale, view.MIN_SCALE);
  assert.equal(view.clampScale(50), 50);
});

test('Pan moves content by screen pixels; FitBounds shows the whole box', () => {
  const camera = view.createCamera(800, 600);
  const world = [0.3, 0.4];
  const before = view.worldToScreen(camera, world);
  view.pan(camera, 15, -20);
  const after = view.worldToScreen(camera, world);
  assertClose(after[0] - before[0], 15, 'dx');
  assertClose(after[1] - before[1], -20, 'dy');

  const bounds = view.buildNetLayout().bounds;
  view.fitBounds(camera, bounds, 24);
  const visible = view.visibleBounds(camera);
  assert.ok(visible[0] <= bounds[0] && visible[1] <= bounds[1]);
  assert.ok(visible[2] >= bounds[2] && visible[3] >= bounds[3]);
  const [left, top] = view.worldToScreen(camera, [bounds[0], bounds[3]]);
  const [right, bottom] = view.worldToScreen(camera, [bounds[2], bounds[1]]);
  // One axis touches the margin exactly.
  assert.ok(Math.abs(left - 24) < 1e-6 || Math.abs(top - 24) < 1e-6);
  assert.ok(right <= 776 + 1e-6 && bottom <= 576 + 1e-6);
});

test('bounds helpers', () => {
  assert.deepEqual(view.boundsOf([[1, 2], [-1, 5], [0, 0]]), [-1, 0, 1, 5]);
  assert.ok(view.boundsIntersect([0, 0, 1, 1], [1, 1, 2, 2]));
  assert.ok(!view.boundsIntersect([0, 0, 1, 1], [1.01, 0, 2, 1]));
  assert.deepEqual(view.unionBounds([[0, 0, 1, 1], [2, -1, 3, 0.5]]), [0, -1, 3, 1]);
  const rotated = view.transformBounds([0, 1, -1, 0, 10, 0], [0, 0, 2, 1]);
  [9, 0, 10, 2].forEach((value, index) => assertClose(rotated[index], value, `rotated ${index}`));
});

test('net layout places every panel at its net frame', () => {
  const built = projection.build();
  const layout = view.buildNetLayout();
  assert.equal(layout, view.buildNetLayout(), 'cached');
  assert.equal(layout.mode, 'net');
  assert.equal(layout.placements.length, Object.keys(built.panels).length);
  assert.equal(layout.placements.length, 18);
  for (const placement of layout.placements) {
    assert.deepEqual([...placement.frameToWorld], [...built.frames[placement.panelId].frameToNet]);
    assert.equal(view.findPlacement(layout, placement.panelId), placement);
    const hit = view.placementAt(layout, placement.center);
    assert.equal(hit.placement, placement);
    assertClose(hit.framePoint[0], 0, 'frame x');
    assertClose(hit.framePoint[1], 0, 'frame y');
  }
  assert.equal(view.placementAt(layout, [layout.bounds[2] + 1, 0]), null);
});

test('focus layouts unfold every neighbour across its shared seam', () => {
  const built = projection.build();
  for (const focusPanel of Object.keys(built.panels)) {
    const layout = view.buildFocusLayout(focusPanel);
    assert.equal(layout, view.buildFocusLayout(focusPanel), 'cached');
    assert.equal(layout.mode, 'focus');
    assert.equal(layout.focusPanel, focusPanel);
    const focus = layout.placements[layout.placements.length - 1];
    assert.equal(focus.panelId, focusPanel, 'focus drawn last');
    assert.deepEqual([...focus.frameToWorld], [...view.IDENTITY]);
    const seams = built.seams.filter((seam) => seam.panelA === focusPanel || seam.panelB === focusPanel).length;
    assert.equal(layout.placements.length, seams + 1);
    assert.equal(seams, built.frames[focusPanel].polygon.length, `${focusPanel}: one neighbour per edge`);
    for (const placement of layout.placements.slice(0, -1)) {
      const shared = placement.outline.filter((point) => focus.outline.some(
        (other) => Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-9)).length;
      assert.equal(shared, 2, `${focusPanel}/${placement.panelId} shares one edge`);
      // Neighbours sit outside the focus panel.
      const framePoint = projection.applyTransform(focus.worldToFrame, placement.center);
      assert.ok(!util.pointInConvex(framePoint, built.frames[focusPanel].polygon));
    }
  }
  assert.throws(() => view.buildFocusLayout('nope'));
});

function checkHits(layout) {
  let checked = 0;
  for (const tile of topologyFixture.tiles) {
    const placement = view.findPlacement(layout, tile.panelId);
    if (!placement) {
      continue;
    }
    for (const framePoint of probePoints(tile)) {
      const world = projection.applyTransform(placement.frameToWorld, framePoint);
      const hit = view.hitTest(topologyFixture, layout, world);
      assert.ok(hit, `tile ${tile.index} missed`);
      assert.equal(hit.tileIndex, tile.index, `tile ${tile.index} hit ${hit.tileIndex}`);
      assert.equal(hit.panelId, tile.panelId);
      checked++;
    }
  }
  return checked;
}

test('HitTest finds every tile in the net layout', () => {
  const checked = checkHits(view.buildNetLayout());
  assert.ok(checked >= topologyFixture.tileCount);
  const outside = view.buildNetLayout().bounds;
  assert.equal(view.hitTest(topologyFixture, view.buildNetLayout(), [outside[2] + 5, outside[3] + 5]), null);
});

test('HitTest finds every tile in focus layouts', () => {
  for (const focusPanel of Object.keys(projection.build().panels)) {
    assert.ok(checkHits(view.buildFocusLayout(focusPanel)) > 0);
  }
});

test('HitTest of random points lands in a tile containing the point', () => {
  const layout = view.buildNetLayout();
  const random = util.createRng(7);
  const [minX, minY, maxX, maxY] = layout.bounds;
  let hits = 0;
  for (let index = 0; index < 2000; index++) {
    const world = [minX + (maxX - minX) * random(), minY + (maxY - minY) * random()];
    const hit = view.hitTest(topologyFixture, layout, world);
    if (!hit || hit.tileIndex < 0) {
      continue;
    }
    const tile = topologyFixture.tiles[hit.tileIndex];
    assert.equal(hit.panelId, tile.panelId, 'hit is reported in the owning panel');
    const tileFrame = hit.framePoint;
    const inside = tile.pieces
      ? tile.pieces.some((piece) => util.pointInConvex(tileFrame, piece.polygon))
      : Math.hypot(tileFrame[0] - tile.center[0], tileFrame[1] - tile.center[1]) <= lattice.hexRadius(topologyFixture.d) + 1e-9;
    assert.ok(inside, `point ${world} outside hit tile ${hit.tileIndex}`);
    hits++;
  }
  assert.ok(hits > 500, `${hits} hits`);
});

// prompt.md "Map projection": on the east/west seams of the equatorial panels, edge hexes
// belong wholly to their own panel, so the tip that pokes into the neighbouring panel
// belongs to that hex. Elsewhere, partial tiles are clipped to their panel, so the panel
// containing the point owns it.
test('points across an equatorial seam belong to the neighbouring panel\'s edge hex', () => {
  const built = projection.build();
  const layout = view.buildNetLayout();
  const halfWidth = built.equatorialWidth / 2;
  const radius = lattice.hexRadius(topologyFixture.d);
  let across = 0;
  let own = 0;
  for (const [panelId, info] of Object.entries(topologyFixture.panels)) {
    if (!info.lattice.isEquatorial) {
      continue;
    }
    const placement = view.findPlacement(layout, panelId);
    for (const [otherId, side] of [[info.westPanel, -1], [info.eastPanel, 1]]) {
      // Probe a vertical line just inside this panel's west/east edge.
      for (let north = -0.4; north <= 0.4; north += 0.003) {
        const framePoint = [side * (halfWidth - 0.02 * topologyFixture.w), north];
        if (!util.pointInConvex(framePoint, built.frames[panelId].polygon)) {
          continue;
        }
        const hit = view.hitTest(topologyFixture, layout, projection.applyTransform(placement.frameToWorld, framePoint));
        assert.ok(hit, `${panelId} ${framePoint} missed`);
        assert.equal(hit.drawPanel, panelId);
        const tile = topologyFixture.tiles[hit.tileIndex];
        assert.equal(hit.panelId, tile.panelId);
        assert.ok(hit.panelId === panelId || hit.panelId === otherId, `${panelId}: owner ${hit.panelId}`);
        // The owner is the hex of the continuous strip lattice containing the point,
        // and the point is reported in the owner's frame.
        if (!tile.pieces) {
          assert.ok(Math.hypot(hit.framePoint[0] - tile.center[0], hit.framePoint[1] - tile.center[1]) <= radius + 1e-9);
        }
        if (hit.panelId === otherId) {
          across++;
          assert.ok(Math.abs(hit.framePoint[0]) > halfWidth - 1e-9, `${hit.framePoint}`);
        } else {
          own++;
        }
      }
    }
  }
  assert.ok(across > 0 && own > 0, `${across} across, ${own} own`);
});

test('points just inside any other panel edge belong to that panel', () => {
  const built = projection.build();
  const layout = view.buildNetLayout();
  const halfWidth = built.equatorialWidth / 2;
  let checked = 0;
  for (const [panelId, info] of Object.entries(topologyFixture.panels)) {
    const placement = view.findPlacement(layout, panelId);
    const polygon = built.frames[panelId].polygon;
    polygon.forEach((startPoint, index) => {
      const end = polygon[(index + 1) % polygon.length];
      const stripSeam = info.lattice.isEquatorial
        && Math.abs(Math.abs(startPoint[0]) - halfWidth) < 1e-9 && Math.abs(Math.abs(end[0]) - halfWidth) < 1e-9;
      if (stripSeam) {
        return;
      }
      for (let t = 0.03; t < 1; t += 0.02) {
        const onEdge = [startPoint[0] + t * (end[0] - startPoint[0]), startPoint[1] + t * (end[1] - startPoint[1])];
        const framePoint = [onEdge[0] * (1 - 1e-4), onEdge[1] * (1 - 1e-4)];
        // Equatorial corners: the strip neighbour's edge hex may reach this far.
        if (info.lattice.isEquatorial && Math.abs(framePoint[0]) > halfWidth - topologyFixture.w) {
          continue;
        }
        const hit = view.hitTest(topologyFixture, layout, projection.applyTransform(placement.frameToWorld, framePoint));
        assert.ok(hit, `${panelId} edge ${index} missed`);
        assert.equal(hit.panelId, panelId, `${panelId} edge ${index} at ${t}`);
        assert.equal(hit.drawPanel, panelId);
        checked++;
      }
    });
  }
  assert.ok(checked > 1000, `${checked}`);
});

test('PanelTileGroups adds strip-neighbour edge columns only for equatorial panels', () => {
  let equatorial = 0;
  for (const [panelId, info] of Object.entries(topologyFixture.panels)) {
    const groups = view.panelTileGroups(topologyFixture, panelId);
    assert.equal(groups, view.panelTileGroups(topologyFixture, panelId), 'cached');
    assert.equal(groups[0].owner, panelId);
    assert.equal(groups[0].tileIndices.length, info.tileCount);
    if (info.lattice.isEquatorial) {
      equatorial++;
      assert.equal(groups.length, 3);
      assert.deepEqual(groups.slice(1).map((group) => group.owner), [info.westPanel, info.eastPanel]);
      for (const group of groups.slice(1)) {
        assert.ok(group.tileIndices.length > 0 && group.tileIndices.length < topologyFixture.panels[group.owner].tileCount);
        for (const tileIndex of group.tileIndices) {
          assert.equal(topologyFixture.tiles[tileIndex].panelId, group.owner);
        }
      }
    } else {
      assert.equal(groups.length, 1);
    }
  }
  assert.ok(equatorial > 0);
});

test('VisibleTiles keeps every tile with a vertex in view', () => {
  const random = util.createRng(11);
  for (const [panelId] of Object.entries(topologyFixture.panels)) {
    for (const group of view.panelTileGroups(topologyFixture, panelId)) {
      for (let trial = 0; trial < 5; trial++) {
        const x = 1.2 * (random() - 0.5);
        const y = 1.2 * (random() - 0.5);
        const size = 0.05 + 0.3 * random();
        const box = [x, y, x + size, y + size];
        const visible = new Set(view.visibleTiles(topologyFixture, group, box));
        for (const tileIndex of group.tileIndices) {
          const center = projection.applyTransform(group.toPanel, topologyFixture.tiles[tileIndex].center);
          const touches = hexVertices(center).concat([center]).some(([px, py]) =>
            px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3]);
          if (touches) {
            assert.ok(visible.has(tileIndex), `${panelId}: tile ${tileIndex} culled`);
          }
        }
      }
    }
  }
});

test('DemoTerrain is deterministic and valid', () => {
  const firstTiles = view.demoTerrain(topologyFixture, 1);
  const secondTiles = view.demoTerrain(topologyFixture, 1);
  const other = view.demoTerrain(topologyFixture, 2);
  assert.ok(firstTiles instanceof Uint8Array);
  assert.equal(firstTiles.length, topologyFixture.tileCount);
  assert.deepEqual(firstTiles, secondTiles);
  assert.notDeepEqual(firstTiles, other);
  const ids = new Set(terrain.TERRAINS.map((entry) => entry.id));
  for (const id of firstTiles) {
    assert.ok(ids.has(id), `bad id ${id}`);
  }
  assert.ok(new Set(firstTiles).size >= 6, 'a varied world');
});
