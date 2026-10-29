"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { geometry: g, documents: d, editor: local, globalEditor: global, layers, scales } = require("./load-core.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
const projection = { id: "equilateral-chamfered-cube", version: 1, columns: 2 };
const tile = (q = 0, r = 0, panelId = "local") => ({ panelId, q, r });
const create = options => d.create({ id: "source", kind: "local", scaleFamily: "regional", scale: "S", ...options });
const anchor = (rotation = 0) => ({ mapId: "parent", projection, panelId: "Hyz+-", east: 20, north: 30, rotation });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const labelPoint = (map, label) => {
  const p = layers.anchor(map, label.tile);
  return { panelId: p.panelId, east: p.east + label.offset[0], north: p.north + label.offset[1] };
};

test("anchor registration rotates clockwise about a nonzero local origin and round-trips without folding", () => {
  const map = create({ extent: { width: 4, height: 4, origin: [-12, 8] }, anchor: anchor(90) });
  assert.deepEqual(plain(scales.toGlobal(map, [-12, 8])), { panelId: "Hyz+-", east: 20, north: 30 });
  const east = scales.toGlobal(map, [-10, 8]), north = scales.toGlobal(map, [-12, 11]);
  close(east.east, 20); close(east.north, 28);
  close(north.east, 23); close(north.north, 30);
  for (const rotation of [-450, -35, 0, 37, 720]) {
    map.setAnchor(anchor(rotation));
    const point = [123.25, -98.75], returned = scales.fromGlobal(map, scales.toGlobal(map, point));
    point.forEach((v, i) => close(v, returned[i]));
  }
  assert.equal(scales.anchorLocation(map, [-12, 8]).inside, true);
  const outside = scales.anchorLocation(map, [1e6, 1e6]);
  assert.equal(outside.inside, false);
  assert.equal(outside.latitude, null);
  assert.throws(() => scales.fromGlobal(map, { panelId: "Sz-", east: 0, north: 0 }), /do not automatically fold/);
  assert.throws(() => scales.toGlobal(map, [Infinity, 0]), /finite/);
  map.setAnchor(null);
  assert.throws(() => scales.toGlobal(map, [0, 0]), /Set a global anchor/);
});

test("anchor edits share history, preserve frozen metadata, and fail atomically with no-op redo intact", () => {
  const map = create(), session = local.createSession(map, { saved: true }), before = map.metadata;
  session.setAnchor(anchor());
  const saved = d.serialize(map); session.markSaved();
  assert.equal(before.anchor, null);
  assert.ok(Object.isFrozen(map.metadata.anchor.projection));
  assert.throws(() => session.setAnchor({ ...anchor(), east: 1e9 }), /outside/);
  assert.throws(() => session.setAnchor({ ...anchor(), mapId: map.metadata.id }), /itself/);
  assert.equal(d.serialize(map), saved);
  session.setAnchor(null); session.undo();
  assert.equal(session.dirty, false);
  assert.equal(session.setAnchor({ rotation: 0, north: 30, east: 20, panelId: "Hyz+-", projection, mapId: "parent" }), false);
  assert.equal(session.canRedo, true);
  session.redo(); assert.equal(map.metadata.anchor, null);
  session.undo(); assert.equal(d.serialize(map), saved);
  session.beginStroke();
  assert.throws(() => session.setAnchor(null), /Finish or cancel/);
  session.cancelStroke();
  assert.equal(d.serialize(d.parse(saved)), saved);
});

