'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LoadModules } = require('./_load.cjs');

const { Topology, Coordinates, Terrain, Model, History } = LoadModules();

// The plan §5 table: char → terrain key, water flag.
const g_rgExpectedTerrains = [
  ['~', 'water', true], ['i', 'islands', true], ['o', 'lakes', true], ['v', 'firth', true],
  ['.', 'plain', false], ['h', 'hills', false], ['M', 'mountains', false], ['A', 'mountainPeak', false],
  ['d', 'desert', false], ['D', 'sandDunes', false], ['f', 'forest', false], ['m', 'marsh', false],
  ['g', 'mangrove', false], ['t', 'tundra', false], ['c', 'canyon', false], ['b', 'badlands', false],
  ['=', 'farmland', false],
];

function SmallGlobal() {
  return Model.CreateGlobalMap({ nPanelHexes: 4, szTileScale: 'XL', szName: 'Test' });
}

function Snapshot(Doc) {
  return {
    rgnTerrain: Array.from(Doc.rgnTerrain),
    rgLandmarks: [...Doc.Landmarks.entries()].sort((rgA, rgB) => rgA[0] - rgB[0]),
    rgOverlays: Doc.rgOverlays.map((Overlay) => ({ ...Overlay, rgnTiles: [...Overlay.rgnTiles] })),
    rgLabels: Doc.rgLabels.map((Label) => ({ ...Label })),
  };
}

// A non-adjacent tile and a three-tile path of adjacent tiles starting at nStart.
function Path(Doc, nStart, nLength) {
  const rgnPath = [nStart];
  while (rgnPath.length < nLength) {
    const nNext = Model.Neighbors(Doc, rgnPath.at(-1)).find((nTile) => !rgnPath.includes(nTile));
    rgnPath.push(nNext);
  }
  return rgnPath;
}

function FarTile(Doc, nTile) {
  const Near = new Set([nTile, ...Model.Neighbors(Doc, nTile)]);
  for (let nOther = 0; nOther < Doc.nTiles; nOther++) {
    if (!Near.has(nOther)) {
      return nOther;
    }
  }
  throw new Error('no far tile');
}

