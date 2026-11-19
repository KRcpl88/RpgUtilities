'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection, Lattice: lattice, Topology: topology } = loadModules();
const builtProjection = projection.build();
const CASES = [[4, 'XL'], [8, 'XL'], [24, 'XL'], [4, 'L']];

function panelArea(panelId) {
  return util.polygonArea(builtProjection.frames[panelId].polygon);
}

function isConnected(topo) {
  const seen = new Uint8Array(topo.tileCount);
  const stack = [0];
  seen[0] = 1;
  let seenCount = 1;
  while (stack.length) {
    for (const next of topology.neighbors(topo, stack.pop())) {
      if (!seen[next]) {
        seen[next] = 1;
        seenCount++;
        stack.push(next);
      }
    }
  }
  return seenCount === topo.tileCount;
}

test('panel frames are counter-clockwise in [east, north]', () => {
  for (const panelId of Object.keys(builtProjection.panels)) {
    assert.ok(panelArea(panelId) > 0, panelId);
  }
});

test('Build validates its arguments and caches', () => {
  assert.throws(() => topology.build(5), /even/);
  assert.throws(() => topology.build(24, 'M'), /tile scale/);
  assert.equal(topology.build(4), topology.build(4, 'XL'));
});

for (const [panelHexes, scaleName] of CASES) {
  test(`n=${panelHexes} ${scaleName}: tiles, partial areas and indexing`, () => {
    const topo = topology.build(panelHexes, scaleName);
    const ratio = lattice.scaleRatio('regional', 'XL', scaleName);
    assert.ok(Math.abs(topo.d * topo.milesPerEdge - 216 / ratio) < 1e-9, 'hex spacing in miles');
    // Every panel owns exactly the area inside its polygon.
    let stripTiles = 0;
    for (const panelId of topo.panelIds) {
      const info = topo.panels[panelId];
      let tiles = 0;
      for (let tileIndex = info.firstTile; tileIndex < info.firstTile + info.tileCount; tileIndex++) {
        tiles += topo.tiles[tileIndex].area;
      }
      assert.ok(Math.abs(tiles - panelArea(panelId)) < 1e-9, `${panelId} area`);
      if (info.lattice.isEquatorial) {
        stripTiles += tiles;
      } else {
        assert.ok(Math.abs(tiles - panelArea(panelId)) < 1e-9, `${panelId} area`);
      }
    }
    const stripArea = builtProjection.equatorialWestToEast.reduce((sum, panelId) => sum + panelArea(panelId), 0);
    assert.ok(Math.abs(stripTiles - stripArea) < 1e-9, 'equatorial strip area');
    // Index round trips, ordering and geometry of every tile.
    topo.tiles.forEach((tile, index) => {
      assert.equal(tile.index, index);
      assert.equal(topology.tileAt(topo, tile.panelId, tile.latticeColumn, tile.latticeRow), index);
      assert.equal(topology.tileByColumnRow(topo, tile.panelId, tile.column, tile.row), index);
      const info = topo.panels[tile.panelId];
      assert.ok(tile.column >= 0 && tile.column < info.columnCount && tile.row >= 0 && tile.row < info.rowCount);
      assertCenter(topo, tile);
      assert.ok(tile.area > topology.MIN_AREA_FRACTION * topo.hexArea && tile.area <= topo.hexArea * (1 + 1e-12));
      if (tile.isPartial) {
        const pieces = tile.pieces.reduce((sum, piece) => sum + util.polygonArea(piece.polygon), 0);
        assert.ok(Math.abs(pieces - tile.area) < 1e-12);
      }
      if (index > 0 && topo.tiles[index - 1].panelId === tile.panelId) {
        const previous = topo.tiles[index - 1];
        assert.ok(previous.row < tile.row || (previous.row === tile.row && previous.column < tile.column),
          'tiles run north to south, then west to east');
      }
    });
    const wholeTiles = 36.9096 / topo.hexArea;
    assert.ok(topo.tileCount > wholeTiles && topo.tileCount < wholeTiles + 30 * Math.sqrt(wholeTiles), 'tile count');
  });

  test(`n=${panelHexes} ${scaleName}: equatorial seams split aligned hexes in half`, () => {
    const topo = topology.build(panelHexes, scaleName);
    const spanWidth = builtProjection.equatorialWidth;
    for (const panelId of builtProjection.equatorialWestToEast) {
      const info = topo.panels[panelId];
      assert.equal(info.lattice.columnCount, panelHexes * topo.ratio);
      assert.equal(info.columnCount, info.lattice.columnCount + 1, 'two half columns and the interior columns');
      const polygon = builtProjection.frames[panelId].polygon;
      const edgeNorths = (east) => polygon.filter((point) => Math.abs(point[0] - east) < 1e-9).map((point) => point[1]);
      const edges = [edgeNorths(-spanWidth / 2), edgeNorths(spanWidth / 2)];
      assert.ok(edges.every((edgeDirection) => edgeDirection.length === 2), 'two vertical edges');
      const radius = lattice.hexRadius(topo.d);
      for (let tileIndex = info.firstTile; tileIndex < info.firstTile + info.tileCount; tileIndex++) {
        const tile = topo.tiles[tileIndex];
        assert.ok(Math.abs(tile.center[0]) <= spanWidth / 2 + 1e-12, 'column centre in panel');
        const edgeDirection = tile.column === 0 ? edges[0] : (tile.column === info.columnCount - 1 ? edges[1] : null);
        if (edgeDirection && tile.center[1] - radius > Math.min(...edgeDirection) && tile.center[1] + radius < Math.max(...edgeDirection)) {
          assert.equal(tile.isPartial, true, `${panelId} east/west tiles are partial`);
          assert.ok(Math.abs(tile.area / topo.hexArea - 0.5) < 1e-9, 'exactly half a hex');
          assert.ok(tile.pieces.every((piece) => piece.panelId === panelId
            && piece.polygon.every((point) => util.pointInConvex(point, polygon, 1e-9))));
          const otherId = tile.column === 0 ? info.westPanel : info.eastPanel;
          const otherColumn = tile.column === 0 ? info.lattice.columnCount : 0;
          const other = topology.tileAt(topo, otherId, otherColumn, tile.latticeRow);
          assert.ok(topology.areAdjacent(topo, tile.index, other), 'matching halves are adjacent');
        }
      }
      // Both boundary columns have the same row phase.
      const lattice0 = info.lattice;
      const firstPoint = topology.latticeCenter(lattice0, 0, 0);
      const last = topology.latticeCenter(lattice0, lattice0.columnCount, 0);
      assert.equal(last[1], firstPoint[1]);
      assert.ok(Math.abs(firstPoint[0] + spanWidth / 2) < 1e-12, 'first column on the west edge');
      assert.ok(Math.abs(spanWidth / 2 - last[0]) < 1e-12, 'last column on the east edge');
      const next = util.add(topology.latticeCenter(lattice0, lattice0.columnCount, 0), [-spanWidth, 0]);
      assertPointClose(next, firstPoint, 'the strip lattice repeats every panel');
    }
  });

  test(`n=${panelHexes} ${scaleName}: primary column on the bisector of other panels`, () => {
    const topo = topology.build(panelHexes, scaleName);
    for (const panelId of topo.panelIds.filter((id) => !builtProjection.panels[id].isEquatorial)) {
      const center = topology.tileAt(topo, panelId, 0, 0);
      assert.ok(center >= 0 && !topo.tiles[center].isPartial, `${panelId} has a whole tile at its centre`);
      assertPointClose(topo.tiles[center].center, [0, 0], `${panelId} reference point`);
      const frame = builtProjection.frames[panelId];
      for (const vertexId of [frame.northVertex, frame.southVertex]) {
        const vertex = frame.polygon[frame.vertexIds.indexOf(vertexId)];
        assert.ok(Math.abs(vertex[0]) < 1e-9, 'north and south vertices on column 0');
      }
      const primary = topo.tiles.filter((tile) => tile.panelId === panelId && tile.latticeColumn === 0);
      assert.ok(primary.length > 2 && primary.every((tile) => Math.abs(tile.center[0]) < 1e-15));
    }
  });

  test(`n=${panelHexes} ${scaleName}: adjacency is symmetric, connected, and wraps the strip`, () => {
    const topo = topology.build(panelHexes, scaleName);
    assert.equal(topo.adjacencyOffsets.length, topo.tileCount + 1);
    for (let tileIndex = 0; tileIndex < topo.tileCount; tileIndex++) {
      const neighborIndices = topology.neighbors(topo, tileIndex);
      for (const otherIndex of neighborIndices) {
        assert.notEqual(otherIndex, tileIndex);
        assert.ok(topology.areAdjacent(topo, otherIndex, tileIndex), `${tileIndex}↔${otherIndex} symmetric`);
      }
      const tile = topo.tiles[tileIndex];
      if (!tile.isPartial) {
        assert.equal(neighborIndices.length, 6, `whole tile ${tile.panelId} ${tile.column},${tile.row} has 6 neighbours`);
        for (let direction = 0; direction < 6; direction++) {
          const [q, j] = lattice.offsetNeighbor(tile.latticeColumn, tile.latticeRow, direction);
          assert.ok(neighborIndices.includes(topology.locateLattice(topo, tile.panelId, q, j)));
        }
      } else {
        assert.ok(neighborIndices.length >= 1);
      }
    }
    assert.ok(isConnected(topo), 'every tile is reachable');
    // Zeta's east column touches Epsilon's west column across the cut.
    const strip = builtProjection.equatorialWestToEast;
    const zetaId = strip[5];
    const epsilon = strip[0];
    const zeta = topo.panels[zetaId];
    const zetaTile = topology.tileAt(topo, zetaId, zeta.lattice.columnCount, 0);
    const epsilonTile = topology.tileAt(topo, epsilon, 0, 0);
    assert.ok(zetaTile >= 0 && epsilonTile >= 0);
    assert.ok(topology.areAdjacent(topo, zetaTile, epsilonTile), 'strip wraps');
    // Neighbouring panels are linked across every seam.
    for (const seam of builtProjection.seams) {
      const linked = topo.tiles.some((tile) => tile.panelId === seam.panelA
        && topology.neighbors(topo, tile.index).some((otherIndex) => topo.tiles[otherIndex].panelId === seam.panelB));
      assert.ok(linked, `seam ${seam.edge} links ${seam.panelA} and ${seam.panelB}`);
    }
  });
}

