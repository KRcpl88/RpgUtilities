'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Projection, Lattice, Topology } = LoadModules();
const g_Built = Projection.Build();
const g_rgCases = [[4, 'XL'], [8, 'XL'], [24, 'XL'], [4, 'L']];

function PanelArea(szPanel) {
  return Util.PolygonArea(g_Built.Frames[szPanel].rgrgdPolygon);
}

function IsConnected(Topo) {
  const rgfSeen = new Uint8Array(Topo.nTiles);
  const rgnStack = [0];
  rgfSeen[0] = 1;
  let nSeen = 1;
  while (rgnStack.length) {
    for (const nNext of Topology.Neighbors(Topo, rgnStack.pop())) {
      if (!rgfSeen[nNext]) {
        rgfSeen[nNext] = 1;
        nSeen++;
        rgnStack.push(nNext);
      }
    }
  }
  return nSeen === Topo.nTiles;
}

test('panel frames are counter-clockwise in [east, north]', () => {
  for (const szPanel of Object.keys(g_Built.Panels)) {
    assert.ok(PanelArea(szPanel) > 0, szPanel);
  }
});

test('Build validates its arguments and caches', () => {
  assert.throws(() => Topology.Build(5), /even/);
  assert.throws(() => Topology.Build(24, 'M'), /tile scale/);
  assert.equal(Topology.Build(4), Topology.Build(4, 'XL'));
});