test('terrain table matches plan §5 with unique chars and IDs', () => {
  assert.equal(Terrain.g_rgTerrains.length, 17);
  assert.deepEqual(Terrain.g_rgTerrains.map((Item) => [Item.szChar, Item.szKey, Item.fWater]), g_rgExpectedTerrains);
  const rgszChars = Terrain.g_rgTerrains.map((Item) => Item.szChar);
  assert.equal(new Set(rgszChars).size, 17);
  assert.equal(new Set(Terrain.g_rgTerrains.map((Item) => Item.szName)).size, 17);
  Terrain.g_rgTerrains.forEach((Item, nIndex) => {
    assert.equal(Item.nId, nIndex);
    assert.match(Item.szChar, /^[!-~]$/, 'printable ASCII');
    assert.match(Item.szColor, /^#[0-9a-f]{6}$/);
    assert.equal(Terrain.ById(nIndex), Item);
    assert.equal(Terrain.ByChar(Item.szChar), Item);
    assert.equal(Terrain.ByKey(Item.szKey), Item);
    assert.ok('Embellish' in Item);
    assert.ok(Object.isFrozen(Item));
  });
  assert.ok(!rgszChars.includes(Terrain.g_szReservedChar));
  assert.equal(Terrain.g_szReservedChar, '_');
  assert.equal(Terrain.ByChar('_'), null);
  assert.equal(Terrain.ById(17), null);
  assert.equal(Terrain.ById(1.5), null);
  assert.equal(Terrain.ById(Terrain.g_nWaterId).szKey, 'water');
  assert.ok(Terrain.IsWater(Terrain.ByChar('i').nId));
  assert.ok(!Terrain.IsWater(Terrain.ByChar('.').nId));
});

test('landmark types follow prompt.md', () => {
  assert.deepEqual(Terrain.g_rgLandmarkTypes.map((Item) => Item.szKey),
    ['village', 'town', 'city', 'castle', 'fortress', 'tower', 'ruins', 'mine', 'temple', 'cave', 'dungeon']);
  assert.ok(Terrain.IsLandmarkType('castle'));
  assert.ok(!Terrain.IsLandmarkType('volcano'));
  assert.equal(Terrain.LandmarkType('city').szName, 'City');
});

test('CreateGlobalMap sizes the terrain to the topology and defaults to water', () => {
  const Doc = SmallGlobal();
  const Topo = Topology.Build(4, 'XL');
  assert.equal(Doc.szKind, 'global');
  assert.equal(Doc.szName, 'Test');
  assert.deepEqual({ ...Doc.Global }, { nPanelHexes: 4, szTileScale: 'XL' });
  assert.equal(Doc.Topo, Topo);
  assert.equal(Doc.nTiles, Topo.nTiles);
  assert.ok(Doc.rgnTerrain instanceof Uint8Array);
  assert.equal(Doc.rgnTerrain.length, Topo.nTiles);
  assert.ok(Doc.rgnTerrain.every((nId) => nId === Terrain.g_nWaterId));
  assert.equal(Doc.Landmarks.size, 0);
  assert.deepEqual(Doc.rgOverlays, []);
  assert.deepEqual(Doc.rgLabels, []);
  assert.equal(Model.CreateGlobalMap().Global.nPanelHexes, 24);
  assert.throws(() => Model.CreateGlobalMap({ szTileScale: 'M' }), /tile scale/);
  assert.throws(() => Model.CreateGlobalMap({ nPanelHexes: 5 }), /even/);
});

test('CreateLocalMap uses the local rectangle and local adjacency', () => {
  const Anchor = Coordinates.ParseUniversal('Eta 187.1W 324.0N');
  const Doc = Model.CreateLocalMap({ nWidth: 5, nHeight: 4, szSystem: 'regional', szScale: 'M', Anchor, szName: 'Vale' });
  assert.equal(Doc.szKind, 'local');
  assert.equal(Doc.nTiles, 20);
  assert.equal(Doc.Topo, null);
  assert.equal(Doc.Local.nWidth, 5);
  assert.equal(Model.LocalTileIndex(Doc, 2, 3), 17);
  assert.deepEqual(Model.LocalTileXY(Doc, 17), [2, 3]);
  assert.equal(Model.LocalTileIndex(Doc, 5, 0), -1);
  // Adjacent tiles are exactly one hex spacing apart in universal coordinates.
  for (let nTile = 0; nTile < Doc.nTiles; nTile++) {
    const Center = Coordinates.LocalTileToUniversal(Doc.Local, ...Model.LocalTileXY(Doc, nTile));
    for (let nOther = 0; nOther < Doc.nTiles; nOther++) {
      const Other = Coordinates.LocalTileToUniversal(Doc.Local, ...Model.LocalTileXY(Doc, nOther));
      const dDistance = Math.hypot(Center.dEast - Other.dEast, Center.dNorth - Other.dNorth);
      const fExpected = nOther !== nTile && Math.abs(dDistance - Doc.Local.dHexMiles) < 1e-6;
      assert.equal(Model.AreAdjacent(Doc, nTile, nOther), fExpected, `${nTile}–${nOther}`);
    }
  }
  const nInterior = Model.LocalTileIndex(Doc, 2, 1);
  assert.equal(Model.Neighbors(Doc, nInterior).length, 6);
});

test('set terrain, undo and redo round trip', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc);
  const nForest = Terrain.ByChar('f').nId;
  assert.equal(History.CanUndo(Hist), false);
  const Command = History.Perform(Hist, 'Paint', (_Doc, Record) => Record(Model.SetTerrain(Doc, 7, nForest)));
  assert.deepEqual(Command.rgChanges.map((Change) => [Change.szLayer, Change.Key, Change.Before, Change.After]),
    [['terrain', 7, Terrain.g_nWaterId, nForest]]);
  assert.equal(Model.GetTerrain(Doc, 7), nForest);
  assert.ok(History.CanUndo(Hist));
  assert.equal(History.Undo(Hist), Command);
  assert.equal(Model.GetTerrain(Doc, 7), Terrain.g_nWaterId);
  assert.ok(History.CanRedo(Hist));
  History.Redo(Hist);
  assert.equal(Model.GetTerrain(Doc, 7), nForest);
  assert.equal(History.Redo(Hist), null);
  // A no-op does not create a command or clear redo.
  History.Undo(Hist);
  assert.equal(History.Perform(Hist, 'Noop', (_Doc, Record) => Record(Model.SetTerrain(Doc, 7, Terrain.g_nWaterId))), null);
  assert.ok(History.CanRedo(Hist));
  // A new command clears redo.
  History.Perform(Hist, 'Paint', (_Doc, Record) => Record(Model.SetTerrain(Doc, 8, nForest)));
  assert.equal(History.CanRedo(Hist), false);
  assert.throws(() => Model.SetTerrain(Doc, Doc.nTiles, nForest), /Unknown tile/);
  assert.throws(() => Model.SetTerrain(Doc, 0, 99), /Unknown terrain/);
});

