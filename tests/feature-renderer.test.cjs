'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ExtractModules, LoadModules } = require('./_load.cjs');

// Canvas contracts without browser dependencies; the browser smoke check verifies
// the actual pixels. These tests exercise Renderer, not a second implementation.
function Canvas() {
  const Context = { measureText: (szText) => ({ width: szText.length * 8 }) };
  for (const szMethod of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'save', 'restore',
    'transform', 'fill', 'stroke', 'rect', 'fillRect', 'clearRect', 'drawImage', 'strokeText', 'fillText',
    'translate', 'rotate', 'scale', 'setLineDash', 'arc', 'bezierCurveTo', 'strokeRect']) {
    Context[szMethod] = () => {};
  }
  return { width: 900, height: 600, getContext: () => Context, getBoundingClientRect: () => ({ width: 900, height: 600 }) };
}

function Setup(fLocal = false, szPanel = null) {
  const RpgMap = LoadModules();
  const Root = { RpgMap, document: { createElement: Canvas }, devicePixelRatio: 1, Path2D: class {} };
  vm.compileFunction(ExtractModules().find((Module) => Module.szName === 'Renderer').szSource, ['globalThis'])(Root);
  const { Model, View, Renderer } = RpgMap;
  const Doc = fLocal ? Model.CreateLocalMap({
    nWidth: 16, nHeight: 12, szSystem: 'local', szScale: 'S', Anchor: RpgMap.Coordinates.ParseUniversal('Eta 123.4E 56.7N'),
  }) : szPanel ? Model.CreatePanelMap({ szPanel: RpgMap.Coordinates.PanelIdByName(szPanel), nPanelHexes: 4 })
    : Model.CreateGlobalMap({ nPanelHexes: 4 });
  const nTile = fLocal ? 85 : Doc.Topo.rgTiles.find((Tile) => !Tile.fPartial).nIndex;
  for (const szType of ['road', 'trail', 'river']) {
    Model.AddOverlay(Doc, { szType, rgnTiles: [nTile, Model.Neighbors(Doc, nTile)[0]] });
  }
  Model.SetLandmark(Doc, nTile, { szType: 'castle' });
  Model.AddLabel(Doc, { nTile, szCategory: 'city', szText: 'Keep', dRotation: -25, dDx: 3, dDy: -12 });
  const State = {
    Doc, Layout: fLocal || szPanel ? View.MapLayout(Doc) : View.BuildFocusLayout(Doc.Topo.rgTiles[nTile].szPanel), Camera: View.CreateCamera(),
    Layers: { fTerrain: false, fGrid: false, fOutlines: false, fNames: false, road: true, trail: true, river: true, landmark: true, label: true },
    nHoverTile: -1, Selection: null, LabelPreview: null,
  };
  View.ResizeCamera(State.Camera, 900, 600);
  View.FitBounds(State.Camera, State.Layout.rgdBounds);
  const R = Renderer.Create(Canvas());
  return { ...RpgMap, State, R, nTile };
}

for (const fLocal of [false, true]) {
  const szKind = fLocal ? 'local' : 'global';
  test(`${szKind}: renderer draws all feature layers and excludes hidden layers from drawing and picking`, () => {
    const { Renderer, State, R } = Setup(fLocal);
    Renderer.Draw(R, State);
    const Keys = new Set(R.rgFeatureHits.map((Hit) => Hit.Key));
    for (const Key of ['road1', 'trail1', 'river1', 'label1']) {
      assert.ok(Keys.has(Key));
    }
    assert.ok(R.rgFeatureHits.some((Hit) => Hit.szLayer === 'landmark'));
    for (const szLayer of ['road', 'trail', 'river', 'landmark', 'label']) {
      State.Layers[szLayer] = false;
      Renderer.Draw(R, State);
      assert.ok(!R.rgFeatureHits.some((Hit) => Hit.Key === szLayer + '1' || Hit.szLayer === szLayer));
      State.Layers[szLayer] = true;
    }
  });

  test(`${szKind}: rotated label hit areas and handles agree with the drawn label transform`, () => {
    const { Renderer, Model, View, Projection, State, R, nTile } = Setup(fLocal);
    State.Selection = { szLayer: 'label', Key: 'label1' };
    Renderer.Draw(R, State);
    const szPanel = View.MapGeometry(State.Doc).rgTiles[nTile].szPanel;
    const Hits = R.rgFeatureHits.filter((Hit) => Hit.Key === 'label1' && Hit.szDrawPanel === szPanel);
    const LabelHit = Hits.find((Hit) => Hit.rgdScreenToText);
    assert.ok(LabelHit);
    const Transform = Projection.InvertTransform(LabelHit.rgdScreenToText);
    const rgdScreen = Projection.ApplyTransform(Transform, [10, 0]);
    assert.equal(Renderer.HitFeature(R, State, rgdScreen, 'label').Key, 'label1');
    for (const szHandle of ['move', 'rotate']) {
      const Handle = Hits.find((Hit) => Hit.szHandle === szHandle);
      assert.ok(Handle);
      assert.equal(Renderer.HitFeature(R, State, Handle.rgdScreen, 'label').szHandle, szHandle);
    }
    const Original = Model.GetLabel(State.Doc, 'label1');
    State.LabelPreview = { ...Original, dDx: Original.dDx + 4 };
    Renderer.Draw(R, State);
    const PreviewHit = R.rgFeatureHits.find((Hit) => Hit.Key === 'label1' && Hit.rgdScreenToText && Hit.szDrawPanel === szPanel);
    assert.notDeepEqual(PreviewHit.rgdScreenToText, LabelHit.rgdScreenToText);
    assert.equal(Model.GetLabel(State.Doc, 'label1'), Original, 'preview does not mutate document');
    assert.equal(Renderer.HitFeature(R, State, [-100, -100]), null);
    assert.ok(View.g_dLabelUnitsPerHex > 0);
  });

  test(`${szKind}: feature edits and their undo keep cached terrain rasters, while terrain edits mark dirty tiles`, () => {
    const { Renderer, Model, Edit, History, State, R, nTile } = Setup(fLocal);
    const Mini = Canvas();
    Renderer.DrawMinimap(R, Mini, State);
    const Raster = R.Rasters.get('mini');
    const Hist = History.Create(State.Doc);
    Edit.SetFeature(Hist, 'landmark', nTile, { szName: 'Renamed' });
    Renderer.MarkTilesChanged(R, State.Doc, []);
    Renderer.DrawMinimap(R, Mini, State);
    assert.equal(R.Rasters.get('mini'), Raster);
    assert.equal(Raster.DirtyTiles.size, 0);
    const Command = History.Undo(Hist);
    Renderer.MarkTilesChanged(R, State.Doc, Edit.CommandTiles(Command));
    Renderer.DrawMinimap(R, Mini, State);
    assert.equal(R.Rasters.get('mini'), Raster);
    Model.SetTerrain(State.Doc, nTile, 4);
    Renderer.MarkTilesChanged(R, State.Doc, [nTile]);
    assert.ok(Raster.DirtyTiles.has(nTile));
    Renderer.DrawMinimap(R, Mini, State);
    assert.equal(R.Rasters.get('mini'), Raster);
    assert.equal(Raster.DirtyTiles.size, 0);
  });
}

