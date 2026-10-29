"use strict";

const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { geometry: g, documents: d, globalEditor: global, layers, svg } = require("./load-core.cjs");
const { createBrowserTools } = require("./browser-local-editor.cjs");

async function checkSvg(browser) {
  const { evaluate, profile, dialogResponses } = browser;
  const { text, value, click, choose, key, openFile, download, waitFor } = await createBrowserTools(browser);
  const tile = (q, row) => ({ panelId: "local", q, r: -row - Math.floor(q / 2) });
  const atlas = d.create({ id: "artwork", name: 'Artwork <&> "\u03b1"', kind: "local", scaleFamily: "regional", scale: "S",
    extent: { width: 17, height: 4, origin: [-7.25, 3.5] } });
  for (const [q, terrain] of d.TERRAINS.entries()) for (let row = 0; row < 4; row++)
    atlas.setTerrain("local", q, tile(q, row).r, terrain.id);
  for (const [q, type] of d.LANDMARK_TYPES.entries()) atlas.putLandmark({ id: type, type, tile: tile(q, 2) });
  for (const [row, type] of d.PATH_TYPES.entries()) atlas.putPath({ id: type, type,
    points: [atlas.tilePosition(tile(0, row)), atlas.tilePosition(tile(16, row))] });
  atlas.putLabel({ id: "literal", tile: tile(8, 2), text: '<script> & "Caf\u00e9"\n\u03b1 \ud83c\udff0', size: 12, rotation: 17, offset: [.2, -.1] });
  const fixture = path.join(profile, "svg-atlas.hexmap");
  await writeFile(fixture, d.serialize(atlas)); await openFile(fixture);
  assert.equal(await text("editor-error"), "");
  await choose("tile-terrain", "forest");
  await click("#save-map");
  const saved = await download(), undo = await text("undo");
  assert.equal(await text("save-state"), "Unsaved changes");

  await click("#export-svg");
  assert.equal(await evaluate("document.getElementById('export-dialog').open"), true);
  assert.equal(await evaluate("document.getElementById('export-panel-field').hidden"), true);
  await evaluate("document.getElementById('cancel-export').focus()");
  await key("z", "KeyZ", 90, 2);
  assert.equal(await text("undo"), undo);
  assert.equal(await value("tile-terrain"), "forest");
  await click("#cancel-export");
  assert.equal(await evaluate("document.getElementById('export-dialog').open"), false);
  await click("#export-svg"); await click("#download-svg");
  const exported = await download("svg");
  assert.equal(exported.source, svg.render(saved.map));
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.equal(await text("undo"), undo);
  assert.equal(await evaluate("document.getElementById('confirm-saved').hidden"), false);

  async function inspect(source, protrusion = null, probes = []) {
    return evaluate(`(async () => {
      const source = ${JSON.stringify(source)}, parsed = new DOMParser().parseFromString(source, "image/svg+xml");
      if (parsed.querySelector("parsererror")) throw new Error(parsed.querySelector("parsererror").textContent);
      const root = parsed.documentElement, bad = [...root.querySelectorAll("*")].filter(element =>
        ["script", "foreignObject", "image"].includes(element.localName) || [...element.attributes].some(attribute =>
          /^on/i.test(attribute.name) || /href$/.test(attribute.name) && !attribute.value.startsWith("#")));
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(image.naturalWidth * 2); canvas.height = Math.ceil(image.naturalHeight * 2);
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const view = root.getAttribute("viewBox").split(" ").map(Number);
        let filled = 0, dark = 0, outside = 0, hash = 2166136261;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 0) {
            filled++;
            if (pixels[i] < 110 && pixels[i + 1] < 110 && pixels[i + 2] < 110) dark++;
            const x = view[0] + ((i / 4) % canvas.width + .5) / canvas.width * view[2];
            if (${protrusion !== null} && Math.abs(x) > ${protrusion ?? 0} + .02) outside++;
          }
          for (let j = 0; j < 4; j++) hash = Math.imul(hash ^ pixels[i + j], 16777619);
        }
        return { namespace: root.namespaceURI, title: parsed.querySelector("title").textContent, bad: bad.length,
          lines: [...root.querySelectorAll('[data-id="literal"] tspan')].map(span => span.textContent),
          layers: [...root.querySelectorAll("[data-layer]")].map(group => group.getAttribute("data-layer")),
          samples: ${JSON.stringify(probes)}.map(([x, y]) => {
            const column = Math.floor((x - view[0]) / view[2] * canvas.width);
            const row = Math.floor((-y - view[1]) / view[3] * canvas.height);
            return pixels[(row * canvas.width + column) * 4 + 3];
          }), filled, dark, outside, hash: hash >>> 0 };
      } finally { URL.revokeObjectURL(url); }
    })()`);
  }
  const painted = await inspect(exported.source);
  assert.equal(painted.namespace, "http://www.w3.org/2000/svg"); assert.equal(painted.bad, 0);
  assert.equal(painted.title, atlas.metadata.name);
  assert.deepEqual(painted.lines, ['<script> & "Caf\u00e9"', "\u03b1 \ud83c\udff0"]);
  assert.ok(painted.filled > 10000 && painted.dark > 500, JSON.stringify(painted));
  async function options(included) {
    await evaluate(`for (const input of document.querySelectorAll("#export-options input"))
      input.checked = ${JSON.stringify(included)}.includes(input.id.replace("export-", ""));`);
  }
  await click("#export-svg"); await options(["colors"]); await click("#download-svg");
  const colored = await inspect((await download("svg")).source);
  assert.deepEqual(colored.layers, ["colors"]);
  assert.equal(colored.dark, 0); assert.notEqual(colored.hash, painted.hash);
  await click("#export-svg"); await options(["embellishments"]); await click("#download-svg");
  const art = await inspect((await download("svg")).source);
  assert.deepEqual(art.layers, ["embellishments"]);
  assert.ok(art.dark > 500 && art.filled < colored.filled);
  await click("#export-svg"); await options([]); await click("#download-svg");
  const empty = await inspect((await download("svg")).source);
  assert.equal(empty.filled, 0); assert.deepEqual(empty.layers, []);
  const lake = d.create({ id: "lake", kind: "local", defaultTerrain: "lakes", extent: { width: 1, height: 1, origin: [0, 0] } });
  const waterArt = await inspect(svg.render(lake, Object.fromEntries(Object.keys(svg.defaults).map(key => [key, key === "embellishments"]))),
    null, [-.2, -.1, 0, .1, .2].map(x => [x, .5]));
  assert.deepEqual(waterArt.samples, [0, 0, 0, 0, 0], "Pattern-filled regions must not acquire an inherited outline at a water/export boundary");
  await click("#confirm-saved"); assert.equal(await text("save-state"), "Unchanged");
  await click("#undo"); assert.equal(await value("tile-terrain"), "water");
  await click("#redo"); assert.equal(await text("save-state"), "Unchanged");
  await click("#path-new"); assert.equal(await evaluate("document.getElementById('export-svg').disabled"), true);
  await click("#path-cancel"); assert.equal(await evaluate("document.getElementById('export-svg').disabled"), false);

  const globe = d.create({ id: "protrusions", name: "Owned protrusions",
    projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 } }), world = global.world(globe);
  const a = [-world.width / 2 + world.spacing * .1, 0], owner = g.locateTile(world, "Hyz+-", a);
  globe.setTerrain(owner.panelId, owner.q, owner.r, "forest");
  const edge = g.projection.solid.edges.find(edge => edge.faces.includes("Hyz+-") && edge.faces.includes("Hxz--"));
  const b = g.seamTransform(world, edge.id, "Hyz+-", [-world.width / 2 - world.spacing * .1, 0]);
  globe.putPath({ id: "seam", type: "road", points: layers.pathPoints(globe, [
    { panelId: "Hyz+-", east: a[0], north: a[1] }, { panelId: b.faceId, east: b.point[0], north: b.point[1] }
  ]) });
  globe.putLandmark({ id: "seam-town", type: "town", tile: { panelId: owner.panelId, q: owner.q, r: owner.r } });
  globe.putLabel({ id: "seam-label", text: "B", tile: { panelId: owner.panelId, q: owner.q, r: owner.r },
    size: 6, rotation: 0, offset: [-world.spacing * .3, 0] });
  const worldFile = path.join(profile, "svg-world.hexmap");
  await writeFile(worldFile, d.serialize(globe)); await openFile(worldFile);
  await click("#export-svg");
  assert.equal(await value("export-panel"), "Hyz+-");
  assert.equal(await evaluate("document.getElementById('export-panel-field').hidden"), false);
  await options(Object.keys(svg.defaults)); await choose("export-panel", "Sz+"); await click("#download-svg");
  const rho = await download("svg");
  assert.equal(rho.source, svg.render(globe, { ...Object.fromEntries(Object.keys(svg.defaults).map(key => [key, true])), panelId: "Sz+" }));
  assert.equal(await value("global-panel"), "Hyz+-");
  await click("#export-svg");
  assert.equal(await value("export-panel"), "Hyz+-", "Each export starts from the active panel");
  await click("#download-svg");
  const alpha = await download("svg"), raster = await inspect(alpha.source, world.width / world.spacing / 2);
  assert.ok(raster.outside > 100, "Owned protrusions must contain visible pixels beyond the nominal panel width");
  assert.equal((alpha.source.match(/data-id="seam"/g) || []).length, 2);
  assert.match(alpha.source, /data-id="seam-label"/);
  assert.equal(await text("save-state"), "Unchanged");

  const huge = d.create({ id: "large-export", kind: "local", extent: { width: 200, height: 200, origin: [0, 0] } });
  const hugeFile = path.join(profile, "svg-huge.hexmap");
  await writeFile(hugeFile, d.serialize(huge)); await openFile(hugeFile);
  await choose("tile-terrain", "forest"); await click("#save-map");
  const before = await download(), history = await text("undo");
  await click("#export-svg"); await click("#download-svg");
  await waitFor(async () => !(await evaluate("document.getElementById('download-svg').disabled")), "rejected SVG completion");
  assert.match(await text("export-error"), /25,000 tiles/);
  assert.equal(await evaluate("document.getElementById('export-dialog').open"), true);
  await click("#cancel-export");
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.equal(await text("undo"), history);
  assert.equal(await evaluate("document.getElementById('confirm-saved').hidden"), false);
  await click("#save-map"); assert.equal((await download()).source, before.source);
  await click("#confirm-saved");
  await openFile(fixture);
  assert.equal(await text("editor-error"), "");
  assert.deepEqual(dialogResponses, []);
}

module.exports = { checkSvg };