test('a grouped brush stroke undoes as one command', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc);
  const Before = Snapshot(Doc);
  const nHills = Terrain.ByChar('h').nId;
  const nMountains = Terrain.ByChar('M').nId;
  History.Begin(Hist, 'Brush');
  assert.equal(History.CanUndo(Hist), false, 'no undo while a stroke is open');
  for (const nTile of [1, 2, 3, 2, 1]) {
    History.Record(Hist, Model.SetTerrain(Doc, nTile, nTile === 2 ? nMountains : nHills));
  }
  History.Record(Hist, [Model.SetTerrain(Doc, 4, nHills), Model.SetTerrain(Doc, 4, Terrain.g_nWaterId)]);
  const Command = History.Commit(Hist);
  // Repeats coalesce; tile 4 ends where it started and is dropped.
  assert.deepEqual(Command.rgChanges.map((Change) => [Change.Key, Change.Before, Change.After]),
    [[1, 0, nHills], [2, 0, nMountains], [3, 0, nHills]]);
  assert.equal(Hist.rgUndo.length, 1);
  const After = Snapshot(Doc);
  History.Undo(Hist);
  assert.deepEqual(Snapshot(Doc), Before);
  History.Redo(Hist);
  assert.deepEqual(Snapshot(Doc), After);
  assert.throws(() => History.Record(Hist, null), /Begin/);
  History.Begin(Hist, 'x');
  assert.throws(() => History.Begin(Hist, 'y'), /already open/);
  History.Record(Hist, Model.SetTerrain(Doc, 9, nHills));
  History.Cancel(Hist);
  assert.deepEqual(Snapshot(Doc), After, 'Cancel reverts the open group');
});

test('Perform reverts partial changes when the mutation throws', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc);
  const Before = Snapshot(Doc);
  assert.throws(() => History.Perform(Hist, 'Bad', (_Doc, Record) => {
    Record(Model.SetTerrain(Doc, 3, Terrain.ByChar('d').nId));
    Record(Model.SetLandmark(Doc, 3, { szType: 'town' }));
    Model.SetTerrain(Doc, 4, 200);
  }), /Unknown terrain/);
  assert.deepEqual(Snapshot(Doc), Before);
  assert.equal(History.CanUndo(Hist), false);
  assert.equal(Hist.Pending, null);
});