test('local terrain renders in vector and raster modes with incremental edits and document switches', () => {
  const { Renderer, View, Model, State, R, nTile } = Setup(true);
  State.Layers.fTerrain = State.Layers.fGrid = State.Layers.fOutlines = State.Layers.fNames = true;
  State.nHoverTile = nTile;
  State.rgnPreviewTiles = Model.Neighbors(State.Doc, nTile);
  assert.equal(Renderer.Draw(R, State).fRaster, false);
  State.Camera.dScale = 1;
  assert.equal(Renderer.Draw(R, State).fRaster, true);
  const Raster = R.Rasters.get('main');
  Model.SetTerrain(State.Doc, nTile, 4);
  Renderer.MarkTilesChanged(R, State.Doc, [nTile]);
  Renderer.Draw(R, State);
  assert.equal(R.Rasters.get('main'), Raster);
  assert.equal(Raster.DirtyTiles.size, 0);
  State.Doc = Model.CreateGlobalMap({ nPanelHexes: 4 });
  State.Layout = View.MapLayout(State.Doc);
  State.nHoverTile = -1;
  State.rgnPreviewTiles = [];
  Renderer.Draw(R, State);
  assert.notEqual(R.Rasters.get('main'), Raster);
});

test('single-panel maps render and pick features without neighbouring panels', () => {
  const { Renderer, State, R, View } = Setup(false, 'Beta');
  State.Layers.fTerrain = State.Layers.fGrid = State.Layers.reference = true;
  Renderer.Draw(R, State);
  assert.ok(R.rgFeatureHits.some((Hit) => Hit.Key === 'road1'));
  assert.ok(R.rgFeatureHits.some((Hit) => Hit.Key === 'label1'));
  assert.ok(R.rgFeatureHits.every((Hit) => Hit.szDrawPanel === State.Doc.Global.szPanel));
  Renderer.DrawMinimap(R, Canvas(), State);
  const Raster = R.Rasters.get('mini');
  Renderer.DrawMinimap(R, Canvas(), State);
  assert.equal(R.Rasters.get('mini'), Raster);
  State.Camera.dScale = 1;
  assert.equal(Renderer.Draw(R, State).fRaster, true);
  assert.equal(View.MapLayout(State.Doc).rgPlacements.length, 1);
});

test('canvas reference toggle controls equator strokes and N/S crosshair circles', () => {
  for (const szPanel of ['Beta', 'Eta', 'Kappa']) {
    const { Renderer, State, R } = Setup(false, szPanel);
    State.Layers = { reference: true };
    const Calls = [];
    for (const szMethod of ['arc', 'strokeText', 'stroke']) {
      R.Context[szMethod] = (...rgArgs) => Calls.push([szMethod, ...rgArgs]);
    }
    Renderer.Draw(R, State);
    if (szPanel !== 'Beta') {
      assert.ok(Calls.some(([szMethod]) => szMethod === 'arc'));
      assert.ok(Calls.some(([szMethod, szText]) => szMethod === 'strokeText' && szText === (szPanel === 'Eta' ? 'N' : 'S')));
    }
    const nStrokes = Calls.filter(([szMethod]) => szMethod === 'stroke').length;
    Calls.length = 0;
    State.Layers.reference = false;
    Renderer.Draw(R, State);
    assert.ok(nStrokes > Calls.filter(([szMethod]) => szMethod === 'stroke').length);
    assert.ok(!Calls.some(([szMethod]) => szMethod === 'arc'));
  }
});
