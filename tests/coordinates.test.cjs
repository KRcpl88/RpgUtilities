'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Projection, Lattice, Topology, Coordinates } = LoadModules();
const g_Built = Projection.Build();

test('universal ↔ tile round trips for every tile', () => {
  for (const [nPanelHexes, szScale] of [[4, 'XL'], [24, 'XL'], [4, 'L']]) {
    const Topo = Topology.Build(nPanelHexes, szScale);
    for (let nTile = 0; nTile < Topo.nTiles; nTile++) {
      const Location = Coordinates.TileToUniversal(Topo, nTile);
      assert.equal(Coordinates.UniversalToTile(Topo, Location), nTile);
    }
  }
});

test('UniversalToTile snaps within 0.25·d and rejects anything farther', () => {
  const Topo = Topology.Build(24, 'XL');
  const dD = 216;
  const Random = Util.CreateRng(11);
  for (let nTrial = 0; nTrial < 200; nTrial++) {
    const nTile = Math.floor(Random() * Topo.nTiles);
    const Center = Coordinates.TileToUniversal(Topo, nTile);
    const dAngle = Random() * 2 * Math.PI;
    const Near = Coordinates.MakeLocation(Center.szPanel, Center.dEast + 0.24 * dD * Math.cos(dAngle), Center.dNorth + 0.24 * dD * Math.sin(dAngle));
    assert.equal(Coordinates.UniversalToTile(Topo, Near), nTile);
    const Far = Coordinates.MakeLocation(Center.szPanel, Center.dEast + 0.3 * dD * Math.cos(dAngle), Center.dNorth + 0.3 * dD * Math.sin(dAngle));
    assert.equal(Coordinates.UniversalToTile(Topo, Far), -1);
  }
  assert.equal(Coordinates.UniversalToTile(Topo, Coordinates.MakeLocation('Hxz+-', 1e6, 0)), -1);
});

test('equatorial coordinates: north from the equator, east from the centreline', () => {
  const Topo = Topology.Build(24, 'XL');
  for (const szPanel of g_Built.rgszEquatorialWestToEast) {
    const rgLocations = Topo.rgTiles.filter((Tile) => Tile.szPanel === szPanel)
      .map((Tile) => Coordinates.TileToUniversal(Topo, Tile.nIndex));
    const rgdEast = [...new Set(rgLocations.map((Location) => Math.round(Location.dEast * 1e6) / 1e6))].sort((dA, dB) => dA - dB);
    assert.equal(rgdEast.length, 24);
    assert.ok(Math.abs(rgdEast[0] + rgdEast[23]) < 1e-6, 'columns are symmetric about the centreline');
    assert.ok(Math.abs(rgdEast[12] - 216 * Math.sqrt(3) / 4) < 1e-6, 'nearest column is half a column east');
    assert.ok(rgLocations.some((Location) => Math.abs(Location.dNorth) < 1e-9), 'a hex sits on the equator');
  }
});

test('format and parse universal coordinates', () => {
  const Location = Coordinates.MakeLocation('Hxz+-', -187.14, 324);
  assert.equal(Coordinates.FormatUniversal(Location), 'Eta 187.1W 324.0N');
  assert.equal(Coordinates.FormatUniversal(Coordinates.MakeLocation('Sz-', 0.01, -0.04)), 'Nu 0.0E 0.0N');
  assert.equal(Coordinates.FormatUniversal(Coordinates.MakeLocation('Hyz+-', 12.25, -3.5), 2), 'Alpha 12.25E 3.50S');
  assert.deepEqual({ ...Coordinates.ParseUniversal('Eta 187.1W 324.0N') }, { szPanel: 'Hxz+-', dEast: -187.1, dNorth: 324 });
  assert.deepEqual({ ...Coordinates.ParseUniversal('  omicron 5e 0s ') }, { szPanel: 'Sx+', dEast: 5, dNorth: 0 });
  assert.throws(() => Coordinates.ParseUniversal('Eta 5 5'), /Invalid/);
  assert.throws(() => Coordinates.ParseUniversal('Omega 5E 5N'), /Unknown panel/);
  const Topo = Topology.Build(24, 'XL');
  for (let nTile = 0; nTile < Topo.nTiles; nTile += 37) {
    const szText = Coordinates.FormatUniversal(Coordinates.TileToUniversal(Topo, nTile));
    assert.equal(Coordinates.UniversalToTile(Topo, Coordinates.ParseUniversal(szText)), nTile, szText);
  }
});