test('at most one landmark per tile; place, replace, edit and remove undo exactly', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc);
  History.Perform(Hist, 'Place', (_Doc, Record) => Record(Model.SetLandmark(Doc, 5, { szType: 'village', szName: 'Ash' })));
  History.Perform(Hist, 'Replace', (_Doc, Record) => Record(Model.SetLandmark(Doc, 5, { szType: 'city', szName: 'Karador', szNotes: 'Capital' })));
  assert.equal(Doc.Landmarks.size, 1);
  assert.deepEqual({ ...Model.GetLandmark(Doc, 5) }, { szType: 'city', szName: 'Karador', szNotes: 'Capital' });
  History.Perform(Hist, 'Other', (_Doc, Record) => Record(Model.SetLandmark(Doc, 6, { szType: 'cave' })));
  assert.equal(Doc.Landmarks.size, 2);
  History.Perform(Hist, 'Remove', (_Doc, Record) => Record(Model.RemoveLandmark(Doc, 5)));
  assert.equal(Model.GetLandmark(Doc, 5), null);
  assert.equal(Model.RemoveLandmark(Doc, 5), null, 'removing nothing is a no-op');
  History.Undo(Hist);
  assert.equal(Model.GetLandmark(Doc, 5).szName, 'Karador');
  History.Undo(Hist);
  History.Undo(Hist);
  assert.equal(Model.GetLandmark(Doc, 5).szName, 'Ash');
  History.Undo(Hist);
  assert.equal(Doc.Landmarks.size, 0);
  assert.throws(() => Model.SetLandmark(Doc, 5, { szType: 'volcano' }), /landmark type/);
  assert.throws(() => Model.SetLandmark(Doc, 5, { szType: 'town', szName: 'a\nb' }), /control/);
  assert.throws(() => Model.SetLandmark(Doc, -1, { szType: 'town' }), /Unknown tile/);
});

test('overlay validation rejects non-adjacent paths and accepts shared tiles', () => {
  const Doc = SmallGlobal();
  const rgnRoad = Path(Doc, 10, 4);
  const Road = Model.AddOverlay(Doc, { szType: 'road', szName: "King's Road", szStyle: 'highway', rgnTiles: rgnRoad }).After;
  assert.equal(Road.szId, 'road1');
  assert.deepEqual([...Road.rgnTiles], rgnRoad);
  const rgnRiver = [rgnRoad[1], ...Model.Neighbors(Doc, rgnRoad[1]).filter((nTile) => !rgnRoad.includes(nTile)).slice(0, 1)];
  const River = Model.AddOverlay(Doc, { szType: 'river', rgnTiles: rgnRiver }).After;
  assert.equal(River.szId, 'river1');
  assert.deepEqual(Model.OverlaysAt(Doc, rgnRoad[1]).map((Overlay) => Overlay.szId), ['road1', 'river1']);
  const nFar = FarTile(Doc, 10);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [10, nFar] }), /not adjacent/);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [10, 10] }), /not adjacent/);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [] }), /at least one/);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'canal', rgnTiles: [10] }), /overlay type/);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'road', szId: 'road1', rgnTiles: [10] }), /Duplicate/);
  assert.throws(() => Model.AddOverlay(Doc, { szType: 'road', szStyle: 'two words', rgnTiles: [10] }), /style/);
  assert.throws(() => Model.UpdateOverlay(Doc, 'road1', { rgnTiles: [10, nFar] }), /not adjacent/);
  assert.equal(Doc.rgOverlays.length, 2, 'failed mutations change nothing');
  // Seam-crossing paths are accepted when the topology says the tiles are adjacent.
  const Topo = Doc.Topo;
  const nCross = Topo.rgTiles.findIndex((Tile) => Array.from(Topology.Neighbors(Topo, Tile.nIndex))
    .some((nOther) => Topo.rgTiles[nOther].szPanel !== Tile.szPanel));
  const nAcross = Array.from(Topology.Neighbors(Topo, nCross)).find((nOther) => Topo.rgTiles[nOther].szPanel !== Topo.rgTiles[nCross].szPanel);
  assert.ok(Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [nCross, nAcross] }));
});

