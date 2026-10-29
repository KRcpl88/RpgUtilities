"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, readFile, readdir, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { documents } = require("./load-core.cjs");

async function createBrowserTools({ call, evaluate, profile, downloads }) {
  const downloadDirectory = await mkdtemp(path.join(profile, "downloads-"));
  const consumed = new Set(downloads.keys());
  await call("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: downloadDirectory, eventsEnabled: true });
  let downloadCount = 0;
  const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const value = id => evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
  async function waitFor(action, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = await action();
      if (result) return result;
      await delay(40);
    }
    const files = await Promise.all((await readdir(downloadDirectory)).map(async name => {
      const source = await readFile(path.join(downloadDirectory, name), "utf8");
      return { name, size: source.length, tail: source.slice(-30) };
    }));
    const active = [...downloads.values()].filter(item => !consumed.has(item.guid));
    throw new Error(`Timed out: ${description}; status=${await text("editor-status")}; error=${await text("editor-error")}; downloads=${JSON.stringify(files)}; events=${JSON.stringify(active)}`);
  }
  async function frame() {
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await waitFor(async () => await evaluate("document.getElementById('local-map').getAttribute('aria-busy') !== 'true'"), "background operation");
  }
  async function center(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      let box = element.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) element.scrollIntoView({ block: "center" });
      box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
  }
  async function mouse(type, point, extras = {}) {
    await call("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1, ...extras });
  }
  async function click(selector) {
    const point = await center(selector);
    await mouse("mousePressed", point);
    await mouse("mouseReleased", point);
    await frame();
  }
  async function choose(id, selected) {
    await evaluate(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(selected)};
      document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event("change", { bubbles: true }));`);
  }
  async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
    await frame();
  }
  async function go(column, row) {
    await evaluate(`document.getElementById("goto-column").value = ${column};
      document.getElementById("goto-row").value = ${row};`);
    await click("#goto-form button");
    return center("#local-map");
  }
  async function openFile(filename) {
    const root = await call("DOM.getDocument", { depth: 1 });
    const input = await call("DOM.querySelector", { nodeId: root.root.nodeId, selector: "#open-file" });
    await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [filename] });
    await waitFor(async () => !(await evaluate("document.getElementById('open-map').disabled")), "file import completion");
    await frame();
  }
  async function download(format = "hexmap") {
    assert.ok(["hexmap", "svg"].includes(format));
    return waitFor(async () => {
      for (const item of downloads.values()) {
        if (consumed.has(item.guid) || !item.suggestedFilename?.startsWith("map-") || !item.suggestedFilename.endsWith("." + format)) continue;
        assert.notEqual(item.state, "canceled", `Browser canceled ${item.suggestedFilename}`);
        if (item.state !== "completed") continue;
        const filename = path.join(downloadDirectory, item.guid);
        let source;
        try { source = await readFile(filename, "utf8"); }
        catch (failure) { if (["ENOENT", "EBUSY"].includes(failure.code)) continue; throw failure; }
        assert.ok(source.endsWith(format === "svg" ? "</svg>\n" : "[end]\n"), `Completed download is truncated: ${item.suggestedFilename}`);
        assert.equal(Buffer.byteLength(source, "utf8"), item.receivedBytes);
        const retained = path.join(downloadDirectory, `saved-${++downloadCount}.${format}`);
        await rename(filename, retained);
        consumed.add(item.guid);
        return { filename: retained, source, ...(format === "hexmap" ? { map: documents.parse(source) } : {}) };
      }
      return null;
    }, "native browser download");
  }
  return { text, value, waitFor, frame, center, mouse, click, choose, key, go, openFile, download };
}

async function checkLocalEditor(browser) {
  const { call, evaluate, profile, dialogResponses } = browser;
  const { text, value, waitFor, center, mouse, click, choose, key, go, openFile, download } =
    await createBrowserTools(browser);
  assert.equal(await text("editor-error"), "");
  await click("#new-map");
  await evaluate("document.getElementById('new-name').value = ' ';");
  await click("#create-map");
  assert.match(await text("new-error"), /Map name/);
  await evaluate(`document.getElementById("new-name").value = "Workflow map";
    document.getElementById("new-width").value = "8"; document.getElementById("new-height").value = "6";
    document.getElementById("new-east").value = "-2"; document.getElementById("new-north").value = "3";`);
  await choose("new-family", "regional");
  await choose("new-scale", "M");
  await click("#create-map");
  assert.equal(await evaluate("document.getElementById('new-map-dialog').open"), false);
  assert.equal(await text("document-name"), "Workflow map");
  assert.equal(await text("save-state"), "Unsaved changes");
  assert.match(await text("map-properties"), /regional M; spacing 6 miles/);

  let point = await go(1, 1);
  const cellPixels = parseInt(await text("zoom-level"), 10) / 100 * 32;
  await mouse("mousePressed", point);
  await mouse("mouseMoved", { x: point.x, y: point.y + 2 * cellPixels }, { buttons: 1 });
  await mouse("mouseReleased", { x: point.x, y: point.y + 2 * cellPixels });
  assert.match(await text("tile-info"), /^\(1, -3\)/);
  assert.equal(await value("tile-terrain"), "forest");
  await key("z", "KeyZ", 90, 2);
  assert.equal(await value("tile-terrain"), "plain");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  await key("Z", "KeyZ", 90, 10);
  assert.equal(await value("tile-terrain"), "forest");

  await choose("brush-terrain", "water");
  point = await go(2, 1);
  await mouse("mousePressed", point);
  assert.equal(await value("tile-terrain"), "water");
  await key("Escape", "Escape", 27);
  await mouse("mouseReleased", point);
  assert.equal(await value("tile-terrain"), "plain");
  assert.equal(await text("undo"), "Undo Paint");

  await evaluate(`document.getElementById("local-map").addEventListener("pointerdown",
    event => { globalThis.testPointerId = event.pointerId; }, { once: true });`);
  await mouse("mousePressed", point);
  await mouse("mouseMoved", { x: point.x + 1, y: point.y }, { buttons: 1 });
  await evaluate(`document.getElementById("local-map").dispatchEvent(
    new PointerEvent("pointercancel", { pointerId: globalThis.testPointerId + 1 }));`);
  assert.equal(await value("tile-terrain"), "water");
  await evaluate("document.getElementById('local-map').releasePointerCapture(globalThis.testPointerId);");
  await mouse("mouseMoved", { x: point.x + 2, y: point.y }, { buttons: 1 });
  await mouse("mouseReleased", point);
  assert.equal(await value("tile-terrain"), "plain");
  assert.equal(await text("undo"), "Undo Paint");
  await evaluate("delete globalThis.testPointerId;");

  await choose("tool", "fill");
  await go(0, 0); await click("#local-map");
  assert.equal(await value("tile-terrain"), "water");
  await click("#undo");
  assert.equal(await value("tile-terrain"), "plain");
  await click("#redo");
  assert.equal(await value("tile-terrain"), "water");
  await choose("tool", "erase");
  await go(1, 2); await click("#local-map");
  assert.equal(await value("tile-terrain"), "plain");
  await choose("tile-terrain", "hills");
  assert.equal(await value("tile-terrain"), "hills");

  const oldZoom = await text("zoom-level");
  point = await center("#local-map");
  await call("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -240 });
  await waitFor(async () => (await text("zoom-level")) !== oldZoom, "wheel zoom");
  assert.ok(parseInt(await text("zoom-level"), 10) > parseInt(oldZoom, 10));
  await choose("tool", "pan");
  await mouse("mousePressed", point);
  await mouse("mouseMoved", { x: point.x + 40, y: point.y + 20 }, { buttons: 1 });
  await mouse("mouseReleased", { x: point.x + 40, y: point.y + 20 });
  assert.equal(await text("undo"), "Undo Set terrain");
  await choose("brush-terrain", "canyon");
  await go(6, 4);
  await key("b", "KeyB", 66);
  await key("ArrowRight", "ArrowRight", 39);
  await key(" ", "Space", 32);
  assert.match(await text("tile-info"), /^\(7, -7\)/);
  assert.equal(await value("tile-terrain"), "canyon");
  await key("s", "KeyS", 83, 2);
  const first = await download();
  assert.equal(first.map.metadata.scale, "M");
  assert.equal(first.map.metadata.scaleFamily, "regional");
  assert.deepEqual(JSON.parse(JSON.stringify(first.map.metadata.extent)), { width: 8, height: 6, origin: [-2, 3] });
  assert.equal(first.map.terrainAt("local", 1, -1), "forest");
  assert.equal(first.map.terrainAt("local", 1, -2), "hills");
  assert.equal(first.map.terrainAt("local", 1, -3), "forest");
  assert.equal(first.map.terrainAt("local", 0, 0), "water");
  assert.equal(first.map.terrainAt("local", 7, -7), "canyon");
  assert.equal(await text("save-state"), "Unsaved changes");

  await go(0, 0); await choose("tile-terrain", "desert");
  await click("#confirm-saved");
  assert.equal(await text("save-state"), "Unsaved changes");
  await click("#undo");
  assert.equal(await text("save-state"), "Unchanged");
  await openFile(first.filename);
  assert.equal(await text("editor-error"), "");
  assert.equal(await text("document-name"), "Workflow map");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), true);
  assert.equal(await value("tile-terrain"), "water");
  await choose("tile-terrain", "badlands");
  await click("#save-map");
  const second = await download();
  assert.equal(second.map.metadata.id, first.map.metadata.id);
  assert.equal(second.map.terrainAt("local", 0, 0), "badlands");
  assert.equal(second.map.terrainAt("local", 1, -3), "forest");

  const invalid = path.join(profile, "invalid.hexmap");
  await writeFile(invalid, first.source.replace("FANTASY-MAP 1", "FANTASY-MAP 999"));
  await openFile(invalid);
  assert.match(await text("editor-error"), /Line 1: Unsupported format/);
  assert.equal(await value("tile-terrain"), "badlands");
  assert.equal(await evaluate("document.getElementById('undo').disabled"), false);
  dialogResponses.push(false);
  await openFile(path.join(__dirname, "fixtures", "local.hexmap"));
  assert.match(await text("editor-status"), /Open cancelled/);
  assert.equal(await text("document-name"), "Workflow map");
  assert.equal(await value("tile-terrain"), "badlands");
  const invalidGlobal = path.join(profile, "invalid-global.hexmap");
  await writeFile(invalidGlobal, (await readFile(path.join(__dirname, "fixtures", "global.hexmap"), "utf8"))
    .replace('"version":1', '"version":999'));
  await openFile(invalidGlobal);
  assert.match(await text("editor-error"), /Unsupported projection/);
  assert.equal(await text("document-name"), "Workflow map");
  dialogResponses.push(true);
  await openFile(path.join(__dirname, "fixtures", "local.hexmap"));
  assert.equal(await text("document-name"), "Local example");
  assert.match(await text("map-properties"), /1 paths, 1 landmarks, 1 labels/);
  await choose("tile-terrain", "forest");
  await click("#save-map");
  const layered = await download();
  const original = documents.parse(await readFile(path.join(__dirname, "fixtures", "local.hexmap"), "utf8"));
  for (const name of ["paths", "landmarks", "labels", "metadata"])
    assert.equal(JSON.stringify(layered.map[name]), JSON.stringify(original[name]), `Preserved ${name}`);
  assert.equal(layered.map.terrainAt("local", 0, 0), "forest");

  await click("#new-map");
  await evaluate("document.getElementById('new-name').value = 'Cancelled replacement';");
  dialogResponses.push(false);
  await click("#create-map");
  assert.equal(await evaluate("document.getElementById('new-map-dialog').open"), true);
  assert.equal(await text("document-name"), "Local example");
  await evaluate("document.getElementById('new-name').focus();");
  await key("z", "KeyZ", 90, 2);
  assert.equal(await value("tile-terrain"), "forest");
  await key("Escape", "Escape", 27);
  assert.equal(await evaluate("document.getElementById('new-map-dialog').open"), false);
  assert.equal(await text("editor-error"), "");
  assert.equal(await value("tile-terrain"), "forest");
  dialogResponses.push(false);
  await call("Page.navigate", { url: "about:blank" });
  assert.equal(await evaluate("location.protocol"), "file:");
  assert.equal(await text("document-name"), "Local example");
  assert.equal(await value("tile-terrain"), "forest");
}

module.exports = { checkLocalEditor, createBrowserTools };
