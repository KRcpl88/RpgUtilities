'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Util, Projection, Lattice, Terrain, Model, View } = LoadModules();

const g_dEpsilon = 1e-9;
const g_Doc = Model.CreateGlobalMap({ nPanelHexes: 4, szTileScale: 'XL', szName: 'Test' });
const g_Topo = g_Doc.Topo;

function AssertClose(dActual, dExpected, szMessage, dTolerance = g_dEpsilon) {
  assert.ok(Math.abs(dActual - dExpected) <= dTolerance, `${szMessage}: ${dActual} vs ${dExpected}`);
}

function Centroid(rgrgdPolygon) {
  let dArea = 0;
  let dX = 0;
  let dY = 0;
  for (let nIndex = 0; nIndex < rgrgdPolygon.length; nIndex++) {
    const [dX0, dY0] = rgrgdPolygon[nIndex];
    const [dX1, dY1] = rgrgdPolygon[(nIndex + 1) % rgrgdPolygon.length];
    const dCross = dX0 * dY1 - dX1 * dY0;
    dArea += dCross;
    dX += (dX0 + dX1) * dCross;
    dY += (dY0 + dY1) * dCross;
  }
  return [dX / (3 * dArea), dY / (3 * dArea)];
}

function HexVertices(rgdCenter) {
  const dRadius = Lattice.HexRadius(g_Topo.dD);
  return [0, 1, 2, 3, 4, 5].map((nIndex) => [
    rgdCenter[0] + dRadius * Math.cos(nIndex * Math.PI / 3),
    rgdCenter[1] + dRadius * Math.sin(nIndex * Math.PI / 3),
  ]);
}

// Points (in the tile's own panel frame) that must hit the tile: the centre of a whole
// hex, or the centroid of each piece lying in the owning panel.
function ProbePoints(Tile) {
  if (!Tile.rgPieces) {
    return [Tile.rgdCenter];
  }
  return Tile.rgPieces.filter((Piece) => Piece.szPanel === Tile.szPanel).map((Piece) => Centroid(Piece.rgrgdPolygon));
}

test('camera world ↔ screen round trips and matches its transform', () => {
  const Camera = View.CreateCamera(640, 480);
  View.CenterOn(Camera, [1.25, -0.75]);
  Camera.dScale = 137;
  const rgdT = View.WorldToScreenTransform(Camera);
  for (const rgdWorld of [[0, 0], [1.25, -0.75], [3, 2], [-4.5, 0.1]]) {
    const rgdScreen = View.WorldToScreen(Camera, rgdWorld);
    const rgdBack = View.ScreenToWorld(Camera, rgdScreen);
    AssertClose(rgdBack[0], rgdWorld[0], 'x');
    AssertClose(rgdBack[1], rgdWorld[1], 'y');
    const rgdViaT = Projection.ApplyTransform(rgdT, rgdWorld);
    AssertClose(rgdViaT[0], rgdScreen[0], 'tx');
    AssertClose(rgdViaT[1], rgdScreen[1], 'ty');
  }
  assert.deepEqual(View.WorldToScreen(Camera, [1.25, -0.75]), [320, 240]);
  // y is up in world, down on screen.
  assert.ok(View.WorldToScreen(Camera, [1.25, 0])[1] < 240);
});

test('ZoomAt keeps the cursor point fixed and clamps the scale', () => {
  const Camera = View.CreateCamera(800, 600);
  const rgdCursor = [123, 456];
  const rgdBefore = View.ScreenToWorld(Camera, rgdCursor);
  View.ZoomAt(Camera, rgdCursor, 3.5);
  AssertClose(Camera.dScale, 350, 'scale');
  const rgdAfter = View.ScreenToWorld(Camera, rgdCursor);
  AssertClose(rgdAfter[0], rgdBefore[0], 'x');
  AssertClose(rgdAfter[1], rgdBefore[1], 'y');
  View.ZoomAt(Camera, rgdCursor, 1e12);
  assert.equal(Camera.dScale, View.g_dMaxScale);
  View.ZoomAt(Camera, rgdCursor, 1e-12);
  assert.equal(Camera.dScale, View.g_dMinScale);
  assert.equal(View.ClampScale(50), 50);
});