test('n=24 XL: about 10.33·n² tiles and an equatorial width of ≈4489 mi', () => {
  const topo = topology.build(24, 'XL');
  assert.ok(Math.abs(builtProjection.equatorialWidth * topo.milesPerEdge - 4489.48) < 0.01);
  assert.ok(Math.abs(36.9096 / topo.hexArea - 10.33 * 24 * 24) < 10);
  for (const panelId of builtProjection.equatorialWestToEast) {
    const tiles = topo.tiles.filter((tile) => tile.panelId === panelId);
    assert.ok(tiles.some((tile) => Math.abs(tile.center[0]) < 1e-12), 'a column bisects the panel');
  }
});

test('equatorial seams bisect hex columns at every regional scale and panel size', () => {
  const spanWidth = builtProjection.equatorialWidth;
  for (const panelHexes of [2, 4, 8, 24]) {
    for (const scaleName of ['XL', 'L', 'M', 'S']) {
      const ratio = lattice.scaleRatio('regional', 'XL', scaleName);
      for (const [panelIndex, panelId] of builtProjection.equatorialWestToEast.entries()) {
        const info = topology.panelLattice(panelId, panelHexes, ratio);
        const first = topology.latticeCenter(info, 0, 0);
        const last = topology.latticeCenter(info, info.columnCount, 0);
        const caseLabel = `${panelId} n=${panelHexes} ${scaleName}`;
        assert.ok(Math.abs(first[0] + spanWidth / 2) < 1e-12, `${caseLabel}: west seam through centres`);
        assert.ok(Math.abs(spanWidth / 2 - last[0]) < 1e-12, `${caseLabel}: east seam through centres`);
        assert.ok(Math.abs(first[0] + last[0]) < 1e-12, `${caseLabel}: symmetric east/west columns`);
        const [q, j] = topology.latticeNearest(info, 0, 0);
        const middle = topology.latticeCenter(info, q, j);
        assert.ok(Math.abs(middle[0]) < 1e-12, `${caseLabel}: centreline column`);
        const nextId = builtProjection.equatorialWestToEast[(panelIndex + 1) % 6];
        const seam = projection.findSeam(panelId, nextId);
        const transform = seam.panelA === panelId ? seam.aToB : seam.bToA;
        const beyond = topology.latticeCenter(info, info.columnCount, 0);
        const next = topology.panelLattice(nextId, panelHexes, ratio);
        assertPointClose(projection.applyTransform(transform, beyond), topology.latticeCenter(next, 0, 0),
          `${caseLabel}: continuous wrap into ${nextId}`, 1e-12);
      }
    }
  }
});

