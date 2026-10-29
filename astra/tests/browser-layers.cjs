"use strict";

const assert = require("node:assert/strict");
const { geometry: g, documents: d, globalEditor: global } = require("./load-core.cjs");
const { createBrowserTools } = require("./browser-local-editor.cjs");

async function checkLayers(browser) {
  const { call, evaluate, profile, dialogResponses } = browser;
  const { text, value, frame, click, choose, key, go, openFile, download } =
    await createBrowserTools(browser);
  const literal = 'Caf\u00e9 <>& "region"\n\u03b1 \ud83c\udff0';
  const plain = value => JSON.parse(JSON.stringify(value));
  async function fields(values) {
    await evaluate(`for (const [id, value] of Object.entries(${JSON.stringify(values)}))
      document.getElementById(id).value = value;`);
  }
  async function save() {
    assert.equal(await text("editor-error"), "");
    await click("#save-map");
    const saved = await download();
    await click("#confirm-saved");
    assert.equal(await text("save-state"), "Unchanged");
    return saved;
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
  async function coordinate(faceId, east, north) {
    await evaluate("document.getElementById('global-lookup').open = true;");
    await choose("coordinate-panel", faceId);
    await fields({ "coordinate-east": east, "coordinate-north": north });
    await click("#panel-coordinate-form button");
  }

  await click("#new-map");
  await choose("new-family", "regional");
  await choose("new-scale", "S");
  await fields({ "new-name": "Layer workflow", "new-width": 8, "new-height": 6, "new-east": 0, "new-north": 0 });
  dialogResponses.push(true);
  await click("#create-map");
  await choose("path-type", "road");
  await click("#path-new");
  assert.equal(await text("save-state"), "Unsaved path draft");
  for (const id of ["save-map", "new-map", "open-map", "undo", "label-apply", "landmark-apply"])
    assert.equal(await evaluate(`document.getElementById("${id}").disabled`), true, id);
  await go(1, 1); await click("#local-map");
  await go(4, 2); await click("#local-map");
  assert.equal(await evaluate("document.getElementById('path-vertex').options.length"), 2);
  await choose("path-vertex", "0");
  await go(2, 1); await click("#path-insert");
  assert.equal(await evaluate("document.getElementById('path-vertex').options.length"), 3);
  await fields({ "path-east": -100 });
  await click("#path-update");
  assert.match(await text("editor-error"), /outside/);
  assert.equal(await evaluate("document.getElementById('path-vertex').options.length"), 3);
  await fields({ "path-east": 1.6, "path-north": -1 });
  await click("#path-update");
  assert.equal(await text("editor-error"), "");
  await click("#path-remove");
  assert.equal(await evaluate("document.getElementById('path-vertex').options.length"), 2);
  await click("#path-finish");
  const roadId = await value("path-record");
  assert.match(await text("map-properties"), /1 paths, 0 landmarks, 0 labels/);
  assert.equal(await text("undo"), "Undo Add path");

  for (const [type, start, end] of [["trail", [1, 2], [4, 2]], ["river", [1, 3], [4, 0]]]) {
    await choose("path-type", type); await click("#path-new");
    await go(...start); await key("Enter", "Enter", 13);
    await go(...end); await click("#path-append");
    await click("#path-finish");
  }
  await click("#path-delete");
  assert.match(await text("map-properties"), /2 paths/);
  await click("#undo"); await click("#redo"); await click("#undo");
  const paths = await save();
  assert.deepEqual(plain(paths.map.paths.map(item => item.type).sort()), ["river", "road", "trail"]);
  const road = paths.map.paths.find(item => item.id === roadId);
  assert.equal(road.points.length, 2);

  await choose("path-record", roadId); await click("#path-edit");
  await fields({ "path-east": 2, "path-north": -1 });
  await click("#path-update");
  dialogResponses.push(false);
  await call("Page.navigate", { url: "about:blank" });
  assert.equal(await evaluate("location.protocol"), "file:");
  assert.equal(await text("save-state"), "Unsaved path draft");
  await evaluate("document.getElementById('path-east').focus();");
  await key("Escape", "Escape", 27);
  assert.equal(await text("save-state"), "Unchanged");
  assert.equal((await save()).source, paths.source, "Cancelled drafts must not rewrite committed paths");
  await click("#path-edit");
  await fields({ "path-east": 2, "path-north": -1 });
  await click("#path-update"); await click("#path-finish");
  assert.equal(await text("undo"), "Undo Edit path");

  await go(1, 1); await choose("tool", "landmark"); await choose("landmark-type", "castle");
  await click("#local-map");
  const castle = await save();
  await choose("landmark-type", "city"); await click("#landmark-apply");
  assert.match(await text("tile-layers"), /Landmark: city/);
  assert.match(await text("map-properties"), /3 paths, 1 landmarks, 0 labels/);
  await click("#undo"); assert.match(await text("tile-layers"), /Landmark: castle/);
  await click("#redo"); await click("#landmark-delete");
  assert.match(await text("tile-layers"), /No landmark/);
  await click("#undo");
  await click("#label-new");
  await fields({ "label-text": literal, "label-size": 18.5, "label-rotation": 37.5, "label-east": .2, "label-north": -.1 });
  await click("#label-apply");
  const firstLabel = await value("label-record");
  assert.ok(firstLabel);
  assert.equal(await value("label-text"), literal);
  await click("#label-new");
  await fields({ "label-text": "Second label", "label-size": 12 });
  await click("#label-apply");
  const secondLabel = await value("label-record");
  assert.notEqual(firstLabel, secondLabel);
  assert.match(await text("tile-layers"), /2 labels on this tile/);
  await choose("label-record", firstLabel);
  await go(2, 2);
  await fields({ "label-size": 22.5, "label-rotation": 73.25, "label-east": .3, "label-north": .15 });
  await click("#label-apply");
  assert.match(await text("tile-layers"), /1 labels on this tile/);
  await fields({ "label-text": "   " }); await click("#label-apply");
  assert.match(await text("editor-error"), /text/);
  await fields({ "label-text": literal }); await click("#label-apply");
  await choose("label-record", secondLabel); await click("#label-delete");
  assert.match(await text("map-properties"), /1 labels/);
  await click("#undo");
  const layered = await save();
  assert.equal(layered.map.landmarks[0].id, castle.map.landmarks[0].id, "Replacing a tile landmark must preserve its identity");
  assert.equal(layered.map.landmarks[0].type, "city");
  const label = layered.map.labels.find(item => item.id === firstLabel);
  assert.equal(label.text, literal);
  assert.equal(label.size, 22.5);
  assert.equal(label.rotation, 73.25);
  assert.deepEqual(plain(label.offset), [.3, .15]);
  assert.deepEqual(plain(label.tile), { panelId: "local", q: 2, r: -3 });
  assert.deepEqual(plain(layered.map.paths.find(item => item.id === roadId).points.at(-1)), { panelId: "local", east: 2, north: -1 });
  assert.match(layered.source, /Caf\\u00e9/);

  await choose("path-record", "");
  await go(2, 2);
  await evaluate("document.getElementById('show-terrain').closest('details').open = true;");
  for (const layer of ["terrain", "road", "trail", "river", "landmarks", "labels"]) {
    const visible = await pixels();
    await click("#show-" + layer);
    assert.notEqual(await pixels(), visible, `Hiding ${layer} must change rendered pixels`);
    assert.equal(await text("save-state"), "Unchanged");
    await click("#show-" + layer);
    assert.equal(await pixels(), visible, `Restoring ${layer} must restore rendered pixels`);
  }
  assert.equal((await save()).source, layered.source, "Visibility is not authored data");
  await choose("tile-terrain", "forest");
  const painted = await save();
  for (const layer of ["paths", "landmarks", "labels"])
    assert.deepEqual(plain(painted.map[layer]), plain(layered.map[layer]), `${layer} survive terrain edits`);
  await openFile(painted.filename);
  assert.equal(await text("document-name"), "Layer workflow");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await choose("label-record", firstLabel);
  assert.equal(await value("label-text"), literal);
  assert.equal(await value("label-rotation"), "73.25");
  await fields({ "label-text": literal + " reopened" }); await click("#label-apply");
  assert.equal(await text("undo"), "Undo Edit label");
  await click("#undo");
  assert.equal(await value("label-text"), literal);
  assert.equal(await text("save-state"), "Unchanged");

  await click("#new-global");
  await choose("new-scale", "XL");
  await fields({ "new-world-columns": 2, "new-name": "Seam layers" });
  await click("#create-map");
  const template = d.create({ id: "layer-seams", projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 } });
  const world = global.world(template), face = world.strip[0];
  const across = global.hitTest(template, face, [-world.width / 2 - world.spacing * .6, 0]);
  await choose("path-type", "river"); await click("#path-new");
  await coordinate(face, -world.width / 2 + world.spacing * .25, 0); await key("Enter", "Enter", 13);
  await coordinate(across.faceId, ...across.point); await click("#path-append");
  await click("#path-finish");
  const riverId = await value("path-record");
  const irregular = g.projection.solid.edges.find(edge => edge.faces.some(id => id.startsWith("S")));
  const [a, b] = irregular.faces;
  const ends = irregular.vertices.map(id => g.solidToPanel(world, a, g.projection.solid.vertices.find(vertex => vertex.id === id).position));
  const middle = [0, 1].map(axis => (ends[0][axis] + ends[1][axis]) / 2);
  const far = g.seamTransform(world, irregular.id, a, middle.map(v => v * 1.1));
  await choose("path-type", "road"); await click("#path-new");
  await coordinate(a, ...middle.map(v => v * .9)); await key("Enter", "Enter", 13);
  await coordinate(far.faceId, ...far.point); await key("Enter", "Enter", 13);
  await click("#path-finish");
  await choose("goto-panel", "Sz-"); await go(-1, 0);
  await choose("landmark-type", "mine"); await click("#landmark-apply");
  await click("#label-new");
  await fields({ "label-text": "Partial tile", "label-size": 14, "label-rotation": -20 });
  await click("#label-apply");
  assert.match(await text("tile-layers"), /Landmark: mine. 1 labels/);
  const globalSaved = await save();
  assert.equal(globalSaved.map.paths.length, 2);
  for (const path of globalSaved.map.paths) {
    assert.equal(path.points.length, 4, path.type);
    const first = path.points[1], second = path.points[2];
    assert.notEqual(first.panelId, second.panelId);
    const p = g.panelToSolid(world, first.panelId, [first.east, first.north]);
    const q = g.panelToSolid(world, second.panelId, [second.east, second.north]);
    assert.ok(Math.hypot(...p.map((v, i) => (v - q[i]) * world.unitMiles)) < 1e-7);
  }
  assert.deepEqual(plain(globalSaved.map.landmarks[0].tile), { panelId: "Sz-", q: -1, r: 0 });
  assert.deepEqual(plain(globalSaved.map.labels[0].tile), plain(globalSaved.map.landmarks[0].tile));
  const visible = await pixels();
  await click("#show-landmarks");
  assert.notEqual(await pixels(), visible, "Partial-tile landmark must be visible");
  await click("#show-landmarks");
  await openFile(globalSaved.filename);
  await choose("path-record", riverId); await click("#path-edit");
  await choose("path-type", "trail"); await click("#path-finish");
  const continued = await save();
  const before = globalSaved.map.paths.find(item => item.id === riverId), after = continued.map.paths.find(item => item.id === riverId);
  assert.equal(after.type, "trail");
  assert.deepEqual(plain(after.points), plain(before.points), "Editing an imported path must preserve exact seam pairs");
  assert.deepEqual(plain(continued.map.labels), plain(globalSaved.map.labels));
  assert.deepEqual(plain(continued.map.landmarks), plain(globalSaved.map.landmarks));
  await choose("global-panel", "Hxz--"); await click("#fit-map");
  await evaluate(`document.getElementById("global-lookup").open = false;
    document.getElementById("show-terrain").closest("details").open = false;`);
  await frame();
  assert.equal(await text("editor-error"), "");
}

module.exports = { checkLayers };