test('regional local maps snap their anchor and nest in the global lattice', () => {
  for (const szScale of ['XL', 'L', 'M']) {
    for (const szPanel of ['Hxz+-', g_Built.rgszEquatorialWestToEast[3], 'Sy+']) {
      const Local = Coordinates.CreateLocalMap({
        nWidth: 20, nHeight: 15, szSystem: 'regional', szScale,
        Anchor: Coordinates.MakeLocation(szPanel, -123.4, 456.7), nPanelHexes: 24, fFlat: true,
      });
      const dD = Lattice.ScaleDistance('regional', szScale);
      assert.ok(Math.hypot(Local.Anchor.dEast + 123.4, Local.Anchor.dNorth - 456.7) <= dD, 'anchor moves less than a hex');
      const PanelLatticeInfo = Topology.PanelLattice(szPanel, 24, Lattice.ScaleRatio('regional', 'XL', szScale));
      const dMilesPerEdge = PanelLatticeInfo.dMilesPerEdge;
      for (const [nX, nY] of [[0, 0], [1, 0], [2, 3], [7, 14], [19, 0], [19, 14]]) {
        const Location = Coordinates.LocalTileToUniversal(Local, nX, nY);
        const [nQ, nJ] = Topology.LatticeNearest(PanelLatticeInfo, Location.dEast / dMilesPerEdge, Location.dNorth / dMilesPerEdge);
        const rgdCenter = Topology.LatticeCenter(PanelLatticeInfo, nQ, nJ);
        assert.ok(Math.hypot(rgdCenter[0] * dMilesPerEdge - Location.dEast, rgdCenter[1] * dMilesPerEdge - Location.dNorth) < 1e-6,
          `${szScale} ${szPanel} local ${nX},${nY} is a global lattice centre`);
        assert.deepEqual([nQ, nJ], [Local.rgnAnchorLattice[0] + nX, Local.rgnAnchorLattice[1] - nY]);
        assert.deepEqual(Coordinates.UniversalToLocalTile(Local, Location), [nX, nY]);
      }
      assert.equal(Coordinates.UniversalToLocalTile(Local, Coordinates.LocalTileToUniversal(Local, 20, 0)), null);
      assert.equal(Coordinates.UniversalToLocalTile(Local, Coordinates.MakeLocation('Sx-', 0, 0)), null);
    }
  }
});

test('a global XL tile centre is a tile centre of a regional M local map anchored on it', () => {
  const Topo = Topology.Build(24, 'XL');
  const Anchor = Coordinates.TileToUniversal(Topo, Topology.TileAt(Topo, 'Hxz+-', 0, 0));
  const Local = Coordinates.CreateLocalMap({ nWidth: 80, nHeight: 80, szSystem: 'regional', szScale: 'M', Anchor });
  const Neighbor = Coordinates.TileToUniversal(Topo, Topology.TileAt(Topo, 'Hxz+-', 1, -1));
  const rgnTile = Coordinates.UniversalToLocalTile(Local, Neighbor);
  assert.deepEqual(rgnTile, [36, 18]);
  const Back = Coordinates.LocalTileToUniversal(Local, ...rgnTile);
  assert.ok(Math.hypot(Back.dEast - Neighbor.dEast, Back.dNorth - Neighbor.dNorth) < 1e-6);
});

test('local-scale (yard) maps are positioned freely', () => {
  const Anchor = Coordinates.MakeLocation('Sz-', 10.5, -20.25);
  const Local = Coordinates.CreateLocalMap({ nWidth: 10, nHeight: 10, szSystem: 'local', szScale: 'L', Anchor });
  assert.deepEqual({ ...Local.Anchor }, { ...Anchor });
  const Location = Coordinates.LocalTileToUniversal(Local, 1, 2);
  const dD = 100 / 1760;
  assert.ok(Math.abs(Location.dEast - (10.5 + dD * Math.sqrt(3) / 2)) < 1e-12);
  assert.ok(Math.abs(Location.dNorth - (-20.25 + dD / 2 - 2 * dD)) < 1e-12);
  assert.deepEqual(Coordinates.UniversalToLocalTile(Local, Location), [1, 2]);
  assert.throws(() => Coordinates.CreateLocalMap({ nWidth: 0, nHeight: 1, szSystem: 'local', szScale: 'L', Anchor }), /positive/);
});
