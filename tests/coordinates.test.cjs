'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');

const { Util: util, Projection: projection, Lattice: lattice, Topology: topology, Coordinates: coordinates } = loadModules();
const builtProjection = projection.build();

test('universal ↔ tile round trips for every tile', () => {
  for (const [panelHexes, scaleName] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const topo = topology.build(panelHexes, scaleName);
    for (let tileIndex = 0; tileIndex < topo.tileCount; tileIndex++) {
      const location = coordinates.tileToUniversal(topo, tileIndex);
      assert.equal(coordinates.universalToTile(topo, location), tileIndex);
    }
  }
});

test('UniversalToTile snaps within 0.25·d and rejects anything farther', () => {
  const topo = topology.build(24, 'XL');
  const d = 216;
  const random = util.createRng(11);
  for (let trial = 0; trial < 200; trial++) {
    const tileIndex = Math.floor(random() * topo.tileCount);
    const center = coordinates.tileToUniversal(topo, tileIndex);
    const angle = random() * 2 * Math.PI;
    const near = coordinates.makeLocation(center.panelId, center.east + 0.24 * d * Math.cos(angle), center.north + 0.24 * d * Math.sin(angle));
    assert.equal(coordinates.universalToTile(topo, near), tileIndex);
    const far = coordinates.makeLocation(center.panelId, center.east + 0.3 * d * Math.cos(angle), center.north + 0.3 * d * Math.sin(angle));
    assert.equal(coordinates.universalToTile(topo, far), -1);
  }
  assert.equal(coordinates.universalToTile(topo, coordinates.makeLocation('Hxz+-', 1e6, 0)), -1);
});

test('equatorial coordinates: north from the equator, east from the centreline', () => {
  const topo = topology.build(24, 'XL');
  for (const panelId of builtProjection.equatorialWestToEast) {
    const locations = topo.tiles.filter((tile) => tile.panelId === panelId)
      .map((tile) => coordinates.tileToUniversal(topo, tile.index));
    const east = [...new Set(locations.map((location) => Math.round(location.east * 1e6) / 1e6))].sort((componentA, componentB) => componentA - componentB);
    assert.equal(east.length, 24);
    assert.ok(Math.abs(east[0] + east[23]) < 1e-6, 'columns are symmetric about the centreline');
    assert.ok(Math.abs(east[12] - 216 * Math.sqrt(3) / 4) < 1e-6, 'nearest column is half a column east');
    assert.ok(locations.some((location) => Math.abs(location.north) < 1e-9), 'a hex sits on the equator');
  }
});

test('format and parse universal coordinates', () => {
  const location = coordinates.makeLocation('Hxz+-', -187.14, 324);
  assert.equal(coordinates.formatUniversal(location), 'Eta 187.1W 324.0N');
  assert.equal(coordinates.formatUniversal(coordinates.makeLocation('Sz-', 0.01, -0.04)), 'Nu 0.0E 0.0N');
  assert.equal(coordinates.formatUniversal(coordinates.makeLocation('Hyz+-', 12.25, -3.5), 2), 'Alpha 12.25E 3.50S');
  assert.deepEqual({ ...coordinates.parseUniversal('Eta 187.1W 324.0N') }, { panelId: 'Hxz+-', east: -187.1, north: 324 });
  assert.deepEqual({ ...coordinates.parseUniversal('  omicron 5e 0s ') }, { panelId: 'Sx+', east: 5, north: 0 });
  assert.throws(() => coordinates.parseUniversal('Eta 5 5'), /Invalid/);
  assert.throws(() => coordinates.parseUniversal('Omega 5E 5N'), /Unknown panel/);
  const topo = topology.build(24, 'XL');
  for (let tileIndex = 0; tileIndex < topo.tileCount; tileIndex += 37) {
    const text = coordinates.formatUniversal(coordinates.tileToUniversal(topo, tileIndex));
    assert.equal(coordinates.universalToTile(topo, coordinates.parseUniversal(text)), tileIndex, text);
  }
});