test('Pan moves content by screen pixels; FitBounds shows the whole box', () => {
  const Camera = View.CreateCamera(800, 600);
  const rgdWorld = [0.3, 0.4];
  const rgdBefore = View.WorldToScreen(Camera, rgdWorld);
  View.Pan(Camera, 15, -20);
  const rgdAfter = View.WorldToScreen(Camera, rgdWorld);
  AssertClose(rgdAfter[0] - rgdBefore[0], 15, 'dx');
  AssertClose(rgdAfter[1] - rgdBefore[1], -20, 'dy');

  const rgdBounds = View.BuildNetLayout().rgdBounds;
  View.FitBounds(Camera, rgdBounds, 24);
  const rgdVisible = View.VisibleBounds(Camera);
  assert.ok(rgdVisible[0] <= rgdBounds[0] && rgdVisible[1] <= rgdBounds[1]);
  assert.ok(rgdVisible[2] >= rgdBounds[2] && rgdVisible[3] >= rgdBounds[3]);
  const [dLeft, dTop] = View.WorldToScreen(Camera, [rgdBounds[0], rgdBounds[3]]);
  const [dRight, dBottom] = View.WorldToScreen(Camera, [rgdBounds[2], rgdBounds[1]]);
  // One axis touches the margin exactly.
  assert.ok(Math.abs(dLeft - 24) < 1e-6 || Math.abs(dTop - 24) < 1e-6);
  assert.ok(dRight <= 776 + 1e-6 && dBottom <= 576 + 1e-6);
});

test('bounds helpers', () => {
  assert.deepEqual(View.BoundsOf([[1, 2], [-1, 5], [0, 0]]), [-1, 0, 1, 5]);
  assert.ok(View.BoundsIntersect([0, 0, 1, 1], [1, 1, 2, 2]));
  assert.ok(!View.BoundsIntersect([0, 0, 1, 1], [1.01, 0, 2, 1]));
  assert.deepEqual(View.UnionBounds([[0, 0, 1, 1], [2, -1, 3, 0.5]]), [0, -1, 3, 1]);
  const rgdRotated = View.TransformBounds([0, 1, -1, 0, 10, 0], [0, 0, 2, 1]);
  [9, 0, 10, 2].forEach((dValue, nIndex) => AssertClose(rgdRotated[nIndex], dValue, `rotated ${nIndex}`));
});

test('net layout places every panel at its net frame', () => {
  const Built = Projection.Build();
  const Layout = View.BuildNetLayout();
  assert.equal(Layout, View.BuildNetLayout(), 'cached');
  assert.equal(Layout.szMode, 'net');
  assert.equal(Layout.rgPlacements.length, Object.keys(Built.Panels).length);
  assert.equal(Layout.rgPlacements.length, 18);
  for (const Placement of Layout.rgPlacements) {
    assert.deepEqual([...Placement.rgdFrameToWorld], [...Built.Frames[Placement.szPanel].rgdFrameToNet]);
    assert.equal(View.FindPlacement(Layout, Placement.szPanel), Placement);
    const Hit = View.PlacementAt(Layout, Placement.rgdCenter);
    assert.equal(Hit.Placement, Placement);
    AssertClose(Hit.rgdFrame[0], 0, 'frame x');
    AssertClose(Hit.rgdFrame[1], 0, 'frame y');
  }
  assert.equal(View.PlacementAt(Layout, [Layout.rgdBounds[2] + 1, 0]), null);
});