test('overlays and labels round-trip through undo and redo', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc);
  const rgSnapshots = [Snapshot(Doc)];
  const Step = (szLabel, fnMutate) => {
    History.Perform(Hist, szLabel, fnMutate);
    rgSnapshots.push(Snapshot(Doc));
  };
  Step('Road', (_Doc, Record) => Record(Model.AddOverlay(Doc, { szType: 'road', rgnTiles: Path(Doc, 20, 3) })));
  Step('Trail', (_Doc, Record) => Record(Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: Path(Doc, 40, 2) })));
  Step('River', (_Doc, Record) => Record(Model.AddOverlay(Doc, { szType: 'river', szName: 'Silverrun', rgnTiles: Path(Doc, 60, 5) })));
  Step('Extend', (_Doc, Record) => Record(Model.UpdateOverlay(Doc, 'road1', { rgnTiles: Path(Doc, 20, 4), szName: 'Old Road' })));
  Step('Remove middle', (_Doc, Record) => Record(Model.RemoveOverlay(Doc, 'trail1')));
  Step('Labels', (_Doc, Record) => {
    Record(Model.AddLabel(Doc, { nTile: 3, szText: 'The Northern Wastes', szCategory: 'region', dRotation: -15 }));
    Record(Model.AddLabel(Doc, { nTile: 3, szText: 'Karador', szCategory: 'city', dDx: 2, dDy: -1 }));
  });
  Step('Edit label', (_Doc, Record) => Record(Model.UpdateLabel(Doc, 'label1', { dSize: 32, szText: 'Wastes' })));
  Step('Remove label', (_Doc, Record) => Record(Model.RemoveLabel(Doc, 'label1')));
  assert.deepEqual(Doc.rgOverlays.map((Overlay) => Overlay.szId), ['road1', 'river1']);
  assert.deepEqual(Doc.rgLabels.map((Label) => Label.szId), ['label2']);
  assert.equal(Model.GetLabel(Doc, 'label2').dSize, Model.g_LabelDefaultSizes.city);
  assert.equal(Model.LabelsAt(Doc, 3).length, 1);
  for (let nIndex = rgSnapshots.length - 2; nIndex >= 0; nIndex--) {
    History.Undo(Hist);
    assert.deepEqual(Snapshot(Doc), rgSnapshots[nIndex], `after undo to step ${nIndex}`);
  }
  assert.equal(History.Undo(Hist), null);
  for (let nIndex = 1; nIndex < rgSnapshots.length; nIndex++) {
    History.Redo(Hist);
    assert.deepEqual(Snapshot(Doc), rgSnapshots[nIndex], `after redo to step ${nIndex}`);
  }
  // Ids come from the current contents, so a freed id is reused.
  assert.equal(Model.AddOverlay(Doc, { szType: 'trail', rgnTiles: [0] }).After.szId, 'trail1');
});

test('label validation', () => {
  const Doc = SmallGlobal();
  assert.throws(() => Model.AddLabel(Doc, { nTile: 0, szText: 'x', szCategory: 'continent' }), /category/);
  assert.throws(() => Model.AddLabel(Doc, { nTile: 0, szText: '  ', szCategory: 'region' }), /empty/);
  assert.throws(() => Model.AddLabel(Doc, { nTile: 0, szText: 'x', szCategory: 'region', dSize: 0 }), /positive/);
  assert.throws(() => Model.AddLabel(Doc, { nTile: 0, szText: 'x', szCategory: 'region', dRotation: NaN }), /finite/);
  assert.throws(() => Model.AddLabel(Doc, { nTile: Doc.nTiles, szText: 'x', szCategory: 'region' }), /Unknown tile/);
  assert.throws(() => Model.AddLabel(Doc, { nTile: 0, szText: 'x', szCategory: 'region', szId: '1abc' }), /label id/);
  assert.throws(() => Model.UpdateLabel(Doc, 'missing', { szText: 'y' }), /Unknown label/);
  assert.equal(Doc.rgLabels.length, 0);
});

test('history limit drops the oldest commands and Clear empties both stacks', () => {
  const Doc = SmallGlobal();
  const Hist = History.Create(Doc, { nLimit: 3 });
  for (let nTile = 0; nTile < 5; nTile++) {
    History.Perform(Hist, 'Paint', (_Doc, Record) => Record(Model.SetTerrain(Doc, nTile, Terrain.ByChar('.').nId)));
  }
  assert.equal(Hist.rgUndo.length, 3);
  while (History.Undo(Hist)) { /* undo all that remain */ }
  assert.deepEqual(Array.from(Doc.rgnTerrain.subarray(0, 5)), [4, 4, 0, 0, 0]);
  assert.ok(History.CanRedo(Hist));
  History.Clear(Hist);
  assert.equal(History.CanUndo(Hist) || History.CanRedo(Hist), false);
  assert.throws(() => History.Create(Doc, { nLimit: 0 }), /limit/);
});