for (const [nPanelHexes, szScale] of g_rgCases) {
  test(`n=${nPanelHexes} ${szScale}: tiles, partial areas and indexing`, () => {
    const Topo = Topology.Build(nPanelHexes, szScale);
    const nRatio = Lattice.ScaleRatio('regional', 'XL', szScale);
    assert.ok(Math.abs(Topo.dD * Topo.dMilesPerEdge - 216 / nRatio) < 1e-9, 'hex spacing in miles');
    // Tile areas add up to the panel areas: per panel off the equator, and over the strip.
    let dStripTiles = 0;
    for (const szPanel of Topo.rgszPanels) {
      const Info = Topo.Panels[szPanel];
      let dTiles = 0;
      for (let nTile = Info.nFirstTile; nTile < Info.nFirstTile + Info.nTileCount; nTile++) {
        dTiles += Topo.rgTiles[nTile].dArea;
      }
      if (Info.Lattice.fEquatorial) {
        dStripTiles += dTiles;
      } else {
        assert.ok(Math.abs(dTiles - PanelArea(szPanel)) < 1e-9, `${szPanel} area`);
      }
    }
    const dStripArea = g_Built.rgszEquatorialWestToEast.reduce((dSum, szPanel) => dSum + PanelArea(szPanel), 0);
    assert.ok(Math.abs(dStripTiles - dStripArea) < 1e-9, 'equatorial strip area');
    // Index round trips, ordering and geometry of every tile.
    Topo.rgTiles.forEach((Tile, nIndex) => {
      assert.equal(Tile.nIndex, nIndex);
      assert.equal(Topology.TileAt(Topo, Tile.szPanel, Tile.nLatticeColumn, Tile.nLatticeRow), nIndex);
      assert.equal(Topology.TileByColumnRow(Topo, Tile.szPanel, Tile.nColumn, Tile.nRow), nIndex);
      const Info = Topo.Panels[Tile.szPanel];
      assert.ok(Tile.nColumn >= 0 && Tile.nColumn < Info.nColumns && Tile.nRow >= 0 && Tile.nRow < Info.nRows);
      AssertCenter(Topo, Tile);
      assert.ok(Tile.dArea > Topology.g_dMinAreaFraction * Topo.dHexArea && Tile.dArea <= Topo.dHexArea * (1 + 1e-12));
      if (Tile.fPartial) {
        const dPieces = Tile.rgPieces.reduce((dSum, Piece) => dSum + Util.PolygonArea(Piece.rgrgdPolygon), 0);
        assert.ok(Math.abs(dPieces - Tile.dArea) < 1e-12);
      }
      if (nIndex > 0 && Topo.rgTiles[nIndex - 1].szPanel === Tile.szPanel) {
        const Previous = Topo.rgTiles[nIndex - 1];
        assert.ok(Previous.nRow < Tile.nRow || (Previous.nRow === Tile.nRow && Previous.nColumn < Tile.nColumn),
          'tiles run north to south, then west to east');
      }
    });
    const dWholeTiles = 36.9096 / Topo.dHexArea;
    assert.ok(Topo.nTiles > dWholeTiles && Topo.nTiles < dWholeTiles + 30 * Math.sqrt(dWholeTiles), 'tile count');
  });

  test(`n=${nPanelHexes} ${szScale}: equatorial lattice is continuous with whole east/west tiles`, () => {
    const Topo = Topology.Build(nPanelHexes, szScale);
    const dWidth = g_Built.dEquatorialWidth;
    for (const szPanel of g_Built.rgszEquatorialWestToEast) {
      const Info = Topo.Panels[szPanel];
      assert.equal(Info.Lattice.nColumns, nPanelHexes * Topo.nRatio);
      assert.equal(Info.nColumns, Info.Lattice.nColumns, 'every column has tiles');
      const rgrgdPolygon = g_Built.Frames[szPanel].rgrgdPolygon;
      const EdgeNorths = (dEast) => rgrgdPolygon.filter((rgdPoint) => Math.abs(rgdPoint[0] - dEast) < 1e-9).map((rgdPoint) => rgdPoint[1]);
      const rgrgdEdges = [EdgeNorths(-dWidth / 2), EdgeNorths(dWidth / 2)];
      assert.ok(rgrgdEdges.every((rgdEdge) => rgdEdge.length === 2), 'two vertical edges');
      const dRadius = Lattice.HexRadius(Topo.dD);
      for (let nTile = Info.nFirstTile; nTile < Info.nFirstTile + Info.nTileCount; nTile++) {
        const Tile = Topo.rgTiles[nTile];
        assert.ok(Tile.rgdCenter[0] >= -dWidth / 2 - 1e-12 && Tile.rgdCenter[0] < dWidth / 2 - 1e-12, 'column centre in panel');
        const rgdEdge = Tile.nColumn === 0 ? rgrgdEdges[0] : (Tile.nColumn === Info.nColumns - 1 ? rgrgdEdges[1] : null);
        if (rgdEdge && Tile.rgdCenter[1] - dRadius > Math.min(...rgdEdge) && Tile.rgdCenter[1] + dRadius < Math.max(...rgdEdge)) {
          assert.equal(Tile.fPartial, false, `${szPanel} east/west tiles are whole`);
        }
      }
      // The east-most column lines up with the next panel's first column, half a hex above this panel's first.
      const Lattice0 = Info.Lattice;
      const rgdFirst = Topology.LatticeCenter(Lattice0, Lattice0.nColumnShift, 0);
      const rgdLast = Topology.LatticeCenter(Lattice0, Lattice0.nColumnShift + Lattice0.nColumns - 1, 0);
      assert.ok(Math.abs(Math.abs(rgdLast[1] - rgdFirst[1]) - Topo.dD / 2) < 1e-12, 'first and last columns are staggered by half a hex');
      assert.ok(Math.abs(rgdFirst[0] + dWidth / 2 - Topo.dW / 2) < 1e-12, 'first column half a column from the west edge');
      assert.ok(Math.abs(dWidth / 2 - rgdLast[0] - Topo.dW / 2) < 1e-12, 'last column half a column from the east edge');
      const rgdNext = Util.Add(Topology.LatticeCenter(Lattice0, Lattice0.nColumnShift + Lattice0.nColumns, 0), [-dWidth, 0]);
      AssertPointClose(rgdNext, rgdFirst, 'the strip lattice repeats every panel');
    }
  });

  test(`n=${nPanelHexes} ${szScale}: primary column on the bisector of other panels`, () => {
    const Topo = Topology.Build(nPanelHexes, szScale);
    for (const szPanel of Topo.rgszPanels.filter((szId) => !g_Built.Panels[szId].fEquatorial)) {
      const nCenter = Topology.TileAt(Topo, szPanel, 0, 0);
      assert.ok(nCenter >= 0 && !Topo.rgTiles[nCenter].fPartial, `${szPanel} has a whole tile at its centre`);
      AssertPointClose(Topo.rgTiles[nCenter].rgdCenter, [0, 0], `${szPanel} reference point`);
      const Frame = g_Built.Frames[szPanel];
      for (const szVertex of [Frame.szNorthVertex, Frame.szSouthVertex]) {
        const rgdVertex = Frame.rgrgdPolygon[Frame.rgszVertices.indexOf(szVertex)];
        assert.ok(Math.abs(rgdVertex[0]) < 1e-9, 'north and south vertices on column 0');
      }
      const rgPrimary = Topo.rgTiles.filter((Tile) => Tile.szPanel === szPanel && Tile.nLatticeColumn === 0);
      assert.ok(rgPrimary.length > 2 && rgPrimary.every((Tile) => Math.abs(Tile.rgdCenter[0]) < 1e-15));
    }
  });

  test(`n=${nPanelHexes} ${szScale}: adjacency is symmetric, connected, and wraps the strip`, () => {
    const Topo = Topology.Build(nPanelHexes, szScale);
    assert.equal(Topo.rgnAdjacencyOffsets.length, Topo.nTiles + 1);
    for (let nTile = 0; nTile < Topo.nTiles; nTile++) {
      const rgnNeighbors = Topology.Neighbors(Topo, nTile);
      for (const nOther of rgnNeighbors) {
        assert.notEqual(nOther, nTile);
        assert.ok(Topology.AreAdjacent(Topo, nOther, nTile), `${nTile}↔${nOther} symmetric`);
      }
      const Tile = Topo.rgTiles[nTile];
      if (!Tile.fPartial) {
        assert.equal(rgnNeighbors.length, 6, `whole tile ${Tile.szPanel} ${Tile.nColumn},${Tile.nRow} has 6 neighbours`);
        for (let nDirection = 0; nDirection < 6; nDirection++) {
          const [nQ, nJ] = Lattice.OffsetNeighbor(Tile.nLatticeColumn, Tile.nLatticeRow, nDirection);
          assert.ok(rgnNeighbors.includes(Topology.LocateLattice(Topo, Tile.szPanel, nQ, nJ)));
        }
      } else {
        assert.ok(rgnNeighbors.length >= 1);
      }
    }
    assert.ok(IsConnected(Topo), 'every tile is reachable');
    // Zeta's east column touches Epsilon's west column across the cut.
    const rgszStrip = g_Built.rgszEquatorialWestToEast;
    const szZeta = rgszStrip[5];
    const szEpsilon = rgszStrip[0];
    const Zeta = Topo.Panels[szZeta];
    const nZetaTile = Topology.TileAt(Topo, szZeta, Zeta.Lattice.nColumnShift + Zeta.Lattice.nColumns - 1, 0);
    const nEpsilonTile = Topology.TileAt(Topo, szEpsilon, Zeta.Lattice.nColumnShift, 0);
    assert.ok(nZetaTile >= 0 && nEpsilonTile >= 0);
    assert.ok(Topology.AreAdjacent(Topo, nZetaTile, nEpsilonTile), 'strip wraps');
    // Neighbouring panels are linked across every non-equatorial seam.
    for (const Seam of g_Built.Seams) {
      const fLinked = Topo.rgTiles.some((Tile) => Tile.szPanel === Seam.szPanelA
        && Topology.Neighbors(Topo, Tile.nIndex).some((nOther) => Topo.rgTiles[nOther].szPanel === Seam.szPanelB));
      assert.ok(fLinked, `seam ${Seam.szEdge} links ${Seam.szPanelA} and ${Seam.szPanelB}`);
    }
  });
}

