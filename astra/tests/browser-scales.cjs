"use strict";

const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { geometry: g, documents: d, globalEditor: global, layers, scales } = require("./load-core.cjs");
const { createBrowserTools } = require("./browser-local-editor.cjs");

async function checkScales(browser) {
  const { call, evaluate, profile, dialogResponses } = browser;
  const { text, value, waitFor, frame, click, choose, go, openFile, download } =
    await createBrowserTools(browser);
  const plain = value => JSON.parse(JSON.stringify(value));
  async function fields(values) {
    await evaluate(`for (const [id, value] of Object.entries(${JSON.stringify(values)}))
      document.getElementById(id).value = value;`);
  }
  async function save(confirm = true) {
    assert.equal(await text("editor-error"), "");
    await click("#save-map");
    const saved = await download();
    if (confirm) {
      await click("#confirm-saved");
      assert.equal(await text("save-state"), "Unchanged");
    }
    return saved;
  }
  async function derive(scale, name, fails = false) {
    await choose("derive-scale", scale); await fields({ "derive-name": name });
    await click("#derive-map");
    await waitFor(async () => !(await evaluate("document.getElementById('derive-map').disabled")), "conversion completion");
    if (!fails) {
      assert.equal(await text("editor-error"), "");
      assert.equal(await text("document-name"), name);
      assert.equal(await text("save-state"), "Unsaved changes");
    }
  }
  async function coordinate(panel, east, north) {
    await evaluate("document.getElementById('global-lookup').open = true;");
    await choose("coordinate-panel", panel);
    await fields({ "coordinate-east": east, "coordinate-north": north });
    await click("#panel-coordinate-form button");
  }
  async function pixels() {
    await frame();
    return evaluate(`(() => {
      const canvas = document.getElementById("local-map");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
      return hash >>> 0;
    })()`);
  }

  const parent = await save();
  await coordinate("Hyz+-", 10, 20);
  await click("#new-map");
  assert.equal(await evaluate("document.getElementById('new-anchor-field').hidden"), false);
  await click("#new-anchor");
  await choose("new-family", "regional"); await choose("new-scale", "M");
  await fields({ "new-name": "Registered source", "new-width": 3, "new-height": 3, "new-east": -12, "new-north": 8 });
  await click("#create-map");
  assert.equal(await value("anchor-map"), parent.map.metadata.id);
  assert.equal(await value("anchor-columns"), "2");
  assert.equal(await value("anchor-east"), "10"); assert.equal(await value("anchor-north"), "20");
  assert.equal(await value("anchor-find-east"), "10"); assert.equal(await value("anchor-find-north"), "20");
  assert.match(await text("conversion-info"), /regional M/);
  assert.match(await evaluate("document.getElementById('derive-scale').textContent"), /216 miles/);
  const initial = await save();
  assert.deepEqual(plain(initial.map.metadata.anchor), {
    mapId: parent.map.metadata.id, projection: plain(parent.map.metadata.projection),
    panelId: "Hyz+-", east: 10, north: 20, rotation: 0
  });
  assert.equal(initial.map.terrainBlocks.length, 0, "Anchored creation does not silently extract parent terrain");

  await fields({ "anchor-rotation": 90 }); await click("#anchor-apply");
  assert.equal(await text("undo"), "Undo Set global anchor");
  const registered = await save();
  await go(1, 1);
  const target = { panelId: "local", q: 1, r: -1 }, p = registered.map.tilePosition(target);
  const globalPoint = scales.toGlobal(registered.map, [p.east, p.north]);
  assert.ok((await text("anchor-location")).includes(`east ${globalPoint.east.toFixed(6)}, north ${globalPoint.north.toFixed(6)}`));
  await go(0, 0);
  await fields({ "anchor-find-east": globalPoint.east, "anchor-find-north": globalPoint.north });
  await click("#anchor-find");
  assert.match(await text("tile-info"), /^\(1, -1\)/);
  await fields({ "anchor-find-east": 1e6 }); await click("#anchor-find");
  assert.match(await text("editor-error"), /outside the local map/);
  await fields({ "anchor-east": 1e9 }); await click("#anchor-apply");
  assert.match(await text("editor-error"), /outside/);
  await fields({ "anchor-east": 10 }); await click("#anchor-apply");
  assert.equal(await text("save-state"), "Unchanged");
  await click("#anchor-clear");
  assert.match(await text("anchor-location"), /Set an anchor/);
  await click("#undo"); assert.equal(await value("anchor-rotation"), "90");
  await click("#redo"); assert.equal(await value("anchor-map"), "");
  await click("#undo");
  assert.equal((await save()).source, registered.source);

  await openFile(registered.filename);
  assert.equal(await value("anchor-rotation"), "90");
  await go(0, 0);
  await fields({ "anchor-rotation": 37 });
  await choose("tile-terrain", "forest");
  assert.equal(await value("anchor-rotation"), "37", "Unapplied anchor fields survive unrelated edits");
  await fields({ "anchor-rotation": 90 });
  const source = await save(false);
  assert.equal(await text("save-state"), "Unsaved changes");
  await click("#path-new");
  for (const id of ["derive-map", "anchor-apply", "anchor-clear"])
    assert.equal(await evaluate(`document.getElementById("${id}").disabled`), true, id);
  await click("#path-cancel");
  await derive("S", "Registered derived");
  assert.match(await text("source-state"), /Unsaved source changes/);
  dialogResponses.push(false); await click("#return-source");
  assert.equal(await text("document-name"), "Registered derived");
  const child = await save();
  assert.notEqual(child.map.metadata.id, source.map.metadata.id);
  assert.equal(child.map.metadata.scaleFamily, "regional");
  assert.equal(child.map.metadata.scale, "S");
  const a = scales.toGlobal(source.map, [-11, 6]), b = scales.toGlobal(child.map, [-11, 6]);
  assert.ok(Math.hypot(a.east - b.east, a.north - b.north) < 1e-8);
  dialogResponses.push(false);
  await call("Page.navigate", { url: "about:blank" });
  assert.equal(await evaluate("location.protocol"), "file:", "A saved child still protects its unsaved retained source");
  await click("#new-map"); dialogResponses.push(false); await click("#create-map");
  assert.equal(await text("document-name"), "Registered derived");
  await click("#cancel-new");
  dialogResponses.push(false); await openFile(parent.filename);
  assert.equal(await text("document-name"), "Registered derived");
  await click("#return-source");
  assert.equal(await text("document-name"), "Registered source");
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.equal(await text("undo"), "Undo Set terrain");
  await click("#confirm-saved");
  assert.equal(await text("save-state"), "Unchanged", "Source download checkpoint survives conversion and return");
  assert.equal((await save()).source, source.source, "Source bytes and history survive independent derivation");
  await click("#undo"); await go(0, 0);
  assert.equal(await value("tile-terrain"), "plain");
  await click("#redo"); assert.equal(await value("tile-terrain"), "forest");

  await choose("landmark-type", "town"); await click("#landmark-apply");
  await go(1, 0); await choose("landmark-type", "mine"); await click("#landmark-apply");
  const collision = await save(false), undo = await text("undo");
  await derive("L", "Rejected collision", true);
  assert.match(await text("editor-error"), /would share tile/);
  assert.equal(await text("document-name"), "Registered source");
  assert.equal(await text("undo"), undo);
  assert.equal(await evaluate("document.getElementById('return-source').hidden"), true);
  await go(1, 0);
  assert.equal((await save(false)).source, collision.source);

  dialogResponses.push(true); await openFile(child.filename);
  assert.equal(await text("document-name"), "Registered derived");
  await choose("tile-terrain", "hills");
  assert.match(await text("undo"), /Set terrain/);
  await save();
  await openFile(parent.filename);
  await choose("goto-panel", "Hyz+-"); await go(0, 0);
  await choose("tile-terrain", "forest");
  const globalSource = await save();
  await derive("L", "Global derived");
  assert.equal(await evaluate("document.getElementById('anchor-editor').hidden"), true);
  const world = await save();
  assert.equal(world.map.metadata.kind, "global");
  assert.equal(world.map.metadata.scaleFamily, "regional");
  assert.deepEqual(plain(world.map.metadata.projection), plain(globalSource.map.metadata.projection));
  assert.deepEqual(plain(world.map.paths), plain(globalSource.map.paths));
  assert.ok(world.map.terrainBlocks.length);
  await click("#return-source");
  assert.equal((await save()).source, globalSource.source);
  await openFile(world.filename);
  await choose("goto-panel", "Hyz+-"); await go(0, 0); await choose("tile-terrain", "hills");
  const edited = await save();
  assert.equal(edited.map.metadata.id, world.map.metadata.id);
  assert.equal(edited.map.terrainAt("Hyz+-", 0, 0), "hills");

  await click("#new-map");
  await choose("new-family", "local"); await choose("new-scale", "M");
  await fields({ "new-name": "Yard source" }); await click("#create-map");
  assert.match(await evaluate("document.getElementById('derive-scale').textContent"), /600 yards/);
  await choose("tile-terrain", "forest");
  await derive("S", "Yard child 1");
  const yard = await save();
  assert.equal(yard.map.metadata.scaleFamily, "local");
  assert.equal(yard.map.metadata.scale, "S");
  assert.ok(yard.map.terrainBlocks.length);
  for (let i = 2; i <= 8; i++) await derive("S", `Yard child ${i}`);
  assert.match(await text("source-state"), /^8 source map/);
  await derive("S", "Rejected ninth source", true);
  assert.match(await text("editor-error"), /Eight source maps/);
  assert.equal(await text("document-name"), "Yard child 8");
  dialogResponses.push(false); await click("#return-source");
  assert.equal(await text("document-name"), "Yard child 8");
  dialogResponses.push(true); await click("#return-source");
  assert.equal(await text("document-name"), "Yard child 7");
  assert.match(await text("source-state"), /^7 source map/);

  const seam = d.create({ id: "seam-label-source", name: "Seam label source", scale: "L", projection: parent.map.metadata.projection });
  const blank = scales.derive(seam, { id: "seam-blank", scale: "XL" }), seamWorld = global.world(seam);
  let tile;
  for (const face of seamWorld.strip) {
    for (const shape of g.tiles(seamWorld, face)) {
      const ref = { panelId: face, q: shape.q, r: shape.r }, p = layers.anchor(seam, ref);
      const next = global.locate(blank, p.panelId, [p.east, p.north]).tile;
      if (layers.anchor(blank, next).panelId !== p.panelId) { tile = ref; break; }
    }
    if (tile) break;
  }
  assert.ok(tile);
  seam.putLabel({ id: "seam-label", text: "Visible across conversion", tile, size: 12, rotation: 23, offset: [3, -2] });
  const filename = path.join(profile, "conversion-label.hexmap");
  await writeFile(filename, d.serialize(seam));
  dialogResponses.push(true);
  await openFile(filename);
  await derive("XL", "Coarsened seam label");
  const coarsened = await save(), position = layers.labelPosition(seam, seam.labels[0]);
  assert.notEqual(layers.anchor(coarsened.map, coarsened.map.labels[0].tile).panelId, layers.anchor(seam, tile).panelId);
  await coordinate(position.panelId, position.east, position.north);
  await evaluate("document.getElementById('show-labels').closest('details').open = true;");
  const visible = await pixels();
  await click("#show-labels");
  assert.notEqual(await pixels(), visible, "Reanchored text must remain visible on its physical geometric face");
  await click("#show-labels");
  await evaluate(`document.getElementById("global-lookup").open = false;
    document.getElementById("show-labels").closest("details").open = false;`);
  await openFile(registered.filename);
  await frame();
  assert.equal(await text("editor-error"), "");
}

module.exports = { checkScales };
