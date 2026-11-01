'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { extractModules, loadModules } = require('./_load.cjs');

function setup() {
  const rpgMap = loadModules();
  const storage = new Map();
  const banner = { hidden: true };
  const root = {
    RpgMap: rpgMap,
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => banner,
    },
    clearTimeout() {},
    localStorage: {
      setItem: (key, value) => storage.set(key, value),
    },
  };
  const appModule = extractModules().find((module) => module.name === 'App');
  vm.compileFunction(appModule.sourceText, ['globalThis'])(root);
  const { App: app, Model: model } = rpgMap;
  app.state.doc = model.createGlobalMap({ panelHexes: 4, name: 'Autosave naming migration' });
  app.state.savedRevision = null;
  return { rpgMap, app, storage, banner };
}

test('autosave preserves the persisted envelope after identifier renaming', () => {
  const { rpgMap, app, storage } = setup();
  app.autosave();
  const saved = JSON.parse(storage.get('rpgmap.autosave'));
  assert.deepEqual(Object.keys(saved), ['szText', 'nTime']);
  assert.equal(saved['szText'], rpgMap.FileFormat.write(app.state.doc));
  assert.ok(Number.isSafeInteger(saved['nTime']));
  assert.equal(rpgMap.FileFormat.parse(saved['szText']).name, app.state.doc.name);
});

test('autosave does not overwrite the previous save while restore is offered', () => {
  const { app, storage, banner } = setup();
  const previous = '{"szText":"previous saved map","nTime":123}';
  storage.set('rpgmap.autosave', previous);
  banner.hidden = false;
  app.autosave();
  assert.equal(storage.get('rpgmap.autosave'), previous);
});
