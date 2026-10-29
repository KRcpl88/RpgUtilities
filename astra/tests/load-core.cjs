"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = readFileSync(path.join(__dirname, "..", "map-editor.html"), "utf8");
const context = vm.createContext({ TextEncoder });
const sources = [];
for (const id of ["map-geometry", "map-documents", "map-editing", "map-local-editor", "map-global-editor", "map-layer-editor", "map-scale-editor", "map-svg-export", "map-operations", "map-task-runner"]) {
  const source = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  if (!source) throw new Error(`Missing inline core: ${id}`);
  vm.runInContext(source[1], context, { filename: `map-editor.html:${id}` });
  sources.push(source[1]);
}
module.exports = { geometry: context.MapGeometry, documents: context.MapDocuments, editor: context.MapLocalEditor,
  globalEditor: context.MapGlobalEditor, layers: context.MapLayerEditor, scales: context.MapScaleEditor, svg: context.MapSvgExport,
  operations: context.MapOperations, workerSource: sources.join("\n") };
