"use strict";

const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { documents } = require("./load-core.cjs");
const { createBrowserTools } = require("./browser-local-editor.cjs");

async function checkRelease(browser) {
  const { call, evaluate, profile, downloads, dialogResponses } = browser;
  const { text, value, waitFor, click, choose, key, go, frame, openFile, download } = await createBrowserTools(browser);
  const state = () => evaluate(`({
    name: document.getElementById("document-name").textContent,
    saved: document.getElementById("save-state").textContent,
    tile: document.getElementById("tile-info").textContent,
    terrain: document.getElementById("tile-terrain").value,
    undo: document.getElementById("undo").textContent,
    redo: document.getElementById("redo").textContent,
    pending: !document.getElementById("confirm-saved").hidden,
    source: document.getElementById("source-state").textContent
  })`);
  const idle = async () => {
    await waitFor(async () => !(await evaluate("document.getElementById('operation-dialog').open")), "operation closes");
    await frame();
    assert.equal(await evaluate("releaseWorkers.size"), 0);
    assert.equal(await evaluate("releaseWorkerUrls.size"), 0);
  };
  await evaluate(`(() => {
    window.releaseWorkers = new Set(); window.releaseWorkerUrls = new Set(); window.releaseWorkerStarts = 0;
    window.releaseNativeWorker = Worker; window.releaseCreateUrl = URL.createObjectURL; window.releaseRevokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = blob => {
      const url = releaseCreateUrl.call(URL, blob);
      if (blob.type === "text/javascript") releaseWorkerUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = url => { releaseWorkerUrls.delete(url); releaseRevokeUrl.call(URL, url); };
    window.releaseTrackedWorker = class extends Worker {
      constructor(url) { super(url); releaseWorkers.add(this); releaseWorkerStarts++; }
      terminate() { releaseWorkers.delete(this); super.terminate(); }
    };
    window.Worker = releaseTrackedWorker;
  })()`);
  await call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  try {
    const world = documents.create({ id: "release-global", name: "Release global", scale: "L",
      projection: { id: "equilateral-chamfered-cube", version: 1, columns: 24 } });
    const worldFile = path.join(profile, "release-global.hexmap");
    await writeFile(worldFile, documents.serialize(world));
    if ((await text("save-state")) !== "Unchanged") dialogResponses.push(true);
    await openFile(worldFile);
    await choose("tile-terrain", "forest");
    await click("#save-map");
    const baseline = await download(), originalState = await state();
    assert.equal(originalState.pending, true);
    assert.equal(originalState.saved, "Unsaved changes");

    // Let a real, expensive export run while the page continues to service timers and input.
    await click("#export-svg");
    const starts = await evaluate("releaseWorkerStarts"), downloadsBefore = downloads.size;
    await evaluate("document.getElementById('export-form').requestSubmit()");
    await waitFor(async () => (await evaluate("releaseWorkerStarts")) > starts, "SVG worker starts");
    const heartbeat = await evaluate(`new Promise(resolve => {
      let ticks = 0;
      const timer = setInterval(() => ticks++, 10);
      setTimeout(() => { clearInterval(timer); resolve({ ticks, busy: document.getElementById("operation-dialog").open }); }, 180);
    })`);
    assert.ok(heartbeat.busy, "Real export must still be running during the responsiveness check");
    assert.ok(heartbeat.ticks >= 5, JSON.stringify(heartbeat));
    const cancelStart = Date.now();
    await click("#cancel-operation");
    assert.ok(Date.now() - cancelStart < 2000, "Cancellation should not wait for export computation");
    await idle();
    assert.match(await text("editor-status"), /cancelled/);
    assert.deepEqual(await state(), originalState);
    assert.equal(await evaluate("document.getElementById('export-dialog').open"), true);
    await delay(150);
    assert.equal(downloads.size, downloadsBefore, "Cancelled SVG must not download later");
    await click("#cancel-export");

    // Cancellation before dispatch also covers the short startup interval.
    await evaluate("document.getElementById('save-map').click(); document.getElementById('cancel-operation').click()");
    await idle();
    assert.deepEqual(await state(), originalState);
    assert.equal(downloads.size, downloadsBefore);
    await evaluate(`document.getElementById("derive-scale").value = "XL";
      document.getElementById("derive-form").requestSubmit(); document.getElementById("cancel-operation").click();`);
    await idle();
    assert.deepEqual(await state(), originalState);

    // Terminate a real fill across a large connected global region.
    await choose("tool", "fill"); await choose("brush-terrain", "hills");
    await evaluate(`document.getElementById("goto-panel").value = "Hyz+-";
      document.getElementById("goto-column").value = "0"; document.getElementById("goto-row").value = "0";`);
    await click("#goto-form button");
    const beforeFill = await state(), fillStarts = await evaluate("releaseWorkerStarts");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor(async () => (await evaluate("releaseWorkerStarts")) > fillStarts, "fill worker starts");
    await key("Escape", "Escape", 27);
    await idle();
    assert.match(await text("editor-status"), /cancelled/);
    assert.deepEqual(await state(), beforeFill);

    // Native File input transfers bytes to the worker without parsing on the page.
    const longMap = documents.create({ id: "release-long", name: "Long path", kind: "local", scaleFamily: "regional",
      extent: { width: 1000000, height: 1000000, origin: [0, 0] } });
    const longPath = { id: "long-path", type: "road", points: Array.from({ length: 90000 }, (_, i) =>
      ({ panelId: "local", east: 10000 + i * .01, north: -1 })) };
    const longSource = documents.serialize(longMap).replace("[paths]\n", "[paths]\n" + JSON.stringify(longPath) + "\n");
    const longFile = path.join(profile, "release-long.hexmap");
    await writeFile(longFile, longSource);
    const root = await call("DOM.getDocument", { depth: 1 });
    const input = await call("DOM.querySelector", { nodeId: root.root.nodeId, selector: "#open-file" });
    const openStarts = await evaluate("releaseWorkerStarts");
    await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [longFile] });
    await waitFor(async () => (await evaluate("releaseWorkerStarts")) > openStarts, "import worker starts");
    await click("#cancel-operation");
    await idle();
    assert.deepEqual(await state(), beforeFill);
    assert.equal(downloads.size, downloadsBefore);

    // Startup and transfer errors leave the prior download confirmation and history intact.
    for (const [replacement, expected] of [
      ['class { constructor() { throw new Error("Injected startup failure"); } }', /Injected startup failure/],
      ['class extends releaseTrackedWorker { postMessage() { throw new Error("Injected transfer failure"); } }', /Injected transfer failure/]
    ]) {
      await evaluate(`window.Worker = ${replacement}`);
      await click("#save-map"); await idle();
      assert.match(await text("editor-error"), expected);
      assert.deepEqual(await state(), beforeFill);
      assert.equal(downloads.size, downloadsBefore);
      await evaluate("window.Worker = releaseTrackedWorker");
    }
    await click("#save-map");
    const retry = await download();
    assert.equal(retry.source, baseline.source);
    await click("#confirm-saved");
    assert.equal(await text("save-state"), "Unchanged");

    // Retry the large import, pan far beyond a trillion-tile origin, and preserve the long path on save.
    await openFile(longFile);
    assert.equal(await text("document-name"), "Long path");
    assert.equal(await text("editor-error"), "");
    await choose("tool", "inspect");
    const navigationStart = Date.now();
    await go(999999, 999999);
    assert.ok(Date.now() - navigationStart < 3000, "Sparse large-map navigation should remain viewport bounded");
    await choose("tile-terrain", "forest");
    await click("#save-map");
    const largeSaved = await download();
    assert.equal(largeSaved.map.paths[0].points.length, 90000);
    assert.equal(largeSaved.map.terrainAt("local", 999999, -1499998), "forest");
    await click("#confirm-saved");

    // Layer lists stay bounded, remain pageable/editable, and do not rebuild during terrain edits.
    const listMap = documents.create({ id: "release-lists", name: "Paged layers", kind: "local", scaleFamily: "regional",
      extent: { width: 1000000, height: 1000000, origin: [0, 0] } });
    for (let i = 0; i < 405; i++) {
      const id = String(i).padStart(4, "0");
      listMap.putPath({ id: "path-" + id, type: "road",
        points: [{ panelId: "local", east: 10000 + i, north: -1 }, { panelId: "local", east: 10000 + i + .1, north: -1 }] });
      listMap.putLabel({ id: "label-" + id, tile: { panelId: "local", q: 10000 + i, r: -5000 - Math.floor(i / 2) },
        text: "Label " + id, size: 12, rotation: 30, offset: [0, 0] });
    }
    const listFile = path.join(profile, "release-lists.hexmap");
    await writeFile(listFile, documents.serialize(listMap));
    await openFile(listFile);
    assert.equal(await evaluate("document.getElementById('path-record').options.length"), 201);
    assert.equal(await evaluate("document.getElementById('label-record').options.length"), 201);
    await evaluate(`window.releaseFirstOption = document.getElementById("label-record").options[1]`);
    await choose("tile-terrain", "hills");
    assert.equal(await evaluate("releaseFirstOption === document.getElementById('label-record').options[1]"), true);
    for (const kind of ["path", "label"]) {
      await click("#" + kind + "-page-next"); await click("#" + kind + "-page-next");
      assert.equal(await evaluate(`document.getElementById("${kind}-record").options.length`), 6);
      assert.equal(await text(kind + "-page-status"), "401-405 of 405");
    }
    await choose("label-record", "label-0404");
    await evaluate("document.getElementById('label-text').value = 'Edited last-page label'");
    await click("#label-apply");
    assert.equal(await value("label-record"), "label-0404");
    await click("#undo");
    assert.equal(await value("label-text"), "Label 0404");
    await click("#redo");
    assert.equal(await value("label-text"), "Edited last-page label");
    await click("#save-map");
    const pagedSaved = await download();
    assert.equal(pagedSaved.map.labels.at(-1).text, "Edited last-page label");
    assert.equal(pagedSaved.map.paths.length, 405);
    await click("#confirm-saved");
    await idle();
    assert.equal(await text("editor-error"), "");
    const denseMap = documents.create({ id: "release-dense", name: "Dense labels", kind: "local",
      extent: { width: 3, height: 3, origin: [0, 0] } });
    for (let i = 0; i < 5001; i++) denseMap.putLabel({ id: "dense-" + i, tile: { panelId: "local", q: 1, r: -1 },
      text: "X", size: 12, rotation: 0, offset: [0, 0] });
    const denseFile = path.join(profile, "release-dense.hexmap");
    await writeFile(denseFile, documents.serialize(denseMap));
    await openFile(denseFile);
    assert.match(await text("editor-error"), /5,000 symbols rendering limit/);
    if (!(await evaluate("document.querySelector('.visibility').open"))) await click(".visibility summary");
    await click("#show-labels");
    assert.equal(await text("editor-error"), "");
    await click("#save-map");
    assert.equal((await download()).map.labels.length, 5001);
    await click("#confirm-saved"); await idle();
  } finally {
    await call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evaluate(`window.Worker = releaseNativeWorker; URL.createObjectURL = releaseCreateUrl; URL.revokeObjectURL = releaseRevokeUrl;`);
  }
}

module.exports = { checkRelease };
