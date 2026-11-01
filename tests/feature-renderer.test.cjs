'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { extractModules, loadModules } = require('./_load.cjs');

// Canvas contracts without browser dependencies; the browser smoke check verifies
// the actual pixels. These tests exercise Renderer, not a second implementation.
function canvas() {
  const context = { measureText: (text) => ({ width: text.length * 8 }) };
  for (const method of ['setTransform', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'save', 'restore',
    'transform', 'fill', 'stroke', 'rect', 'fillRect', 'clearRect', 'drawImage', 'strokeText', 'fillText',
    'translate', 'rotate', 'scale', 'setLineDash', 'arc', 'bezierCurveTo', 'strokeRect']) {
    context[method] = () => {};
  }
  return { width: 900, height: 600, getContext: () => context, getBoundingClientRect: () => ({ width: 900, height: 600 }) };
}

function setup(local = false, panelId = null) {
  const rpgMap = loadModules();
  const root = { RpgMap: rpgMap, document: { createElement: canvas }, devicePixelRatio: 1, Path2D: class {} };
  vm.compileFunction(extractModules().find((module) => module.name === 'Renderer').sourceText, ['globalThis'])(root);
  const { Model: model, View: view, Renderer: renderer } = rpgMap;
  const doc = local ? model.createLocalMap({
    width: 16, height: 12, systemName: 'local', scaleName: 'S', anchor: rpgMap.Coordinates.parseUniversal('Eta 123.4E 56.7N'),
  }) : panelId ? model.createPanelMap({ panelId: rpgMap.Coordinates.panelIdByName(panelId), panelHexes: 4 })
    : model.createGlobalMap({ panelHexes: 4 });
  const tileIndex = local ? 85 : doc.topo.tiles.find((tile) => !tile.isPartial).index;
  for (const type of ['road', 'trail', 'river']) {
    model.addOverlay(doc, { type, tileIndices: [tileIndex, model.neighbors(doc, tileIndex)[0]] });
  }
  model.setLandmark(doc, tileIndex, { type: 'castle' });
  model.addLabel(doc, { tileIndex, category: 'city', text: 'Keep', rotation: -25, dx: 3, dy: -12 });
  const state = {
    doc, layout: local || panelId ? view.mapLayout(doc) : view.buildFocusLayout(doc.topo.tiles[tileIndex].panelId), camera: view.createCamera(),
    layers: { showTerrain: false, showGrid: false, showOutlines: false, showNames: false, road: true, trail: true, river: true, landmark: true, label: true },
    hoverTile: -1, selection: null, labelPreview: null,
  };
  view.resizeCamera(state.camera, 900, 600);
  view.fitBounds(state.camera, state.layout.bounds);
  const r = renderer.create(canvas());
  return { ...rpgMap, state, r, tileIndex };
}

for (const local of [false, true]) {
  const kind = local ? 'local' : 'global';
  test(`${kind}: renderer draws all feature layers and excludes hidden layers from drawing and picking`, () => {
    const { Renderer: renderer, state, r } = setup(local);
    renderer.draw(r, state);
    const keys = new Set(r.featureHits.map((hit) => hit.key));
    for (const key of ['road1', 'trail1', 'river1', 'label1']) {
      assert.ok(keys.has(key));
    }
    assert.ok(r.featureHits.some((hit) => hit.layer === 'landmark'));
    for (const layer of ['road', 'trail', 'river', 'landmark', 'label']) {
      state.layers[layer] = false;
      renderer.draw(r, state);
      assert.ok(!r.featureHits.some((hit) => hit.key === layer + '1' || hit.layer === layer));
      state.layers[layer] = true;
    }
  });

  test(`${kind}: rotated label hit areas and handles agree with the drawn label transform`, () => {
    const { Renderer: renderer, Model: model, View: view, Projection: projection, state, r, tileIndex } = setup(local);
    state.selection = { layer: 'label', key: 'label1' };
    renderer.draw(r, state);
    const panelId = view.mapGeometry(state.doc).tiles[tileIndex].panelId;
    const hits = r.featureHits.filter((hit) => hit.key === 'label1' && hit.drawPanel === panelId);
    const labelHit = hits.find((hit) => hit.screenToText);
    assert.ok(labelHit);
    const transform = projection.invertTransform(labelHit.screenToText);
    const screen = projection.applyTransform(transform, [10, 0]);
    assert.equal(renderer.hitFeature(r, state, screen, 'label').key, 'label1');
    for (const handleKind of ['move', 'rotate']) {
      const handle = hits.find((hit) => hit.handleKind === handleKind);
      assert.ok(handle);
      assert.equal(renderer.hitFeature(r, state, handle.screen, 'label').handleKind, handleKind);
    }
    const original = model.getLabel(state.doc, 'label1');
    state.labelPreview = { ...original, dx: original.dx + 4 };
    renderer.draw(r, state);
    const previewHit = r.featureHits.find((hit) => hit.key === 'label1' && hit.screenToText && hit.drawPanel === panelId);
    assert.notDeepEqual(previewHit.screenToText, labelHit.screenToText);
    assert.equal(model.getLabel(state.doc, 'label1'), original, 'preview does not mutate document');
    assert.equal(renderer.hitFeature(r, state, [-100, -100]), null);
    assert.ok(view.LABEL_UNITS_PER_HEX > 0);
  });

  test(`${kind}: feature edits and their undo keep cached terrain rasters, while terrain edits mark dirty tiles`, () => {
    const { Renderer: renderer, Model: model, Edit: edit, History: history, state, r, tileIndex } = setup(local);
    const mini = canvas();
    renderer.drawMinimap(r, mini, state);
    const raster = r.rasters.get('mini');
    const hist = history.create(state.doc);
    edit.setFeature(hist, 'landmark', tileIndex, { name: 'Renamed' });
    renderer.markTilesChanged(r, state.doc, []);
    renderer.drawMinimap(r, mini, state);
    assert.equal(r.rasters.get('mini'), raster);
    assert.equal(raster.dirtyTiles.size, 0);
    const command = history.undo(hist);
    renderer.markTilesChanged(r, state.doc, edit.commandTiles(command));
    renderer.drawMinimap(r, mini, state);
    assert.equal(r.rasters.get('mini'), raster);
    model.setTerrain(state.doc, tileIndex, 4);
    renderer.markTilesChanged(r, state.doc, [tileIndex]);
    assert.ok(raster.dirtyTiles.has(tileIndex));
    renderer.drawMinimap(r, mini, state);
    assert.equal(r.rasters.get('mini'), raster);
    assert.equal(raster.dirtyTiles.size, 0);
  });
}