test("all resolutions retain family and physical coverage without allocating default terrain", () => {
  for (const family of ["local", "regional"]) for (const scale of ["S", "M", "L", "XL"]) {
    const source = create({ scaleFamily: family, scale, extent: { width: 3, height: 2, origin: [-12, 8] } });
    const before = d.serialize(source);
    for (const target of ["S", "M", "L", "XL"]) {
      const derived = scales.derive(source, { id: "derived", scale: target });
      assert.equal(derived.metadata.scaleFamily, family);
      assert.equal(derived.metadata.scale, target);
      assert.equal(derived.terrainBlocks.length, 0);
      for (let q = 0; q < 3; q++) for (let row = 0; row < 2; row++)
        for (const point of g.hexPolygon(local.grid(source), q, -row - Math.floor(q / 2)))
          assert.ok(local.hitTest(derived, point), `${family} ${scale} -> ${target} must cover the old outline`);
      assert.equal(d.serialize(source), before);
    }
  }
  for (const scale of ["S", "M", "L", "XL"]) {
    const source = d.create({ id: "large", scale, projection: { ...projection, columns: 24000 } });
    for (const target of ["S", "M", "L", "XL"]) {
      const derived = scales.derive(source, { id: "large-derived", scale: target });
      assert.deepEqual(plain(derived.metadata.projection), plain(source.metadata.projection));
      assert.equal(derived.terrainBlocks.length, 0);
    }
  }
});

test("local refinement samples registered centers, preserves paths and label positions, and rebases anchors", () => {
  const source = create({ scale: "M", extent: { width: 3, height: 3, origin: [-12, 8] }, anchor: anchor(37) });
  source.setTerrain("local", 0, 0, "forest");
  source.setTerrain("local", 1, -1, "hills");
  const first = source.tilePosition(tile()), last = source.tilePosition(tile(2, -2));
  source.putPath({ id: "road", type: "road", points: [first, last] });
  source.putLandmark({ id: "town", type: "town", tile: tile() });
  source.putLabel({ id: "label", text: "Port \u03b1\n<&>", tile: tile(1, -1), size: 15, rotation: 37, offset: [.2, -.3] });
  const before = d.serialize(source), derived = scales.derive(source, { id: "fine", scale: "S" });
  assert.notDeepEqual(plain(derived.metadata.extent.origin), plain(source.metadata.extent.origin));
  for (const t of local.tiles(derived, local.bounds(derived))) {
    const p = derived.tilePosition(t), old = local.hitTest(source, [p.east, p.north]);
    assert.equal(derived.terrainAt(t.panelId, t.q, t.r), old ? source.terrainAt(old.panelId, old.q, old.r) : source.metadata.defaultTerrain);
  }
  assert.deepEqual(plain(derived.paths), plain(source.paths));
  const oldLabel = labelPoint(source, source.labels[0]), nextLabel = labelPoint(derived, derived.labels[0]);
  close(oldLabel.east, nextLabel.east); close(oldLabel.north, nextLabel.north);
  assert.equal(derived.labels[0].text, source.labels[0].text);
  assert.equal(derived.labels[0].rotation, 37);
  const p = [-11, 6], a = scales.toGlobal(source, p), b = scales.toGlobal(derived, p);
  close(a.east, b.east); close(a.north, b.north);
  assert.equal(derived.landmarks[0].id, "town");
  assert.equal(d.serialize(source), before);
  assert.equal(d.serialize(d.parse(d.serialize(derived))), d.serialize(derived));
  const clone = scales.derive(source, { id: "clone", name: source.metadata.name, scale: "M" });
  assert.deepEqual(plain(clone.labels), plain(source.labels));
  assert.deepEqual(plain(clone.metadata.extent), plain(source.metadata.extent));
  clone.setTerrain("local", 0, 0, "desert");
  assert.equal(d.serialize(source), before);
});

test("coarsening chooses covered area rather than center terrain, with stable catalog ties and default padding", () => {
  const source = create({ extent: { width: 30, height: 30, origin: [0, 0] } });
  const center = g.hexCenter({ origin: [0, 0], spacing: 6 }, 2, -3);
  const seed = local.hitTest(source, center);
  for (const t of local.tiles(source, local.bounds(source))) source.setTerrain(t.panelId, t.q, t.r, "forest");
  source.setTerrain(seed.panelId, seed.q, seed.r, "desert");
  let coarse = scales.derive(source, { id: "majority", scale: "M" });
  let target = local.hitTest(coarse, center);
  assert.equal(coarse.terrainAt(target.panelId, target.q, target.r), "forest");
  for (const t of local.tiles(source, local.bounds(source)))
    source.setTerrain(t.panelId, t.q, t.r, t.q < seed.q ? "desert" : t.q > seed.q ? "forest" : "plain");
  coarse = scales.derive(source, { id: "tie", scale: "M" });
  target = local.hitTest(coarse, center);
  assert.equal(coarse.terrainAt(target.panelId, target.q, target.r), "desert", "Equal desert/forest areas use terrain catalog order");
  assert.equal(coarse.terrainAt("local", 0, 0), "plain", "Outside source coverage retains the declared default");
  assert.equal(d.serialize(scales.derive(source, { id: "tie", scale: "M" })), d.serialize(coarse));
});