test('n=24 XL: about 10.33·n² tiles and an equatorial width of ≈4489 mi', () => {
  const Topo = Topology.Build(24, 'XL');
  assert.ok(Math.abs(g_Built.dEquatorialWidth * Topo.dMilesPerEdge - 4489.48) < 0.01);
  assert.ok(Math.abs(36.9096 / Topo.dHexArea - 10.33 * 24 * 24) < 10);
  for (const szPanel of g_Built.rgszEquatorialWestToEast) {
    const rgTiles = Topo.rgTiles.filter((Tile) => Tile.szPanel === szPanel);
    assert.ok(rgTiles.every((Tile) => Math.abs(Tile.rgdCenter[0]) > Topo.dW / 4), 'no equatorial hex at east = 0');
  }
});

test('equatorial seams bisect column gaps at every regional scale and panel size', () => {
  const dWidth = g_Built.dEquatorialWidth;
  for (const nPanelHexes of [2, 4, 8, 24]) {
    for (const szScale of ['XL', 'L', 'M', 'S']) {
      const nRatio = Lattice.ScaleRatio('regional', 'XL', szScale);
      for (const [nPanel, szPanel] of g_Built.rgszEquatorialWestToEast.entries()) {
        const Info = Topology.PanelLattice(szPanel, nPanelHexes, nRatio);
        const First = Topology.LatticeCenter(Info, Info.nColumnShift, 0);
        const Last = Topology.LatticeCenter(Info, Info.nColumnShift + Info.nColumns - 1, 0);
        const szCase = `${szPanel} n=${nPanelHexes} ${szScale}`;
        assert.ok(Math.abs(First[0] + dWidth / 2 - Info.dW / 2) < 1e-12, `${szCase}: west seam between columns`);
        assert.ok(Math.abs(dWidth / 2 - Last[0] - Info.dW / 2) < 1e-12, `${szCase}: east seam between columns`);
        assert.ok(Math.abs(First[0] + Last[0]) < 1e-12, `${szCase}: symmetric east/west columns`);
        const [nQ, nJ] = Topology.LatticeNearest(Info, 0, 0);
        const Middle = Topology.LatticeCenter(Info, nQ, nJ);
        assert.ok(Math.abs(Math.abs(Middle[0]) - Info.dW / 2) < 1e-12, `${szCase}: no centreline column`);
        const szNext = g_Built.rgszEquatorialWestToEast[(nPanel + 1) % 6];
        const Seam = Projection.FindSeam(szPanel, szNext);
        const Transform = Seam.szPanelA === szPanel ? Seam.rgdAToB : Seam.rgdBToA;
        const Beyond = Topology.LatticeCenter(Info, Info.nColumnShift + Info.nColumns, 0);
        const Next = Topology.PanelLattice(szNext, nPanelHexes, nRatio);
        AssertPointClose(Projection.ApplyTransform(Transform, Beyond), Topology.LatticeCenter(Next, Next.nColumnShift, 0),
          `${szCase}: continuous wrap into ${szNext}`, 1e-12);
      }
    }
  }
});

test('TilePolygons returns clipped pieces for partial tiles and a hex otherwise', () => {
  const Topo = Topology.Build(4, 'XL');
  const Partial = Topo.rgTiles.find((Tile) => Tile.fPartial);
  const Whole = Topo.rgTiles.find((Tile) => !Tile.fPartial);
  assert.equal(Topology.TilePolygons(Topo, Partial.nIndex).length, Partial.rgPieces.length);
  const [rgrgdHex] = Topology.TilePolygons(Topo, Whole.nIndex);
  assert.ok(Math.abs(Util.PolygonArea(rgrgdHex) - Topo.dHexArea) < 1e-12);
});

function AssertCenter(Topo, Tile) {
  const rgdExpected = Topology.LatticeCenter(Topo.Panels[Tile.szPanel].Lattice, Tile.nLatticeColumn, Tile.nLatticeRow);
  AssertPointClose(Tile.rgdCenter, rgdExpected, 'tile centre');
}

function AssertPointClose(rgdActual, rgdExpected, szMessage, dTolerance = 1e-9) {
  assert.ok(Util.Distance(rgdActual, rgdExpected) <= dTolerance, `${szMessage}: [${rgdActual}] != [${rgdExpected}]`);
}
