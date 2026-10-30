'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadHtml, ExtractScripts, ExtractModules, LoadModules } = require('./_load.cjs');

test('index.html has no external scripts, stylesheets, or frameworks', () => {
  const szHtml = ReadHtml();
  assert.doesNotMatch(szHtml, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(szHtml, /<link\b[^>]*\brel\s*=\s*"stylesheet"/i);
  assert.doesNotMatch(szHtml, /@import\b/);
  for (const Script of ExtractScripts(szHtml)) {
    assert.doesNotMatch(Script.szSource, /\brequire\s*\(|^\s*import\s/m,
      `script at line ${Script.nLine} must not load modules`);
  }
});

test('every inline script is a uniquely named module', () => {
  const rgScripts = ExtractScripts();
  const rgModules = ExtractModules();
  assert.ok(rgModules.length >= 2);
  assert.equal(rgModules.length, rgScripts.length, 'all scripts must declare data-module');
  const rgszNames = rgModules.map((Module) => Module.szName);
  assert.equal(new Set(rgszNames).size, rgszNames.length, 'module names must be unique');
  assert.equal(rgModules[0].szName, 'Util', 'Util must load first');
  assert.equal(rgModules.at(-1).szName, 'App', 'App must load last');
});

test('modules follow the registration convention', () => {
  for (const Module of ExtractModules()) {
    assert.match(Module.szSource, /^\s*\(function \(Root\) \{\s*'use strict';/,
      `${Module.szName} must use the module wrapper`);
    assert.match(Module.szSource, /\}\)\(globalThis\);\s*$/,
      `${Module.szName} must close the module wrapper`);
    assert.ok(Module.szSource.includes(`RpgMap.${Module.szName} = Object.freeze(`),
      `${Module.szName} must register a frozen RpgMap.${Module.szName}`);
  }
});

test('DOM-free modules load in Node without a browser', () => {
  const RpgMap = LoadModules();
  const rgszExpected = ExtractModules()
    .filter((Module) => !Module.fDom)
    .map((Module) => Module.szName);
  assert.deepEqual(Object.keys(RpgMap), rgszExpected);
  assert.equal(RpgMap.App, undefined, 'DOM modules must not load in tests');
  for (const szName of rgszExpected) {
    assert.ok(Object.isFrozen(RpgMap[szName]), `${szName} must be frozen`);
  }
});