test("global refinement respects periodic ownership and partial fragments, including seam paths", () => {
  const source = d.create({ id: "world", projection }), world = global.world(source);
  source.setTerrain("Hyz+-", 0, 0, "forest");
  source.setTerrain("Sz-", -1, 0, "lakes");
  source.putLandmark({ id: "mine", type: "mine", tile: tile(-1, 0, "Sz-") });
  const across = global.hitTest(source, "Hyz+-", [-world.width / 2 - 100, 0]);
  source.putPath({ id: "river", type: "river", points: layers.pathPoints(source, [
    { panelId: "Hyz+-", east: -world.width / 2 + 20, north: 0 },
    { panelId: across.faceId, east: across.point[0], north: across.point[1] }
  ]) });
  const before = d.serialize(source), derived = scales.derive(source, { id: "world-fine", scale: "L" });
  assert.deepEqual(plain(derived.paths), plain(source.paths));
  assert.equal(derived.landmarks[0].id, "mine");
  let partial = 0, protruding = 0;
  for (const entry of derived.terrainEntries()) {
    const p = layers.anchor(derived, reference(entry));
    const old = global.locate(source, p.panelId, [p.east, p.north]).tile;
    assert.equal(entry.terrain, source.terrainAt(old.panelId, old.q, old.r));
    if (entry.panelId === "Sz-") partial++;
    if (g.tileGeometry(global.world(derived), entry.panelId, entry.q, entry.r).fragments.some(f => f.faceId !== entry.panelId)) protruding++;
  }
  assert.ok(partial > 0 && protruding > 0);
  assert.equal(d.serialize(source), before);
  function reference(t) { return { panelId: t.panelId, q: t.q, r: t.r }; }
});

test("coarsening reanchors labels across owning faces without moving their physical text", () => {
  const source = d.create({ id: "labels", scale: "L", projection });
  const blank = scales.derive(source, { id: "blank", scale: "XL" }), world = global.world(source);
  let sourceTile;
  for (const face of world.strip) {
    for (const shape of g.tiles(world, face)) {
      const t = tile(shape.q, shape.r, face), p = layers.anchor(source, t);
      const next = global.locate(blank, p.panelId, [p.east, p.north]).tile;
      if (layers.anchor(blank, next).panelId !== p.panelId) { sourceTile = t; break; }
    }
    if (sourceTile) break;
  }
  assert.ok(sourceTile);
  source.putLabel({ id: "seam-label", text: "Seam", tile: sourceTile, size: 12, rotation: 23, offset: [3, -2] });
  const target = scales.derive(source, { id: "coarse-labels", scale: "XL" });
  const before = labelPoint(source, source.labels[0]), after = labelPoint(target, target.labels[0]);
  const edge = g.projection.solid.edges.find(edge => edge.faces.includes(before.panelId) && edge.faces.includes(after.panelId));
  const unfolded = g.seamTransform(world, edge.id, after.panelId, [after.east, after.north]).point;
  close(before.east, unfolded[0]); close(before.north, unfolded[1]);
  close(target.labels[0].rotation, 23);
  const displayedBefore = layers.labelPosition(source, source.labels[0]), displayedAfter = layers.labelPosition(target, target.labels[0]);
  assert.equal(displayedAfter.panelId, displayedBefore.panelId);
  close(displayedBefore.east, displayedAfter.east); close(displayedBefore.north, displayedAfter.north);
  close(displayedBefore.rotation, displayedAfter.rotation);
});