test('focus layouts unfold every neighbour across its shared seam', () => {
  const Built = Projection.Build();
  for (const szFocus of Object.keys(Built.Panels)) {
    const Layout = View.BuildFocusLayout(szFocus);
    assert.equal(Layout, View.BuildFocusLayout(szFocus), 'cached');
    assert.equal(Layout.szMode, 'focus');
    assert.equal(Layout.szFocus, szFocus);
    const Focus = Layout.rgPlacements[Layout.rgPlacements.length - 1];
    assert.equal(Focus.szPanel, szFocus, 'focus drawn last');
    assert.deepEqual([...Focus.rgdFrameToWorld], [...View.g_rgdIdentity]);
    const nSeams = Built.Seams.filter((Seam) => Seam.szPanelA === szFocus || Seam.szPanelB === szFocus).length;
    assert.equal(Layout.rgPlacements.length, nSeams + 1);
    assert.equal(nSeams, Built.Frames[szFocus].rgrgdPolygon.length, `${szFocus}: one neighbour per edge`);
    for (const Placement of Layout.rgPlacements.slice(0, -1)) {
      const nShared = Placement.rgrgdOutline.filter((rgdPoint) => Focus.rgrgdOutline.some(
        (rgdOther) => Math.hypot(rgdPoint[0] - rgdOther[0], rgdPoint[1] - rgdOther[1]) < 1e-9)).length;
      assert.equal(nShared, 2, `${szFocus}/${Placement.szPanel} shares one edge`);
      // Neighbours sit outside the focus panel.
      const rgdFrame = Projection.ApplyTransform(Focus.rgdWorldToFrame, Placement.rgdCenter);
      assert.ok(!Util.PointInConvex(rgdFrame, Built.Frames[szFocus].rgrgdPolygon));
    }
  }
  assert.throws(() => View.BuildFocusLayout('nope'));
});

function CheckHits(Layout) {
  let nChecked = 0;
  for (const Tile of g_Topo.rgTiles) {
    const Placement = View.FindPlacement(Layout, Tile.szPanel);
    if (!Placement) {
      continue;
    }
    for (const rgdFrame of ProbePoints(Tile)) {
      const rgdWorld = Projection.ApplyTransform(Placement.rgdFrameToWorld, rgdFrame);
      const Hit = View.HitTest(g_Topo, Layout, rgdWorld);
      assert.ok(Hit, `tile ${Tile.nIndex} missed`);
      assert.equal(Hit.nTile, Tile.nIndex, `tile ${Tile.nIndex} hit ${Hit.nTile}`);
      assert.equal(Hit.szPanel, Tile.szPanel);
      nChecked++;
    }
  }
  return nChecked;
}

test('HitTest finds every tile in the net layout', () => {
  const nChecked = CheckHits(View.BuildNetLayout());
  assert.ok(nChecked >= g_Topo.nTiles);
  const rgdOutside = View.BuildNetLayout().rgdBounds;
  assert.equal(View.HitTest(g_Topo, View.BuildNetLayout(), [rgdOutside[2] + 5, rgdOutside[3] + 5]), null);
});

test('HitTest finds every tile in focus layouts', () => {
  for (const szFocus of Object.keys(Projection.Build().Panels)) {
    assert.ok(CheckHits(View.BuildFocusLayout(szFocus)) > 0);
  }
});

test('HitTest of random points lands in a tile containing the point', () => {
  const Layout = View.BuildNetLayout();
  const Random = Util.CreateRng(7);
  const [dMinX, dMinY, dMaxX, dMaxY] = Layout.rgdBounds;
  let nHits = 0;
  for (let nIndex = 0; nIndex < 2000; nIndex++) {
    const rgdWorld = [dMinX + (dMaxX - dMinX) * Random(), dMinY + (dMaxY - dMinY) * Random()];
    const Hit = View.HitTest(g_Topo, Layout, rgdWorld);
    if (!Hit || Hit.nTile < 0) {
      continue;
    }
    const Tile = g_Topo.rgTiles[Hit.nTile];
    assert.equal(Hit.szPanel, Tile.szPanel, 'hit is reported in the owning panel');
    const rgdTileFrame = Hit.rgdFrame;
    const fInside = Tile.rgPieces
      ? Tile.rgPieces.some((Piece) => Util.PointInConvex(rgdTileFrame, Piece.rgrgdPolygon))
      : Math.hypot(rgdTileFrame[0] - Tile.rgdCenter[0], rgdTileFrame[1] - Tile.rgdCenter[1]) <= Lattice.HexRadius(g_Topo.dD) + 1e-9;
    assert.ok(fInside, `point ${rgdWorld} outside hit tile ${Hit.nTile}`);
    nHits++;
  }
  assert.ok(nHits > 500, `${nHits} hits`);
});

