'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, extractScripts, extractModules, loadModules } = require('./_load.cjs');

test('index.html has no external scripts, stylesheets, or frameworks', () => {
  const html = readHtml();
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\brel\s*=\s*"stylesheet"/i);
  assert.doesNotMatch(html, /@import\b/);
  for (const script of extractScripts(html)) {
    assert.doesNotMatch(script.sourceText, /\brequire\s*\(|^\s*import\s/m,
      `script at line ${script.lineNumber} must not load modules`);
  }
});

test('every inline script is a uniquely named module', () => {
  const scripts = extractScripts();
  const modules = extractModules();
  assert.ok(modules.length >= 2);
  assert.equal(modules.length, scripts.length, 'all scripts must declare data-module');
  const names = modules.map((module) => module.name);
  assert.equal(new Set(names).size, names.length, 'module names must be unique');
  assert.equal(modules[0].name, 'Util', 'Util must load first');
  assert.equal(modules.at(-1).name, 'App', 'App must load last');
});

test('modules follow the registration convention', () => {
  for (const module of extractModules()) {
    assert.match(module.sourceText, /^\s*\(function \(root\) \{\s*'use strict';/,
      `${module.name} must use the module wrapper`);
    assert.match(module.sourceText, /\}\)\(globalThis\);\s*$/,
      `${module.name} must close the module wrapper`);
    assert.ok(module.sourceText.includes(`rpgMap.${module.name} = Object.freeze(`),
      `${module.name} must register a frozen RpgMap.${module.name}`);
  }
});

test('DOM-free modules load in Node without a browser', () => {
  const rpgMap = loadModules();
  const expected = extractModules()
    .filter((module) => !module.usesDom)
    .map((module) => module.name);
  assert.deepEqual(Object.keys(rpgMap), expected);
  assert.equal(rpgMap.App, undefined, 'DOM modules must not load in tests');
  for (const name of expected) {
    assert.ok(Object.isFrozen(rpgMap[name]), `${name} must be frozen`);
  }
});
