'use strict';
// Loads the editor's inline <script data-module="..."> blocks from
// map-editor/index.html (compiled with node:vm against a sandbox globalThis), so unit tests run
// exactly the code the browser runs. Blocks marked data-dom="true" are skipped.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPOSITORY_ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(REPOSITORY_ROOT, 'map-editor', 'index.html');

function readHtml() {
  return fs.readFileSync(HTML_PATH, 'utf8');
}

function parseAttributes(attributeText) {
  const attributes = {};
  for (const match of attributeText.matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) {
    attributes[match[1]] = match[2] === undefined ? '' : match[2];
  }
  return attributes;
}

// Blanks HTML comments while keeping their newlines, so line numbers still match.
function maskComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

// Returns every inline <script> block in document order with its attributes.
function extractScripts(html = readHtml()) {
  const masked = maskComments(html);
  const scripts = [];
  for (const match of masked.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const lineNumber = masked.slice(0, match.index).split('\n').length;
    scripts.push({ attributes: parseAttributes(match[1]), sourceText: match[2], lineNumber });
  }
  return scripts;
}

function extractModules(html = readHtml()) {
  return extractScripts(html)
    .filter((script) => 'data-module' in script.attributes)
    .map((script) => ({
      name: script.attributes['data-module'],
      usesDom: script.attributes['data-dom'] === 'true',
      sourceText: script.sourceText,
      lineNumber: script.lineNumber,
    }));
}

// Runs all DOM-free modules in document order and returns the RpgMap namespace.
// Modules are compiled in this realm (so their arrays and objects share the
// test's intrinsics) with a sandbox object standing in for globalThis.
function loadModules() {
  const sandbox = {};
  for (const module of extractModules()) {
    if (module.usesDom) {
      continue;
    }
    const run = vm.compileFunction(module.sourceText, ['globalThis'], {
      filename: HTML_PATH,
      lineOffset: module.lineNumber - 1,
    });
    run(sandbox);
  }
  return sandbox.RpgMap;
}

module.exports = {
  REPOSITORY_ROOT,
  HTML_PATH,
  readHtml,
  extractScripts,
  extractModules,
  loadModules,
};
