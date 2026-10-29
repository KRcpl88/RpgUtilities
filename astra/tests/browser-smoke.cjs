"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");
const { checkLocalEditor } = require("./browser-local-editor.cjs");
const { checkGlobalEditor } = require("./browser-global-editor.cjs");
const { checkLayers } = require("./browser-layers.cjs");
const { checkScales } = require("./browser-scales.cjs");
const { checkSvg } = require("./browser-svg.cjs");
const { checkRelease } = require("./browser-release.cjs");

async function main() {
  const executable = process.env.BROWSER_PATH ||
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
  const profile = await mkdtemp(path.join(tmpdir(), "global-map-geometry-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let launchError, stderr = "", socket, nextId = 0;
  child.on("error", failure => { launchError = failure; });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
  const pending = new Map(), downloads = new Map(), runtimeErrors = [], networkRequests = [], dialogResponses = [];
  function call(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: failure => { clearTimeout(timer); reject(failure); }
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    let active;
    const deadline = Date.now() + 20000;
    while (!active && Date.now() < deadline) {
      if (launchError) throw launchError;
      try { active = await readFile(path.join(profile, "DevToolsActivePort"), "utf8"); }
      catch (failure) { if (!["ENOENT", "EBUSY"].includes(failure.code)) throw failure; }
      if (!active) await delay(50);
    }
    assert.ok(active, `Browser did not start: ${stderr}`);
    const port = Number(active.split("\n")[0]);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    const page = pages.find(item => item.type === "page");
    assert.ok(page, "No browser page target.");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (request) {
          if (message.error) request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result);
        }
      } else if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails);
      else if (["Browser.downloadWillBegin", "Browser.downloadProgress"].includes(message.method)) {
        const event = message.params;
        downloads.set(event.guid, { ...downloads.get(event.guid), ...event });
      }
      else if (message.method === "Network.requestWillBeSent")
        networkRequests.push({ url: message.params.request.url, loaderId: message.params.loaderId });
      else if (message.method === "Page.javascriptDialogOpening") {
        const accept = dialogResponses.shift();
        if (accept === undefined) runtimeErrors.push(`Unexpected dialog: ${message.params.message}`);
        call("Page.handleJavaScriptDialog", { accept: accept ?? false }).catch(failure => runtimeErrors.push(failure.message));
      }
    });
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    const navigation = await call("Page.navigate", { url: pathToFileURL(path.join(__dirname, "..", "map-editor.html")).href });
    assert.ok(navigation.loaderId, "Application navigation must create a document loader.");
    const loadDeadline = Date.now() + 15000;
    while (Date.now() < loadDeadline) {
      if (await evaluate("document.getElementById('editor-status')?.textContent.startsWith('Ready.') ?? false")) break;
      await delay(50);
    }
    assert.match(await evaluate("document.getElementById('editor-status').textContent"), /^Ready\./);
    const browser = { call, evaluate, profile, dialogResponses, downloads };
    await checkLocalEditor(browser);
    await checkGlobalEditor(browser);
    await checkLayers(browser);
    await checkScales(browser);
    await checkSvg(browser);
    await checkRelease(browser);
    const stateExpression = `["document-name", "tile-info", "save-state"].map(id => document.getElementById(id).textContent)`;
    const editorState = await evaluate(stateExpression);
    await evaluate(`document.getElementById("view-mode").value = "geometry";
      document.getElementById("view-mode").dispatchEvent(new Event("change"));`);
    assert.equal(await evaluate("document.getElementById('error').textContent"), "");
    assert.match(await evaluate("document.getElementById('status').textContent"), /4489\.48/);
    assert.equal(await evaluate("document.getElementById('panel').options.length"), 19);
    const names = await evaluate("Object.keys(MapGeometry.SECTORS)");
    for (const faceId of names) {
      await evaluate(`document.getElementById('panel').value = ${JSON.stringify(faceId)};
        document.getElementById('preview-options').dispatchEvent(new Event('submit', { cancelable: true }));`);
      assert.equal(await evaluate("document.getElementById('error').textContent"), "", faceId);
    }
    await evaluate(`document.getElementById('panel').value = "Hyz+-";
      document.getElementById('preview-options').dispatchEvent(new Event('submit', { cancelable: true }));`);
    const click = await evaluate(`(() => {
      const world = MapGeometry.createWorld(), face = world.panels["Hyz+-"];
      const rect = document.getElementById("map").getBoundingClientRect();
      const xs = face.polygon.map(p => p[0]), ys = face.polygon.map(p => p[1]);
      const minX = Math.min(...xs) - world.spacing, maxX = Math.max(...xs) + world.spacing;
      const minY = Math.min(...ys) - world.spacing, maxY = Math.max(...ys) + world.spacing;
      const scale = Math.min((rect.width - 48) / (maxX - minX), (rect.height - 48) / (maxY - minY));
      const y = rect.top + 24 + maxY * scale;
      return {
        visible: { x: rect.left + 24 + (-world.width / 2 - world.spacing * .05 - minX) * scale, y },
        blank: { x: rect.left + 24 + (-world.width / 2 - world.spacing * .3 - minX) * scale, y }
      };
    })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...click.visible, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...click.visible, button: "left", clickCount: 1 });
    assert.match(await evaluate("document.getElementById('status').textContent"), /Geometric face: Beta; terrain owner: Alpha; tile \(0, 0\)/);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...click.blank, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...click.blank, button: "left", clickCount: 1 });
    assert.match(await evaluate("document.getElementById('status').textContent"), /Outside/);
    for (const columns of [3, 0, 98]) {
      await evaluate(`document.getElementById('columns').value = "${columns}";
        document.getElementById('preview-options').dispatchEvent(new Event('submit', { cancelable: true }));`);
      assert.ok(await evaluate("document.getElementById('error').textContent.length > 0"));
    }
    await evaluate(`document.getElementById('columns').value = "24";
      document.getElementById('panel').value = "";
      document.getElementById('preview-options').dispatchEvent(new Event('submit', { cancelable: true }));`);
    assert.equal(await evaluate("document.getElementById('error').textContent"), "");
    assert.ok(await evaluate(`(() => {
      const canvas = document.getElementById("map");
      return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some(value => value !== 0);
    })()`));
    const fixtures = await Promise.all(["local", "global"].map(async name => ({
      name, source: await readFile(path.join(__dirname, "fixtures", `${name}.hexmap`), "utf8")
    })));
    const persistence = await evaluate(`(async () => {
      const fixtures = ${JSON.stringify(fixtures)}, output = [];
      for (const fixture of fixtures) {
        const file = new File([fixture.source], fixture.name + ".hexmap", { type: "text/plain" });
        const loaded = MapDocuments.parse(await file.text());
        const saved = new Blob([MapDocuments.serialize(loaded)], { type: "text/plain;charset=us-ascii" });
        output.push({ name: fixture.name, source: await saved.text(), label: loaded.labels[0].text });
      }
      let active = MapDocuments.parse(fixtures[0].source), original = active, error = "";
      try { active = MapDocuments.parse(fixtures[0].source.replace('"size":12', '"size":0')); }
      catch (failure) { error = failure.message; }
      return { output, error, unchanged: active === original && MapDocuments.serialize(active) === fixtures[0].source };
    })()`);
    assert.deepEqual(persistence.output.map(item => ({ name: item.name, source: item.source })), fixtures);
    assert.ok(persistence.output.every(item => item.label === "Caf\u00e9 \u03b1 \ud83c\udff0"));
    assert.match(persistence.error, /Line \d+: Label size must be positive/);
    assert.equal(persistence.unchanged, true);
    assert.deepEqual(runtimeErrors, []);
    const applicationRequests = networkRequests.filter(request => request.loaderId === navigation.loaderId).map(request => request.url);
    assert.ok(applicationRequests.length > 0);
    assert.ok(applicationRequests.every(url => url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:null/")), JSON.stringify(applicationRequests));
    assert.deepEqual(dialogResponses, []);
    await evaluate(`document.getElementById("view-mode").value = "local";
      document.getElementById("view-mode").dispatchEvent(new Event("change"));`);
    assert.deepEqual(await evaluate(stateExpression), editorState);
    if (process.argv[2]) {
      await evaluate(`(() => {
        const gallery = document.createElement("section");
        gallery.style.cssText = "position:fixed;inset:0;z-index:100;background:white;padding:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;overflow:auto";
        for (const terrain of MapDocuments.TERRAINS) {
          const map = MapDocuments.create({ id: terrain.id, kind: "local", extent: { width: 5, height: 5, origin: [0, 0] }, defaultTerrain: "water" });
          for (let q = 1; q < 4; q++) for (let row = 1; row < 4; row++) map.setTerrain("local", q, -row - Math.floor(q / 2), terrain.id);
          const card = document.createElement("div"), heading = document.createElement("strong");
          heading.textContent = terrain.name; card.append(heading);
          const svg = new DOMParser().parseFromString(MapSvgExport.render(map), "image/svg+xml").documentElement;
          svg.style.cssText = "display:block;width:100%;height:190px";
          card.append(document.importNode(svg, true)); gallery.append(card);
        }
        document.body.append(gallery);
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      const screenshot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(path.resolve(process.argv[2]), Buffer.from(screenshot.data, "base64"));
    }
    console.log("Browser smoke passed: editing, seams, layers, conversion, anchors, SVG, background operations, responsive cancellation, failure recovery, large maps, paged layers, offline operation, and geometry/persistence.");
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      try { await call("Browser.close"); }
      catch (failure) { if (child.exitCode === null) console.error(`Browser close failed: ${failure.message}`); }
      socket.close();
    }
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && !launchError && Date.now() < deadline) await delay(50);
    if (child.exitCode === null && child.pid) child.kill();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch(failure => {
  console.error(failure);
  process.exitCode = 1;
});