test('regional local maps snap their anchor and nest in the global lattice', () => {
  for (const scaleName of ['XL', 'L', 'M']) {
    for (const panelId of ['Hxz+-', builtProjection.equatorialWestToEast[3], 'Sy+']) {
      const local = coordinates.createLocalMap({
        width: 20, height: 15, systemName: 'regional', scaleName,
        anchor: coordinates.makeLocation(panelId, -123.4, 456.7), panelHexes: 24, isFlat: true,
      });
      const d = lattice.scaleDistance('regional', scaleName);
      assert.ok(Math.hypot(local.anchor.east + 123.4, local.anchor.north - 456.7) <= d, 'anchor moves less than a hex');
      const panelLatticeInfo = topology.panelLattice(panelId, 24, lattice.scaleRatio('regional', 'XL', scaleName));
      const milesPerEdge = panelLatticeInfo.milesPerEdge;
      for (const [columnIndex, rowIndex] of [[0, 0], [1, 0], [2, 3], [7, 14], [19, 0], [19, 14]]) {
        const location = coordinates.localTileToUniversal(local, columnIndex, rowIndex);
        const [q, j] = topology.latticeNearest(panelLatticeInfo, location.east / milesPerEdge, location.north / milesPerEdge);
        const center = topology.latticeCenter(panelLatticeInfo, q, j);
        assert.ok(Math.hypot(center[0] * milesPerEdge - location.east, center[1] * milesPerEdge - location.north) < 1e-6,
          `${scaleName} ${panelId} local ${columnIndex},${rowIndex} is a global lattice centre`);
        assert.deepEqual([q, j], [local.anchorLattice[0] + columnIndex, local.anchorLattice[1] - rowIndex]);
        assert.deepEqual(coordinates.universalToLocalTile(local, location), [columnIndex, rowIndex]);
      }
      assert.equal(coordinates.universalToLocalTile(local, coordinates.localTileToUniversal(local, 20, 0)), null);
      assert.equal(coordinates.universalToLocalTile(local, coordinates.makeLocation('Sx-', 0, 0)), null);
    }
  }
});

test('a global XL tile centre is a tile centre of a regional M local map anchored on it', () => {
  const topo = topology.build(24, 'XL');
  const anchor = coordinates.tileToUniversal(topo, topology.tileAt(topo, 'Hxz+-', 0, 0));
  const local = coordinates.createLocalMap({ width: 80, height: 80, systemName: 'regional', scaleName: 'M', anchor });
  const neighbor = coordinates.tileToUniversal(topo, topology.tileAt(topo, 'Hxz+-', 1, -1));
  const tile = coordinates.universalToLocalTile(local, neighbor);
  assert.deepEqual(tile, [36, 18]);
  const back = coordinates.localTileToUniversal(local, ...tile);
  assert.ok(Math.hypot(back.east - neighbor.east, back.north - neighbor.north) < 1e-6);
});

test('local-scale (yard) maps are positioned freely', () => {
  const anchor = coordinates.makeLocation('Sz-', 10.5, -20.25);
  const local = coordinates.createLocalMap({ width: 10, height: 10, systemName: 'local', scaleName: 'L', anchor });
  assert.deepEqual({ ...local.anchor }, { ...anchor });
  const location = coordinates.localTileToUniversal(local, 1, 2);
  const d = 100 / 1760;
  assert.ok(Math.abs(location.east - (10.5 + d * Math.sqrt(3) / 2)) < 1e-12);
  assert.ok(Math.abs(location.north - (-20.25 + d / 2 - 2 * d)) < 1e-12);
  assert.deepEqual(coordinates.universalToLocalTile(local, location), [1, 2]);
  assert.throws(() => coordinates.createLocalMap({ width: 0, height: 1, systemName: 'local', scaleName: 'L', anchor }), /positive/);
});