test("global coarsening matches a full geometric area reference across partial and owned seam fragments", () => {
  const source = d.create({ id: "area-world", scale: "L", projection }), world = global.world(source);
  const byFace = new Map(Object.keys(world.panels).map(id => [id, []]));
  for (const faceId of Object.keys(world.panels)) for (const shape of g.tiles(world, faceId)) {
    const terrain = ["forest", "hills", "water"][Math.abs(shape.q * 3 + shape.r) % 3];
    source.setTerrain(faceId, shape.q, shape.r, terrain);
    for (const fragment of shape.fragments) byFace.get(fragment.faceId).push({
      terrain, polygon: fragment.polygon.map(p => p.map((v, i) => v - fragment.offset[i]))
    });
  }
  const coarse = scales.derive(source, { id: "area-coarse", scale: "XL" }), coarseWorld = global.world(coarse);
  let partial = 0, protruding = 0;
  for (const faceId of Object.keys(coarseWorld.panels)) for (const shape of g.tiles(coarseWorld, faceId)) {
    const weights = new Map(d.TERRAINS.map(t => [t.id, 0]));
    let total = 0;
    for (const fragment of shape.fragments) {
      const polygon = fragment.polygon.map(p => p.map((v, i) => v - fragment.offset[i]));
      total += g.area(polygon);
      for (const item of byFace.get(fragment.faceId))
        weights.set(item.terrain, weights.get(item.terrain) + g.area(g.clip(item.polygon, polygon)));
    }
    close([...weights.values()].reduce((sum, area) => sum + area, 0) / total, 1);
    let expected, best = -1;
    for (const terrain of d.TERRAINS) if (weights.get(terrain.id) > best + total * 1e-10) {
      best = weights.get(terrain.id); expected = terrain.id;
    }
    assert.equal(coarse.terrainAt(faceId, shape.q, shape.r), expected, `${faceId}:${shape.q}:${shape.r}`);
    if (total < g.area(g.hexPolygon(g.gridFor(coarseWorld, faceId), shape.q, shape.r)) - 1e-6) partial++;
    if (shape.fragments.some(f => f.faceId !== faceId)) protruding++;
  }
  assert.ok(partial && protruding);
});

test("anchor rebasing outside its geometric face rejects conversion without changing the source", () => {
  const world = g.createWorld(projection), source = create({ anchor: {
    ...anchor(), east: -world.width / 2, north: 0
  } });
  const before = d.serialize(source);
  assert.throws(() => scales.derive(source, { id: "outside", scale: "M" }), /resized local origin falls outside/);
  assert.equal(d.serialize(source), before);
});

test("collisions, unsupported family changes, unsafe identities, and oversized conversions preserve the source", () => {
  const source = create();
  source.putLandmark({ id: "one", type: "town", tile: tile() });
  source.putLandmark({ id: "two", type: "mine", tile: tile(1) });
  const before = d.serialize(source);
  assert.throws(() => scales.derive(source, { id: "coarse", scale: "M" }), /one and two would share tile/);
  assert.throws(() => scales.derive(source, { id: "changed", scale: "M", scaleFamily: "local" }), /family cannot change/);
  assert.throws(() => scales.derive(source, { id: "source", scale: "M" }), /new map ID/);
  assert.throws(() => scales.derive(source, { id: "bad", scale: "XXL" }), /target resolution/);
  assert.equal(d.serialize(source), before);
  const large = create({ scaleFamily: "local", scale: "XL" });
  large.setTerrain("local", 2, -2, "forest");
  const original = d.serialize(large);
  assert.throws(() => scales.derive(large, { id: "too-fine", scale: "S" }), /100,000-candidate-cell limit/);
  assert.equal(d.serialize(large), original);
});

test("sparse terrain iteration is deterministic and detached from model storage", () => {
  const map = create();
  map.setTerrain("local", 2, -2, "hills"); map.setTerrain("local", 0, 0, "forest");
  const entries = [...map.terrainEntries()];
  assert.deepEqual(plain(entries), [
    { panelId: "local", q: 0, r: 0, terrain: "forest" }, { panelId: "local", q: 2, r: -2, terrain: "hills" }
  ]);
  entries[0].terrain = "desert";
  assert.equal(map.terrainAt("local", 0, 0), "forest");
  map.setTerrain("local", 0, 0, "plain");
  assert.equal([...map.terrainEntries()].length, 1);
});