test('local terrain renders in vector and raster modes with incremental edits and document switches', () => {
  const { Renderer: renderer, View: view, Model: model, state, r, tileIndex } = setup(true);
  state.layers.showTerrain = state.layers.showGrid = state.layers.showOutlines = state.layers.showNames = true;
  state.hoverTile = tileIndex;
  state.previewTiles = model.neighbors(state.doc, tileIndex);
  assert.equal(renderer.draw(r, state).raster, false);
  state.camera.scale = 1;
  assert.equal(renderer.draw(r, state).raster, true);
  const raster = r.rasters.get('main');
  model.setTerrain(state.doc, tileIndex, 4);
  renderer.markTilesChanged(r, state.doc, [tileIndex]);
  renderer.draw(r, state);
  assert.equal(r.rasters.get('main'), raster);
  assert.equal(raster.dirtyTiles.size, 0);
  state.doc = model.createGlobalMap({ panelHexes: 4 });
  state.layout = view.mapLayout(state.doc);
  state.hoverTile = -1;
  state.previewTiles = [];
  renderer.draw(r, state);
  assert.notEqual(r.rasters.get('main'), raster);
});

test('single-panel maps render and pick features without neighbouring panels', () => {
  const { Renderer: renderer, state, r, View: view } = setup(false, 'Beta');
  state.layers.showTerrain = state.layers.showGrid = state.layers.reference = true;
  renderer.draw(r, state);
  assert.ok(r.featureHits.some((hit) => hit.key === 'road1'));
  assert.ok(r.featureHits.some((hit) => hit.key === 'label1'));
  assert.ok(r.featureHits.every((hit) => hit.drawPanel === state.doc.global.panelId));
  renderer.drawMinimap(r, canvas(), state);
  const raster = r.rasters.get('mini');
  renderer.drawMinimap(r, canvas(), state);
  assert.equal(r.rasters.get('mini'), raster);
  state.camera.scale = 1;
  assert.equal(renderer.draw(r, state).raster, true);
  assert.equal(view.mapLayout(state.doc).placements.length, 1);
});

test('canvas reference toggle controls equator strokes and N/S crosshair circles', () => {
  for (const panelId of ['Beta', 'Eta', 'Kappa']) {
    const { Renderer: renderer, state, r } = setup(false, panelId);
    state.layers = { reference: true };
    const calls = [];
    for (const method of ['arc', 'strokeText', 'stroke']) {
      r.context[method] = (...args) => calls.push([method, ...args]);
    }
    renderer.draw(r, state);
    if (panelId !== 'Beta') {
      assert.ok(calls.some(([method]) => method === 'arc'));
      assert.ok(calls.some(([method, text]) => method === 'strokeText' && text === (panelId === 'Eta' ? 'N' : 'S')));
    }
    const strokes = calls.filter(([method]) => method === 'stroke').length;
    calls.length = 0;
    state.layers.reference = false;
    renderer.draw(r, state);
    assert.ok(strokes > calls.filter(([method]) => method === 'stroke').length);
    assert.ok(!calls.some(([method]) => method === 'arc'));
  }
});