test('equatorial coarse centres nest exactly at finer regional scales', () => {
  for (const panelId of builtProjection.equatorialWestToEast) {
    const coarse = topology.panelLattice(panelId, 4);
    for (const ratio of [6, 36, 216]) {
      const fine = topology.panelLattice(panelId, 4, ratio);
      for (let column = 0; column <= coarse.columnCount; column++) {
        for (const row of [-1, 0, 1]) {
          const point = topology.latticeCenter(coarse, column, row);
          const [q, j] = topology.latticeNearest(fine, ...point);
          assertPointClose(topology.latticeCenter(fine, q, j), point, `${panelId} ratio ${ratio}`, 1e-12);
        }
      }
    }
  }
});

test('TilePolygons returns clipped pieces for partial tiles and a hex otherwise', () => {
  const topo = topology.build(4, 'XL');
  const partial = topo.tiles.find((tile) => tile.isPartial);
  const whole = topo.tiles.find((tile) => !tile.isPartial);
  assert.equal(topology.tilePolygons(topo, partial.index).length, partial.pieces.length);
  const [hex] = topology.tilePolygons(topo, whole.index);
  assert.ok(Math.abs(util.polygonArea(hex) - topo.hexArea) < 1e-12);
});

function assertCenter(topo, tile) {
  const expected = topology.latticeCenter(topo.panels[tile.panelId].lattice, tile.latticeColumn, tile.latticeRow);
  assertPointClose(tile.center, expected, 'tile centre');
}

function assertPointClose(actual, expected, message, tolerance = 1e-9) {
  assert.ok(util.pointDistance(actual, expected) <= tolerance, `${message}: [${actual}] != [${expected}]`);
}