// prompt.md "Map projection": on the east/west seams of the equatorial panels, edge hexes
// belong wholly to their own panel, so the tip that pokes into the neighbouring panel
// belongs to that hex. Elsewhere, partial tiles are clipped to their panel, so the panel
// containing the point owns it.
test('points across an equatorial seam belong to the neighbouring panel\'s edge hex', () => {
  const Built = Projection.Build();
  const Layout = View.BuildNetLayout();
  const dHalfWidth = Built.dEquatorialWidth / 2;
  const dRadius = Lattice.HexRadius(g_Topo.dD);
  let nAcross = 0;
  let nOwn = 0;
  for (const [szPanel, Info] of Object.entries(g_Topo.Panels)) {
    if (!Info.Lattice.fEquatorial) {
      continue;
    }
    const Placement = View.FindPlacement(Layout, szPanel);
    for (const [szOther, dSide] of [[Info.szWest, -1], [Info.szEast, 1]]) {
      // Probe a vertical line just inside this panel's west/east edge.
      for (let dNorth = -0.4; dNorth <= 0.4; dNorth += 0.003) {
        const rgdFrame = [dSide * (dHalfWidth - 0.02 * g_Topo.dW), dNorth];
        if (!Util.PointInConvex(rgdFrame, Built.Frames[szPanel].rgrgdPolygon)) {
          continue;
        }
        const Hit = View.HitTest(g_Topo, Layout, Projection.ApplyTransform(Placement.rgdFrameToWorld, rgdFrame));
        assert.ok(Hit, `${szPanel} ${rgdFrame} missed`);
        assert.equal(Hit.szDrawPanel, szPanel);
        const Tile = g_Topo.rgTiles[Hit.nTile];
        assert.equal(Hit.szPanel, Tile.szPanel);
        assert.ok(Hit.szPanel === szPanel || Hit.szPanel === szOther, `${szPanel}: owner ${Hit.szPanel}`);
        // The owner is the hex of the continuous strip lattice containing the point,
        // and the point is reported in the owner's frame.
        if (!Tile.rgPieces) {
          assert.ok(Math.hypot(Hit.rgdFrame[0] - Tile.rgdCenter[0], Hit.rgdFrame[1] - Tile.rgdCenter[1]) <= dRadius + 1e-9);
        }
        if (Hit.szPanel === szOther) {
          nAcross++;
          assert.ok(Math.abs(Hit.rgdFrame[0]) > dHalfWidth - 1e-9, `${Hit.rgdFrame}`);
        } else {
          nOwn++;
        }
      }
    }
  }
  assert.ok(nAcross > 0 && nOwn > 0, `${nAcross} across, ${nOwn} own`);
});

test('points just inside any other panel edge belong to that panel', () => {
  const Built = Projection.Build();
  const Layout = View.BuildNetLayout();
  const dHalfWidth = Built.dEquatorialWidth / 2;
  let nChecked = 0;
  for (const [szPanel, Info] of Object.entries(g_Topo.Panels)) {
    const Placement = View.FindPlacement(Layout, szPanel);
    const rgrgdPolygon = Built.Frames[szPanel].rgrgdPolygon;
    rgrgdPolygon.forEach((rgdStart, nIndex) => {
      const rgdEnd = rgrgdPolygon[(nIndex + 1) % rgrgdPolygon.length];
      const fStripSeam = Info.Lattice.fEquatorial
        && Math.abs(Math.abs(rgdStart[0]) - dHalfWidth) < 1e-9 && Math.abs(Math.abs(rgdEnd[0]) - dHalfWidth) < 1e-9;
      if (fStripSeam) {
        return;
      }
      for (let dT = 0.03; dT < 1; dT += 0.02) {
        const rgdOnEdge = [rgdStart[0] + dT * (rgdEnd[0] - rgdStart[0]), rgdStart[1] + dT * (rgdEnd[1] - rgdStart[1])];
        const rgdFrame = [rgdOnEdge[0] * (1 - 1e-4), rgdOnEdge[1] * (1 - 1e-4)];
        // Equatorial corners: the strip neighbour's edge hex may reach this far.
        if (Info.Lattice.fEquatorial && Math.abs(rgdFrame[0]) > dHalfWidth - g_Topo.dW) {
          continue;
        }
        const Hit = View.HitTest(g_Topo, Layout, Projection.ApplyTransform(Placement.rgdFrameToWorld, rgdFrame));
        assert.ok(Hit, `${szPanel} edge ${nIndex} missed`);
        assert.equal(Hit.szPanel, szPanel, `${szPanel} edge ${nIndex} at ${dT}`);
        assert.equal(Hit.szDrawPanel, szPanel);
        nChecked++;
      }
    });
  }
  assert.ok(nChecked > 1000, `${nChecked}`);
});

