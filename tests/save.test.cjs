'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { extractModules, loadModules } = require('./_load.cjs');

function setup() {
  const rpgMap = loadModules();
  const nodes = new Map();
  const downloads = [];
  const storage = new Map([['rpgmap.autosave', 'previous autosave']]);
  let blob;
  let downloadError = null;
  function createElement(tag) {
    const node = {
      children: [],
      listeners: {},
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() {},
      click() {
        if (tag === 'a') {
          if (downloadError) {
            throw downloadError;
          }
          downloads.push({ name: this.download, blob });
        } else if (this.onclick) {
          this.onclick();
        }
      },
    };
    Object.defineProperty(node, 'id', {
      set(value) { nodes.set(value, node); },
    });
    return node;
  }
  const dialog = createElement('dialog');
  nodes.set('save-map-dialog', dialog);
  nodes.set('restore-banner', { hidden: true });
  const root = {
    RpgMap: rpgMap,
    document: {
      readyState: 'loading',
      title: 'Original title',
      addEventListener() {},
      createElement,
      getElementById: (id) => nodes.get(id),
      body: createElement('body'),
    },
    Blob,
    URL: {
      createObjectURL(value) { blob = value; return 'blob:save'; },
      revokeObjectURL() {},
    },
    clearTimeout() {},
    setTimeout(callback) { callback(); },
    requestAnimationFrame() {},
    localStorage: { removeItem: (key) => storage.delete(key) },
  };
  const appModule = extractModules().find((module) => module.name === 'App');
  vm.compileFunction(appModule.sourceText, ['globalThis'])(root);
  const app = rpgMap.App;
  app.state.doc = rpgMap.Model.createGlobalMap({ panelHexes: 4, name: 'Original map' });
  app.state.savedRevision = -1;
  app.saveMap();
  const nameInput = nodes.get('save-name');
  const form = nodes.get('save-map-form');
  return {
    app, rpgMap, nodes, downloads, storage, dialog, root,
    rename(name) { nameInput.value = name; form.listeners.input(); },
    submit() { form.listeners.submit({ preventDefault() {} }); },
    failDownload() { downloadError = new Error('Download blocked'); },
  };
}

test('Save prefills the map name and cancellation preserves unsaved work', () => {
  const { app, nodes, downloads, storage, dialog, rename, root } = setup();
  assert.equal(nodes.get('save-name').value, 'Original map');
  rename('Canceled name');
  assert.equal(nodes.get('save-map-preview').textContent, 'Download: Canceled-name.map.txt');
  app.saveMap();
  assert.equal(nodes.get('save-name').value, 'Canceled name');
  nodes.get('save-cancel').click();
  assert.equal(dialog.open, false);
  assert.equal(app.state.doc.name, 'Original map');
  assert.equal(root.document.title, 'Original title');
  assert.equal(app.isDirty(), true);
  assert.equal(storage.get('rpgmap.autosave'), 'previous autosave');
  assert.equal(downloads.length, 0);
});

test('Save writes the edited map name into the download and updates the open map', async () => {
  const { app, rpgMap, downloads, storage, dialog, rename, submit, root } = setup();
  const name = 'Kingdom / "North"';
  const original = rpgMap.FileFormat.write(app.state.doc);
  rename(name);
  submit();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, rpgMap.FileFormat.fileName({ name }));
  const text = await downloads[0].blob.text();
  const parsed = rpgMap.FileFormat.parse(text);
  assert.equal(parsed.name, name);
  assert.equal(text, rpgMap.FileFormat.write(app.state.doc));
  parsed.name = 'Original map';
  assert.equal(rpgMap.FileFormat.write(parsed), original);
  assert.equal(app.state.doc.name, name);
  assert.equal(root.document.title, `${name} \u2013 RPG World Map Editor`);
  assert.equal(app.isDirty(), false);
  assert.equal(storage.has('rpgmap.autosave'), false);
  assert.equal(dialog.open, false);
});

test('Save preserves unnamed maps and the existing fallback filename', async () => {
  const { rpgMap, downloads, rename, submit } = setup();
  rename('');
  submit();
  assert.equal(downloads[0].name, 'map.map.txt');
  assert.equal(rpgMap.FileFormat.parse(await downloads[0].blob.text()).name, '');
});

test('Save failure reports the error without changing the map or autosave', () => {
  const { app, nodes, storage, dialog, rename, submit, failDownload, root } = setup();
  rename('Failed name');
  failDownload();
  submit();
  assert.equal(nodes.get('save-map-error').textContent, 'Save failed: Download blocked');
  assert.equal(app.state.doc.name, 'Original map');
  assert.equal(root.document.title, 'Original title');
  assert.equal(app.isDirty(), true);
  assert.equal(storage.get('rpgmap.autosave'), 'previous autosave');
  assert.equal(dialog.open, true);
});
