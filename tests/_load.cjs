'use strict';
// Loads the editor's inline <script data-module="..."> blocks from
// map-editor/index.html (compiled with node:vm against a sandbox globalThis), so unit tests run
// exactly the code the browser runs. Blocks marked data-dom="true" are skipped.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const g_szRepositoryRoot = path.join(__dirname, '..');
const g_szHtmlPath = path.join(g_szRepositoryRoot, 'map-editor', 'index.html');

function ReadHtml() {
  return fs.readFileSync(g_szHtmlPath, 'utf8');
}

function ParseAttributes(szAttributes) {
  const Attributes = {};
  for (const Match of szAttributes.matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) {
    Attributes[Match[1]] = Match[2] === undefined ? '' : Match[2];
  }
  return Attributes;
}

// Blanks HTML comments while keeping their newlines, so line numbers still match.
function MaskComments(szHtml) {
  return szHtml.replace(/<!--[\s\S]*?-->/g, (szComment) => szComment.replace(/[^\n]/g, ' '));
}

// Returns every inline <script> block in document order with its attributes.
function ExtractScripts(szHtml = ReadHtml()) {
  const szMasked = MaskComments(szHtml);
  const rgScripts = [];
  for (const Match of szMasked.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const nLine = szMasked.slice(0, Match.index).split('\n').length;
    rgScripts.push({ Attributes: ParseAttributes(Match[1]), szSource: Match[2], nLine });
  }
  return rgScripts;
}

function ExtractModules(szHtml = ReadHtml()) {
  return ExtractScripts(szHtml)
    .filter((Script) => 'data-module' in Script.Attributes)
    .map((Script) => ({
      szName: Script.Attributes['data-module'],
      fDom: Script.Attributes['data-dom'] === 'true',
      szSource: Script.szSource,
      nLine: Script.nLine,
    }));
}

// Runs all DOM-free modules in document order and returns the RpgMap namespace.
// Modules are compiled in this realm (so their arrays and objects share the
// test's intrinsics) with a sandbox object standing in for globalThis.
function LoadModules() {
  const Sandbox = {};
  for (const Module of ExtractModules()) {
    if (Module.fDom) {
      continue;
    }
    const Run = vm.compileFunction(Module.szSource, ['globalThis'], {
      filename: g_szHtmlPath,
      lineOffset: Module.nLine - 1,
    });
    Run(Sandbox);
  }
  return Sandbox.RpgMap;
}

module.exports = {
  g_szRepositoryRoot,
  g_szHtmlPath,
  ReadHtml,
  ExtractScripts,
  ExtractModules,
  LoadModules,
};