test('PanelTileGroups adds strip-neighbour edge columns only for equatorial panels', () => {
  let nEquatorial = 0;
  for (const [szPanel, Info] of Object.entries(g_Topo.Panels)) {
    const rgGroups = View.PanelTileGroups(g_Topo, szPanel);
    assert.equal(rgGroups, View.PanelTileGroups(g_Topo, szPanel), 'cached');
    assert.equal(rgGroups[0].szOwner, szPanel);
    assert.equal(rgGroups[0].rgnTiles.length, Info.nTileCount);
    if (Info.Lattice.fEquatorial) {
      nEquatorial++;
      assert.equal(rgGroups.length, 3);
      assert.deepEqual(rgGroups.slice(1).map((Group) => Group.szOwner), [Info.szWest, Info.szEast]);
      for (const Group of rgGroups.slice(1)) {
        assert.ok(Group.rgnTiles.length > 0 && Group.rgnTiles.length < g_Topo.Panels[Group.szOwner].nTileCount);
        for (const nTile of Group.rgnTiles) {
          assert.equal(g_Topo.rgTiles[nTile].szPanel, Group.szOwner);
        }
      }
    } else {
      assert.equal(rgGroups.length, 1);
    }
  }
  assert.ok(nEquatorial > 0);
});

test('VisibleTiles keeps every tile with a vertex in view', () => {
  const Random = Util.CreateRng(11);
  for (const [szPanel] of Object.entries(g_Topo.Panels)) {
    for (const Group of View.PanelTileGroups(g_Topo, szPanel)) {
      for (let nTrial = 0; nTrial < 5; nTrial++) {
        const dX = 1.2 * (Random() - 0.5);
        const dY = 1.2 * (Random() - 0.5);
        const dSize = 0.05 + 0.3 * Random();
        const rgdBox = [dX, dY, dX + dSize, dY + dSize];
        const Visible = new Set(View.VisibleTiles(g_Topo, Group, rgdBox));
        for (const nTile of Group.rgnTiles) {
          const rgdCenter = Projection.ApplyTransform(Group.rgdToPanel, g_Topo.rgTiles[nTile].rgdCenter);
          const fTouches = HexVertices(rgdCenter).concat([rgdCenter]).some(([dPx, dPy]) =>
            dPx >= rgdBox[0] && dPx <= rgdBox[2] && dPy >= rgdBox[1] && dPy <= rgdBox[3]);
          if (fTouches) {
            assert.ok(Visible.has(nTile), `${szPanel}: tile ${nTile} culled`);
          }
        }
      }
    }
  }
});

test('DemoTerrain is deterministic and valid', () => {
  const rgnFirst = View.DemoTerrain(g_Topo, 1);
  const rgnSecond = View.DemoTerrain(g_Topo, 1);
  const rgnOther = View.DemoTerrain(g_Topo, 2);
  assert.ok(rgnFirst instanceof Uint8Array);
  assert.equal(rgnFirst.length, g_Topo.nTiles);
  assert.deepEqual(rgnFirst, rgnSecond);
  assert.notDeepEqual(rgnFirst, rgnOther);
  const rgnIds = new Set(Terrain.g_rgTerrains.map((Entry) => Entry.nId));
  for (const nId of rgnFirst) {
    assert.ok(rgnIds.has(nId), `bad id ${nId}`);
  }
  assert.ok(new Set(rgnFirst).size >= 6, 'a varied world');
});
