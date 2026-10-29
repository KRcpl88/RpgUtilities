"use strict";

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { geometry: g, documents: d, globalEditor: e } = require("./load-core.cjs");
const { createBrowserTools } = require("./browser-local-editor.cjs");

async function checkGlobalEditor(browser) {
  const { call, evaluate, profile, dialogResponses } = browser;
  const { text, value, frame, center, mouse, click, choose, key, go, openFile, download } =
    await createBrowserTools(browser);
  const template = d.create({ id: "browser-reference", projection: { id: "equilateral-chamfered-cube", version: 1, columns: 2 } });
  const world = e.world(template), face = world.strip[0], west = world.strip[5];
  const seed = e.locate(template, face, [-world.width / 2, 0]).tile;
  const across = e.hitTest(template, face, [-world.width / 2 - world.spacing * .6, 0]).tile;
  async function coordinate(faceId, east, north) {
    await evaluate("document.getElementById('global-lookup').open = true;");
    await choose("coordinate-panel", faceId);
    await evaluate(`document.getElementById("coordinate-east").value = ${east};
      document.getElementById("coordinate-north").value = ${north};`);
    await click("#panel-coordinate-form button");
  }
  async function goTile(tile) {
    await choose("goto-panel", tile.panelId);
    return go(tile.q, tile.r);
  }
  await click("#new-global");
  assert.equal(await value("new-family"), "regional");
  assert.equal(await value("new-scale"), "XL");
  await evaluate("document.getElementById('new-world-columns').value = '3';");
  await click("#create-map");
  assert.equal(await evaluate("document.getElementById('new-world-columns').checkValidity()"), false);
  assert.equal(await text("document-name"), "Local example");
  await evaluate(`document.getElementById("new-world-columns").value = "2";
    document.getElementById("new-name").value = "World workflow";`);
  dialogResponses.push(true);
  await click("#create-map");
  assert.equal(await text("document-name"), "World workflow");
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.match(await text("map-properties"), /Global: 2 XL columns/);
  assert.equal(await evaluate("document.getElementById('global-panel').options.length"), 18);
  await choose("tool", "fill"); await choose("brush-terrain", "hills");
  await click("#local-map");
  assert.equal(await value("tile-terrain"), "hills");
  await click("#undo");
  assert.equal(await value("tile-terrain"), "water");
  await choose("tool", "brush");
  for (const faceId of Object.keys(world.panels)) {
    await choose("global-panel", faceId); await frame();
    assert.equal(await text("editor-error"), "", faceId);
    assert.match(await text("tile-info"), new RegExp(`Geometric face: ${world.panels[faceId].name}`));
  }

  await coordinate(face, -world.width / 2, 0);
  await choose("brush-terrain", "forest"); await choose("brush-radius", "1");
  await click("#local-map");
  assert.equal(await value("tile-terrain"), "forest");
  await key("z", "KeyZ", 90, 2);
  assert.equal(await value("tile-terrain"), "water");
  await key("Z", "KeyZ", 90, 10);
  assert.equal(await value("tile-terrain"), "forest");
  await choose("brush-radius", "0"); await choose("brush-terrain", "desert");
  const point = await center("#local-map"), pixels = parseInt(await text("zoom-level"), 10) / 100 * 32;
  await mouse("mousePressed", point);
  await mouse("mouseMoved", { x: point.x - pixels * .6, y: point.y }, { buttons: 1 });
  await mouse("mouseReleased", { x: point.x - pixels * .6, y: point.y });
  assert.equal(await value("goto-panel"), west);
  assert.equal(await value("tile-terrain"), "desert");
  await key("z", "KeyZ", 90, 2);
  assert.equal(await value("tile-terrain"), "forest");
  await key("y", "KeyY", 89, 2);
  assert.equal(await value("tile-terrain"), "desert");

  const partial = { panelId: "Sz-", q: -1, r: 0 };
  await goTile(partial);
  assert.match(await text("tile-info"), /Owner: Nu \(-1, 0\)/);
  await choose("tile-terrain", "lakes");
  const neighbors = e.neighbors(template, partial), index = neighbors.findIndex(t => t.panelId !== partial.panelId);
  assert.ok(index >= 0);
  await evaluate("document.getElementById('neighbor-navigation').open = true;");
  await choose("tile-neighbors", String(index));
  await click("#goto-neighbor");
  assert.equal(await value("goto-panel"), neighbors[index].panelId);
  assert.equal(await text("undo"), "Undo Set terrain");

  await evaluate(`document.getElementById("global-lookup").open = true;
    document.getElementById("latitude").value = "23.5"; document.getElementById("longitude").value = "-45";`);
  await click("#latlon-form button");
  const expectedLocation = g.fromLatLon(world, 23.5, -45);
  const expected = g.locateTile(world, expectedLocation.faceId, expectedLocation.point);
  assert.equal(await value("goto-panel"), expected.panelId);
  assert.equal(Number(await value("goto-column")), expected.q);
  assert.equal(Number(await value("goto-row")), expected.r);
  assert.match(await text("tile-info"), /Latitude 23\.500000, longitude -45\.000000/);
  await evaluate("document.getElementById('latitude').value = '90';");
  await click("#latlon-form button");
  assert.match(await text("tile-info"), /longitude undefined at pole/);
  const selectedAtPole = await text("tile-info");
  await coordinate("Hyz+-", 1e12, 0);
  assert.match(await text("editor-error"), /outside the geometric panel/);
  assert.equal(await text("tile-info"), selectedAtPole);

  await click("#world-overview");
  assert.equal(await text("zoom-level"), "Overview");
  assert.equal(await evaluate("document.getElementById('tool').disabled"), true);
  await center("#local-map");
  const overviewPoint = await evaluate(`(() => {
    const world = MapGeometry.createWorld({ columns: 2 }), canvas = document.getElementById("local-map");
    const points = Object.values(world.panels).flatMap(face => face.polygon.map(p =>
      MapGeometry.panelToNet(world, face.id, p).map(v => v * world.unitMiles)));
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const scale = Math.min((canvas.clientWidth - 48) / (maxX - minX), (canvas.clientHeight - 48) / (maxY - minY));
    const p = MapGeometry.panelToNet(world, "Sy+", [0, 0]).map(v => v * world.unitMiles), rect = canvas.getBoundingClientRect();
    return { x: rect.left + canvas.clientLeft + canvas.clientWidth / 2 + (p[0] - (minX + maxX) / 2) * scale,
      y: rect.top + canvas.clientTop + canvas.clientHeight / 2 - (p[1] - (minY + maxY) / 2) * scale };
  })()`);
  await mouse("mousePressed", overviewPoint); await mouse("mouseReleased", overviewPoint); await frame();
  assert.equal(await value("global-panel"), "Sy+");
  assert.notEqual(await text("zoom-level"), "Overview");
  assert.equal(await text("undo"), "Undo Set terrain");
  assert.equal(await text("editor-error"), "");

  await click("#save-map");
  const first = await download();
  assert.equal(first.map.metadata.kind, "global");
  assert.equal(first.map.metadata.scale, "XL");
  assert.equal(first.map.metadata.projection.columns, 2);
  assert.equal(first.map.terrainAt(seed.panelId, seed.q, seed.r), "desert");
  assert.equal(first.map.terrainAt(across.panelId, across.q, across.r), "desert");
  assert.equal(first.map.terrainAt(partial.panelId, partial.q, partial.r), "lakes");
  const brushed = e.neighbors(template, seed).filter(t =>
    !(t.panelId === across.panelId && t.q === across.q && t.r === across.r));
  for (const tile of brushed) assert.equal(first.map.terrainAt(tile.panelId, tile.q, tile.r), "forest");
  await click("#confirm-saved");
  assert.equal(await text("save-state"), "Unchanged");
  await openFile(first.filename);
  assert.equal(await text("document-name"), "World workflow");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await goTile(seed);
  await key("e", "KeyE", 69); await key("Enter", "Enter", 13);
  assert.equal(await value("tile-terrain"), "water");
  await click("#save-map");
  const continued = await download();
  assert.equal(continued.map.metadata.id, first.map.metadata.id);
  assert.equal(continued.map.terrainAt(seed.panelId, seed.q, seed.r), "water");
  assert.equal(continued.map.terrainAt(across.panelId, across.q, across.r), "desert");

  dialogResponses.push(true);
  await openFile(path.join(__dirname, "fixtures", "global.hexmap"));
  assert.equal(await text("document-name"), "Global example");
  assert.match(await text("map-properties"), /1 paths, 1 landmarks, 1 labels/);
  await goTile({ panelId: "Hyz+-", q: 0, r: 0 });
  assert.equal(await value("tile-terrain"), "islands");
  await choose("tile-terrain", "badlands");
  await click("#save-map");
  const layered = await download();
  const original = d.parse(await readFile(path.join(__dirname, "fixtures", "global.hexmap"), "utf8"));
  for (const name of ["paths", "landmarks", "labels", "metadata"])
    assert.equal(JSON.stringify(layered.map[name]), JSON.stringify(original[name]), `Preserved global ${name}`);
  assert.equal(layered.map.terrainAt("Hyz+-", 0, 0), "badlands");
  await click("#confirm-saved");
  await openFile(path.join(__dirname, "fixtures", "local.hexmap"));
  assert.equal(await text("document-name"), "Local example");
  assert.equal(await evaluate("document.getElementById('global-navigation').hidden"), true);
  assert.equal(await value("tile-terrain"), "water");
  await click("#new-global");
  await evaluate(`document.getElementById("new-world-columns").value = "24";
    document.getElementById("new-name").value = "Fine world";`);
  await choose("new-scale", "S");
  await click("#create-map");
  const fine = d.create({ id: "fine-reference", scale: "S" }), fineWorld = e.world(fine);
  await coordinate("Hyz+-", -fineWorld.width / 2, 0);
  await choose("tool", "brush"); await choose("brush-terrain", "forest"); await choose("brush-radius", "1");
  await click("#local-map");
  assert.equal(await value("tile-terrain"), "forest");
  assert.equal(await text("editor-error"), "");
  await click("#save-map");
  const fineSaved = await download();
  assert.equal(fineSaved.map.metadata.scale, "S");
  assert.equal(fineSaved.map.metadata.projection.columns, 24);
  const fineSeed = e.locate(fine, "Hyz+-", [-fineWorld.width / 2, 0]).tile;
  for (const tile of [fineSeed, ...e.neighbors(fine, fineSeed)])
    assert.equal(fineSaved.map.terrainAt(tile.panelId, tile.q, tile.r), "forest");
  await click("#confirm-saved");
  await openFile(layered.filename);
  await goTile({ panelId: "Hyz+-", q: 0, r: 0 });
  assert.equal(await value("tile-terrain"), "badlands");
  await choose("tile-terrain", "forest");
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.equal(await text("editor-error"), "");
  await evaluate(`document.getElementById("global-lookup").open = false;
    document.getElementById("neighbor-navigation").open = false;`);
  await click("#fit-map");
}

module.exports = { checkGlobalEditor };
