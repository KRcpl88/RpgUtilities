'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Coordinates: coordinates, Model: model, View: view, SvgExport: svgExport } = loadModules();

test('equator segments lie on zero latitude and polar markers lie at true north/south', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  let equators = 0, north = 0, south = 0;
  for (const panelId of doc.topo.panelIds) {
    const reference = view.referenceGeometry(doc, panelId);
    const frame = projection.build().frames[panelId];
    if (frame.isEquatorial) {
      assert.equal(reference.equator.length, 2);
      equators++;
    } else {
      assert.equal(reference.equator.length, 0);
    }
    for (const point of reference.equator) {
      const trueLocation = coordinates.trueCoordinates(coordinates.makeLocation(panelId,
        point[0] * doc.topo.milesPerEdge, point[1] * doc.topo.milesPerEdge), doc.topo.milesPerEdge);
      assert.ok(Math.abs(trueLocation.latitude) < 1e-8);
      assert.ok(util.pointInConvex(point, frame.polygon));
    }
    for (const pole of reference.poles) {
      const trueLocation = coordinates.trueCoordinates(coordinates.makeLocation(panelId,
        pole.point[0] * doc.topo.milesPerEdge, pole.point[1] * doc.topo.milesPerEdge), doc.topo.milesPerEdge);
      assert.ok(Math.abs(trueLocation.latitude - (pole.label === 'N' ? 90 : -90)) < 1e-6);
      assert.ok(util.pointInConvex(pole.point, frame.polygon));
      if (pole.label === 'N') north++;
      else south++;
    }
  }
  assert.equal(equators, 6);
  assert.equal(north, 3);
  assert.equal(south, 3);
});

test('reference layer exports red equators and labeled crosshair circles and can be disabled', () => {
  for (const [name, reference] of [['Beta', 'equator'], ['Eta', 'pole-N'], ['Kappa', 'pole-S']]) {
    const doc = model.createPanelMap({ panelId: coordinates.panelIdByName(name), panelHexes: 4 });
    const svg = svgExport.write(doc);
    assert.match(svg, /id="layer-reference"[^>]+stroke="#d32f2f"/);
    assert.ok(svg.includes(`data-reference="${reference}"`));
    if (reference !== 'equator') {
      assert.match(svg, /<circle[^>]+r="/);
      assert.ok(svg.includes(`>${reference.slice(-1)}</text>`));
      assert.match(svg, /<path d="M[^"]+h[^"]+M[^"]+v/);
      const size = svgExport.dimensions(doc);
      const withoutReferences = svgExport.dimensions(doc, doc.global.panelId, 1600, false);
      assert.ok(size.spanHeight > withoutReferences.spanHeight, 'polar symbols have space beyond the panel vertex');
      const match = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/.exec(svg);
      const [x, y, radius] = match.slice(1).map(Number);
      assert.ok(x - radius * 1.4 >= 0 && x + radius * 1.4 <= size.spanWidth);
      assert.ok(y - radius * 1.4 >= 0 && y + radius * 1.4 <= size.spanHeight);
    }
    assert.doesNotMatch(svgExport.write(doc, { layers: { reference: false } }), /layer-reference|data-reference=/);
  }
});

test('local reference geometry uses the anchor frame and local hex units', () => {
  for (const systemName of ['regional', 'local']) {
    const doc = model.createLocalMap({ width: 7, height: 6, systemName, scaleName: 'XL', panelHexes: 4,
      anchor: coordinates.parseUniversal('Beta 0E 0N') });
    const reference = view.referenceGeometry(doc, 'local');
    assert.equal(reference.equator.length, 2);
    for (const point of reference.equator) {
      assert.ok(Math.abs(doc.local.anchor.north + point[1] * doc.local.hexMiles) < 1e-8);
    }
    assert.match(svgExport.write(doc), /data-reference="equator"/);
    assert.equal(reference.poles.length, 0);
  }
});
