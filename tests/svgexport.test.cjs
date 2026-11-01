'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { loadModules } = require('./_load.cjs');
const { Util: util, Projection: projection, Lattice: lattice, Coordinates: coordinates, Model: model, Terrain: terrain, View: view, Regions: regions, FileFormat: fileFormat, SvgExport: svgExport } = loadModules();

function localMap(systemName = 'regional', scaleName = 'M') {
  const doc = model.createLocalMap({
    width: 9, height: 8, systemName, scaleName, name: 'A & B <Map> "quoted"',
    anchor: coordinates.parseUniversal('Eta 123.456789E 98.765432N'),
  });
  model.setTerrain(doc, 40, 4);
  for (const type of ['road', 'trail', 'river']) {
    model.addOverlay(doc, { type, tileIndices: [20, 21, 22, 23] });
  }
  model.setLandmark(doc, 40, { type: 'castle', name: 'Keep & <town>' });
  model.addLabel(doc, { tileIndex: 40, text: 'A & <B> "quoted" \u03b1 \ud83c\udff0', category: 'region', rotation: 32, dx: 5, dy: -12 });
  return doc;
}

test('SVG exports are deterministic and leave terrain, features and revision unchanged', () => {
  const doc = localMap(), before = fileFormat.write(doc), revision = doc.revision;
  const options = { width: 1200, layers: { grid: true, landmarkNames: true } };
  const first = svgExport.write(doc, options);
  assert.equal(svgExport.write(doc, options), first);
  assert.equal(fileFormat.write(doc), before);
  assert.equal(doc.revision, revision);
  assert.match(first, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200"/);
  assert.match(first, /fill-rule="evenodd"/);
  assert.match(first, /clip-path="url\(#map-clip\)"/);
  assert.match(first, /<symbol id="landmark-castle"/);
  assert.match(first, /<use href="#landmark-castle"/);
  assert.match(first, /paint-order="stroke"/);
  assert.doesNotMatch(first, /(?:NaN|Infinity|undefined)/);
});

function shoreMap(shape) {
  const doc = model.createLocalMap({ width: 13, height: 12, systemName: 'local', scaleName: 'M',
    anchor: coordinates.parseUniversal('Eta 0E 0N') });
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    const [columnIndex, rowIndex] = model.localTileXY(doc, tileIndex);
    const distance = Math.max(Math.abs(columnIndex - 6), Math.abs(rowIndex - 5));
    const land = shape === 'island' ? distance < 3
      : shape === 'lake' ? distance >= 2
        : shape === 'ring' ? distance >= 2 && distance <= 3
          : shape === 'channel' ? columnIndex !== 6 : columnIndex > 5;
    model.setTerrain(doc, tileIndex, land ? 4 + rowIndex % 13 : rowIndex % 4);
  }
  return doc;
}

test('SVG shorelines interpolate displaced edge midpoints only, with smooth joins and no corner constraints', () => {
  let landward = false, waterward = false;
  let maxOffset = 0;
  for (const shape of ['island', 'lake', 'ring', 'channel', 'coast']) {
    const doc = shoreMap(shape), data = regions.build(doc), before = fileFormat.write(doc);
    const shore = svgExport.buildShorelines(data);
    for (const path of data.shorelines) {
      const spline = shore.paths.get(path), edgeCount = path.points.length - 1;
      assert.equal(spline.length, edgeCount + (path.isClosed ? 0 : 1), 'one segment between successive midpoints, plus open end caps');
      for (let index = 0; index + 1 < path.points.length; index++) {
        const a = path.points[index], b = path.points[index + 1];
        const curves = shore.edges.get(a).get(b);
        assert.equal(curves.length, 2, 'fill pieces meet at the edge midpoint sample');
        assert.deepEqual(curves[0][3], curves[1][0]);
        assert.deepEqual(curves[0][0], shore.vertices.get(a));
        assert.deepEqual(curves[1][3], shore.vertices.get(b));
        assert.deepEqual(shore.edges.get(b).get(a), curves.map((curve) => [...curve].reverse()).reverse());
        const tangent = util.unit(util.subtract(b, a)), normal = [-tangent[1], tangent[0]];
        const delta = util.subtract(curves[0][3], util.scale(util.add(a, b), 0.5));
        const offset = util.dot(delta, normal);
        maxOffset = Math.max(maxOffset, Math.abs(offset));
        landward ||= offset > 0.01;
        waterward ||= offset < -0.01;
        assert.ok(Math.abs(util.dot(delta, tangent)) < 1e-10, 'the sample moves only along the centre-to-face ray');
        assert.ok(Math.abs(offset) <= 0.30 * 2 / Math.sqrt(3) + 1e-10, 'midpoint displacement is bounded by 30% of hex width');
        assert.deepEqual(spline[path.isClosed ? index : index + 1][0], curves[0][3]);
        const next = index + 2 < path.points.length ? path.points[index + 2]
          : path.isClosed ? path.points[1] : null;
        for (const [first, second] of [[curves[0], curves[1]],
          ...(next ? [[curves[1], shore.edges.get(b).get(next)[0]]] : [])]) {
          assert.ok(util.pointDistance(util.unit(util.subtract(first[3], first[2])),
            util.unit(util.subtract(second[1], second[0]))) < 1e-10, 'fill subdivisions keep the spline tangent');
        }
        if (next) {
          const t = util.pointDistance(a, b) / (util.pointDistance(a, b) + util.pointDistance(b, next));
          const [first, second] = view.splitCurve(spline[path.isClosed ? index : index + 1], t);
          assert.deepEqual(curves[1], first, 'the corner junction is derived from the unconstrained midpoint spline');
          assert.deepEqual(shore.edges.get(b).get(next)[0], second);
          assert.ok(spline.every((curve) => util.pointDistance(curve[0], b) > 1e-8),
            'no interior hex corner is an interpolation point');
        }
      }
      for (let index = 0; index < spline.length - (path.isClosed ? 0 : 1); index++) {
        const first = spline[index], second = spline[(index + 1) % spline.length];
        assert.deepEqual(first[3], second[0]);
        assert.ok(util.pointDistance(util.subtract(first[3], first[2]), util.subtract(second[1], second[0])) < 1e-10,
          'successive midpoint segments have matching derivatives, including the closed join');
      }
      if (!path.isClosed) {
        assert.deepEqual(shore.vertices.get(path.points[0]), path.points[0]);
        assert.deepEqual(shore.vertices.get(path.points.at(-1)), path.points.at(-1));
      }
    }
    assert.equal(fileFormat.write(doc), before);
  }
  assert.ok(landward && waterward, 'the shoreline wanders to both sides of the hex boundary');
  assert.ok(maxOffset > 0.25 * 2 / Math.sqrt(3), 'full edges can use the expanded 30% range, not the former small-edge cap');
});

function svgSegments(path) {
  let current, start;
  const segments = [];
  for (const match of path.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const values = match[2].trim().split(/\s+/).filter(Boolean).map(Number);
    if (match[1] === 'M') {
      current = start = values;
    } else if (match[1] === 'L') {
      segments.push([current, values]);
      current = values;
    } else if (match[1] === 'C') {
      const curve = [current, values.slice(0, 2), values.slice(2, 4), values.slice(4, 6)];
      segments.push(curve);
      current = curve[3];
    } else {
      segments.push([current, start]);
      current = start;
    }
  }
  return segments;
}

function containsSegments(segments, point) {
  let inside = false;
  for (const segment of segments) {
    const points = segment.length === 4 ? view.flattenCurve(segment, 0.002) : segment;
    for (let index = 0; index + 1 < points.length; index++) {
      const a = points[index], b = points[index + 1];
      if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) {
        inside = !inside;
      }
    }
  }
  return inside;
}

test('SVG land and water fills share the exact shoreline, including mixed terrains and narrow channels', () => {
  for (const shape of ['island', 'lake', 'ring', 'channel', 'coast']) {
    const doc = shoreMap(shape), data = regions.build(doc), shore = svgExport.buildShorelines(data);
    const text = svgExport.write(doc, { layers: { embellishment: false } });
    const size = svgExport.dimensions(doc);
    const toSvg = [48, 0, 0, -48, -size.bounds[0] * 48, size.bounds[3] * 48];
    const paths = [...text.matchAll(/<path id="region-(\d+)"[^>]+d="([^"]+)"/g)]
      .map((match) => svgSegments(match[2]));
    const flatPaths = paths.map((segments) => segments.flatMap((segment) => {
      const points = segment.length === 4 ? view.flattenCurve(segment, 0.002) : segment;
      return points.slice(1).map((point, index) => [points[index], point]);
    }));
    const keys = paths.map((segments) => new Set(segments.filter((segment) => segment.length === 4).map(JSON.stringify)));
    const coastGroup = /<g id="layer-shoreline"[^>]*>([\s\S]*?)<\/g>/.exec(text)[1];
    const coastKeys = new Set([...coastGroup.matchAll(/<path d="([^"]+)"/g)]
      .flatMap((match) => svgSegments(match[1]).filter((segment) => segment.length === 4).map(JSON.stringify)));
    for (const edge of data.edges) {
      if (edge.cellIndices.length !== 2) continue;
      const cells = edge.cellIndices.map((cellIndex) => data.cells[cellIndex]);
      if (terrain.isWater(cells[0].terrainId) === terrain.isWater(cells[1].terrainId)) continue;
      const firstLand = !terrain.isWater(cells[0].terrainId);
      const a = data.points[firstLand ? edge.indexA : edge.indexB];
      const b = data.points[firstLand ? edge.indexB : edge.indexA];
      const land = cells[firstLand ? 0 : 1], water = cells[firstLand ? 1 : 0];
      const curves = shore.edges.get(a).get(b);
      for (const curve of curves) {
        const mapped = curve.map((point) => projection.applyTransform(toSvg, point)
          .map((value) => Number(util.formatNumber(value))));
        assert.ok(keys[land.regionIndex].has(JSON.stringify(mapped)));
        assert.ok(keys[water.regionIndex].has(JSON.stringify([...mapped].reverse())));
      }
      const tangent = util.unit(util.subtract(b, a)), normal = [-tangent[1], tangent[0]];
      for (const [sign, expected] of [[1, land], [-1, water]]) {
        const point = projection.applyTransform(toSvg, util.add(curves[0][3], util.scale(normal, sign * 0.012)));
        const owners = flatPaths.flatMap((segments, regionIndex) => containsSegments(segments, point) ? [regionIndex] : []);
        assert.deepEqual(owners, [expected.regionIndex], `${shape}: only the adjacent terrain colours its side of the coast`);
      }
    }
    for (const curves of shore.paths.values()) {
      for (const curve of curves) {
        const mapped = curve.map((point) => projection.applyTransform(toSvg, point)
          .map((value) => Number(util.formatNumber(value))));
        assert.ok(coastKeys.has(JSON.stringify(mapped)), 'the stroke exports the unsplit midpoint spline');
      }
    }
    const polygons = data.cells.map((cell) => cell.vertexIndices.map((vertex) => data.points[vertex]));
    for (let columnIndex = 0; columnIndex < 24; columnIndex++) {
      for (let rowIndex = 0; rowIndex < 24; rowIndex++) {
        const point = [data.bounds[0] + (columnIndex + 0.317) / 24 * (data.bounds[2] - data.bounds[0]),
          data.bounds[1] + (rowIndex + 0.641) / 24 * (data.bounds[3] - data.bounds[1])];
        if (!polygons.some((polygon) => util.pointInConvex(point, polygon))) continue;
        const mapped = projection.applyTransform(toSvg, point);
        const owners = flatPaths.filter((segments) => containsSegments(segments, mapped)).length;
        assert.equal(owners, 1, `${shape}: midpoint smoothing leaves no fill gaps or overlaps near junctions`);
      }
    }
  }
});

test('SVG shoreline colour adjustments and embellishment clips follow the existing layer switches', () => {
  const doc = shoreMap('island');
  const on = svgExport.write(doc), off = svgExport.write(doc, { layers: { shoreline: false } });
  assert.match(on, /<path id="region-\d+"[^>]+d="[^"]*C/);
  assert.doesNotMatch(off, /<path id="region-\d+"[^>]+d="[^"]*C|id="layer-shoreline"/);
  const noColours = svgExport.write(doc, { layers: { terrain: false, embellishment: false } });
  assert.doesNotMatch(noColours, /id="layer-terrain"|id="region-/);
  assert.match(noColours, /<g id="layer-shoreline" fill="none"[\s\S]*?<path d="[^"]*C/);
  assert.match(on, /<clipPath id="clip-region-\d+"><use href="#region-\d+"\/>/);
  const wider = svgExport.write(doc, { width: 2400 });
  assert.equal(on.replace(/width="\d+" height="\d+"/, ''), wider.replace(/width="\d+" height="\d+"/, ''));
});

test('clipped global and span shorelines retain endpoint anchors and bound midpoint offsets', () => {
  const span = model.createLocalMap({ width: 40, height: 30, systemName: 'regional', scaleName: 'L',
    anchor: coordinates.makeLocation('Hxz+-', 0.45 * projection.getMilesPerEdge(24), 0.3 * projection.getMilesPerEdge(24)) });
  assert.ok(span.topo.span);
  for (const doc of [model.createGlobalMap({ panelHexes: 4 }), span]) {
    doc.terrainIds.set(view.demoTerrain(doc.topo, 3));
    for (const panelId of doc.local ? ['local'] : Object.keys(projection.build().panels)) {
      const data = regions.build(doc, panelId), shore = svgExport.buildShorelines(data);
      for (const edge of data.edges) {
        const a = data.points[edge.indexA], b = data.points[edge.indexB];
        const curves = shore.edges.get(a)?.get(b);
        const coast = edge.cellIndices.length === 2
          && terrain.isWater(data.cells[edge.cellIndices[0]].terrainId) !== terrain.isWater(data.cells[edge.cellIndices[1]].terrainId);
        assert.equal(!!curves, coast, 'only a shared water/land edge gets shoreline curves');
        if (curves) {
          const delta = util.subtract(curves[0][3], util.scale(util.add(a, b), 0.5));
          assert.ok(util.vectorLength(delta) <= svgExport.SHORE_DEVIATION * Math.min(1, util.pointDistance(a, b) * Math.sqrt(3)) + 1e-10);
          assert.ok(Math.abs(util.dot(delta, util.unit(util.subtract(b, a)))) < 1e-10);
        }
      }
      for (const path of data.shorelines.filter((item) => !item.isClosed)) {
        assert.deepEqual(shore.vertices.get(path.points[0]), path.points[0]);
        assert.deepEqual(shore.vertices.get(path.points.at(-1)), path.points.at(-1));
      }
      assert.doesNotMatch(svgExport.write(doc, { panelId }), /(?:NaN|Infinity|undefined)/);
    }
  }
});

test('every export layer can be excluded independently without altering other layers', () => {
  const doc = localMap();
  const enabled = Object.fromEntries(svgExport.LAYER_DEFINITIONS.map(([key]) => [key, true]));
  for (const [key] of svgExport.LAYER_DEFINITIONS) {
    const text = svgExport.write(doc, { layers: { ...enabled, [key]: false } });
    if (['road', 'trail', 'river'].includes(key)) {
      assert.ok(!text.includes(`data-layer="${key}"`));
    } else if (key === 'landmarkNames') {
      assert.ok(!text.includes('Keep &amp; &lt;town&gt;'));
    } else {
      assert.ok(!text.includes(`id="layer-${key}"`));
    }
    if (key !== 'label') assert.ok(text.includes('id="layer-label"'));
    if (key !== 'terrain') assert.ok(text.includes('id="layer-terrain"'));
    if (key === 'landmark') assert.ok(!text.includes('<symbol'));
    if (key === 'terrain') assert.ok(text.includes('id="region-'), 'embellishments still clip to regions');
    if (key === 'embellishment') assert.ok(!text.includes('<clipPath id="clip-region-'));
  }
  const noTerrain = svgExport.write(doc, { layers: { terrain: false, embellishment: false } });
  assert.ok(!noTerrain.includes('id="region-'));
  const empty = svgExport.write(doc, { layers: Object.fromEntries(svgExport.LAYER_DEFINITIONS.map(([key]) => [key, false])) });
  assert.doesNotMatch(empty, /id="layer-|data-layer=|<text|<symbol/);
});

test('XML escaping handles text and attributes and rejects unrepresentable characters', () => {
  assert.equal(svgExport.Escape('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  const text = svgExport.write(localMap(), { layers: { landmarkNames: true } });
  assert.match(text, /A &amp; B &lt;Map&gt; &quot;quoted&quot;/);
  assert.match(text, /Keep &amp; &lt;town&gt;/);
  assert.match(text, /A &amp; &lt;B&gt; &quot;quoted&quot; \u03b1 \ud83c\udff0/);
  for (const text of ['\u0000', '\u000b', '\ud800', '\udfff', '\uffff']) {
    assert.throws(() => svgExport.Escape(text), /XML/);
  }
});

test('SVG is well-formed XML with unique ids and resolved internal references', (context) => {
  const doc = localMap();
  const global = model.createGlobalMap({ panelHexes: 4 });
  const rich = model.createGlobalMap({ panelHexes: 8 });
  rich.terrainIds.set(view.demoTerrain(rich.topo, 3));
  for (let tileIndex = 0; tileIndex < doc.tileCount; tileIndex++) {
    model.setTerrain(doc, tileIndex, tileIndex % 17);
  }
  const texts = [svgExport.write(doc), svgExport.write(doc, { layers: { grid: true, landmarkNames: true } }),
    svgExport.write(doc, { layers: { terrain: false } }),
    svgExport.write(global, { panelId: coordinates.panelIdByName('Eta') }),
    ...['Beta', 'Gamma', 'Delta', 'Iota'].map((name) => svgExport.write(rich, { panelId: coordinates.panelIdByName(name) }))];
  const check = spawnSync('python3', ['-c', `
import json
import re
import sys
import xml.etree.ElementTree as et
for text in json.load(sys.stdin):
    root = et.fromstring(text)
    assert root.tag == '{http://www.w3.org/2000/svg}svg'
    ids = [e.attrib['id'] for e in root.iter() if 'id' in e.attrib]
    assert len(ids) == len(set(ids))
    for e in root.iter():
        if 'href' in e.attrib:
            assert e.attrib['href'].startswith('#') and e.attrib['href'][1:] in ids
        for value in e.attrib.values():
            for ref in re.findall(r'url\\(#([^)]*)\\)', value):
                assert ref in ids
    assert len(root.findall('.//{http://www.w3.org/2000/svg}title')) == 1
`], { input: JSON.stringify(texts), encoding: 'utf8' });
  if (check.error && check.error.code === 'ENOENT') {
    context.skip('Python 3 is unavailable; browser smoke checks also parse with DOMParser');
    return;
  }
  assert.equal(check.status, 0, check.stderr || String(check.error));
});

test('all eight local scales use the same normalized SVG dimensions and label units', () => {
  for (const systemName of ['regional', 'local']) {
    for (const scaleName of lattice.SIZES) {
      const doc = localMap(systemName, scaleName);
      const size = svgExport.dimensions(doc, 'local', 900);
      assert.equal(size.width, 900);
      assert.ok(Math.abs(size.height - 900 * size.spanHeight / size.spanWidth) <= 0.5);
      const text = svgExport.write(doc, { width: 900 });
      const match = /<text data-id="label1" transform="matrix\(([^)]+)\)"/.exec(text);
      const actual = match[1].split(' ').map(Number);
      const toSvg = [48, 0, 0, -48, -size.bounds[0] * 48, size.bounds[3] * 48];
      // Local maps that span a seam draw in their anchor panel's frame (edge units).
      const geometry = view.mapGeometry(doc);
      const toHex = geometry.span
        ? projection.composeTransforms(view.featureCopies(geometry, view.mapLayout(doc), doc.labels[0].tileIndex)[0].frameToWorld,
          [1 / geometry.d, 0, 0, 1 / geometry.d, 0, 0])
        : [1, 0, 0, 1, 0, 0];
      const expected = projection.composeTransforms(view.labelTransform(geometry, doc.labels[0]), projection.composeTransforms(toHex, toSvg));
      actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 1e-6));
      assert.ok(Math.abs(Math.hypot(actual[0], actual[1]) - 1) < 1e-6, 'a label unit is one SVG viewBox unit');
    }
  }
});

test('global export is panel-north-up, with seam-transformed curves and label copies', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const a = coordinates.panelIdByName('Gamma'), b = coordinates.panelIdByName('Beta');
  const tile = doc.topo.tiles.find((item) => item.panelId === a
    && item.column === doc.topo.panels[a].columnCount - 1 && !item.isPartial);
  const otherIndex = model.neighbors(doc, tile.index).find((tileIndex) => doc.topo.tiles[tileIndex].panelId === b);
  model.addOverlay(doc, { type: 'road', tileIndices: [tile.index, otherIndex] });
  model.addLabel(doc, { tileIndex: tile.index, category: 'location', text: 'Seam label', rotation: 20 });
  for (const panelId of [a, b]) {
    const text = svgExport.write(doc, { panelId });
    const size = svgExport.dimensions(doc, panelId);
    const toSvg = [48 / doc.topo.d, 0, 0, -48 / doc.topo.d, -size.bounds[0] * 48, size.bounds[3] * 48];
    const curve = view.overlayCurves(doc.topo, doc.overlays[0]).find((item) => item.panelId === panelId);
    const match = /<path data-point="0" d="M([^C]+)C([^"]+)"/.exec(text);
    const values = `${match[1]} ${match[2]}`.trim().split(/\s+/).map(Number);
    const expected = curve.control.flatMap((point) => projection.applyTransform(toSvg, point));
    values.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 1e-6));
    assert.match(text, /Seam label/);
    assert.match(text, new RegExp(`- ${projection.build().panels[panelId].name}</title>`));
  }
  const remote = svgExport.write(doc, { panelId: coordinates.panelIdByName('Mu') });
  assert.doesNotMatch(remote, />Seam label</);
});

test('rivers taper from source to mouth along exact cubic sub-curves; trails stay dashed', () => {
  const doc = localMap();
  const text = svgExport.write(doc);
  const river = /<g id="overlay-river1"[\s\S]*?<\/g>/.exec(text)[0];
  const widths = [...river.matchAll(/<path[^>]+stroke-width="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.equal(widths.length, 24);
  assert.ok(widths.every((spanWidth, index) => index === 0 || spanWidth > widths[index - 1]));
  assert.match(text, /id="overlay-trail1"[^>]+stroke-dasharray="4 3"/);
  const curve = view.overlayCurves(view.mapGeometry(doc), doc.overlays[2])[0].control;
  const [first, second] = view.splitCurve(curve);
  assert.deepEqual(first[0], curve[0]);
  assert.deepEqual(second[3], curve[3]);
  assert.deepEqual(first[3], second[0]);
  for (const t of [0, 0.1, 0.3, 0.5, 0.75, 1]) {
    assert.ok(util.pointDistance(view.cubicPoint(first, t), view.cubicPoint(curve, t / 2)) < 1e-12);
    assert.ok(util.pointDistance(view.cubicPoint(second, t), view.cubicPoint(curve, (1 + t) / 2)) < 1e-12);
  }
});

test('partial-tile labels and glyphs retain their anchors and rotation across non-equatorial seams', () => {
  const doc = model.createGlobalMap({ panelHexes: 4 });
  const owner = coordinates.panelIdByName('Eta');
  const tile = doc.topo.tiles.find((item) => item.panelId === owner && item.isPartial);
  model.addLabel(doc, { tileIndex: tile.index, category: 'location', text: 'Partial', rotation: 35 });
  model.setLandmark(doc, tile.index, { type: 'tower' });
  const panels = [owner, ...projection.build().seams.filter((seam) => seam.panelA === owner || seam.panelB === owner)
    .map((seam) => seam.panelA === owner ? seam.panelB : seam.panelA)];
  for (const panelId of panels) {
    const text = svgExport.write(doc, { panelId }), size = svgExport.dimensions(doc, panelId);
    const label = /<text data-id="label1" transform="matrix\(([^)]+)\)"/.exec(text)[1].split(' ').map(Number);
    const glyph = new RegExp(`data-tile="${tile.index}" transform="matrix\\(([^)]+)\\)"`).exec(text)[1].split(' ').map(Number);
    const seamTransform = view.panelTransform(owner, panelId);
    const anchor = projection.applyTransform(seamTransform, view.featureAnchor(doc.topo, tile.index));
    const expected = [(anchor[0] / doc.topo.d - size.bounds[0]) * 48, (size.bounds[3] - anchor[1] / doc.topo.d) * 48];
    for (const transform of [label, glyph]) {
      assert.ok(util.pointDistance(transform.slice(4), expected) < 1e-6);
    }
    const angle = 35 * Math.PI / 180 - Math.atan2(seamTransform[1], seamTransform[0]);
    assert.ok(Math.abs(label[0] - Math.cos(angle)) < 1e-6);
    assert.ok(Math.abs(label[1] - Math.sin(angle)) < 1e-6);
    assert.ok(Math.abs(Math.hypot(glyph[0], glyph[1]) - 26 / 24) < 1e-6);
  }
});

test('single-point paths export a clipped point and invalid options report errors', () => {
  const doc = localMap();
  model.addOverlay(doc, { type: 'road', tileIndices: [0] });
  assert.match(svgExport.write(doc), /<circle cx="[^"]+" cy="[^"]+" r="3"/);
  for (const width of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => svgExport.write(doc, { width }), /width/);
  }
  assert.throws(() => svgExport.write(doc, { panelId: 'Alpha' }), /panel/);
  assert.throws(() => svgExport.write(doc, { layers: { grid: 'yes' } }), /layer/);
  assert.throws(() => svgExport.write(doc, { layers: { unknown: true } }), /layer/);
  for (const layers of [null, [], false, 'all']) {
    assert.throws(() => svgExport.write(doc, { layers }), /layers/);
  }
  assert.throws(() => svgExport.write(model.createGlobalMap({ panelHexes: 4 })), /panel/);
});

test('export filenames identify the selected global panel and preserve the map basename', () => {
  const global = model.createGlobalMap({ panelHexes: 4, name: 'My world' });
  assert.equal(svgExport.fileName(global, coordinates.panelIdByName('Alpha')), 'My-world-Alpha.svg');
  const local = localMap();
  assert.equal(svgExport.fileName(local), fileFormat.fileName(local).replace(/\.map\.txt$/, '.svg'));
});

test('export size estimates bound the written terrain and drop with embellishments off', () => {
  const { Terrain: terrain } = loadModules();
  const global = model.createGlobalMap({ panelHexes: 4, tileScale: 'XL' });
  const water = svgExport.estimate(global, 'Hyz+-');
  assert.equal(water.tileCount, global.topo.panels['Hyz+-'].tileCount);
  assert.equal(water.embellishedCount, 0);
  for (const type of terrain.TERRAINS.filter((item) => item.embellish)) {
    global.terrainIds.fill(type.id);
    const estimate = svgExport.estimate(global, 'Hyz+-');
    assert.equal(estimate.embellishedCount, estimate.tileCount, type.key);
    assert.ok(estimate.bytes >= svgExport.write(global, { panelId: 'Hyz+-' }).length, type.key);
    assert.ok(svgExport.estimate(global, 'Hyz+-', false).bytes < estimate.bytes);
  }
  const local = localMap();
  const localEstimate = svgExport.estimate(local);
  assert.equal(localEstimate.tileCount, local.tileCount);
  assert.equal(localEstimate.embellishedCount, [...local.terrainIds].filter((id) => terrain.byId(id).embellish).length);
  const coast = shoreMap('channel');
  assert.ok(svgExport.estimate(coast, 'local', false).bytes
    >= svgExport.write(coast, { layers: { embellishment: false } }).length, 'curved coast geometry is included');
  assert.throws(() => svgExport.estimate(global, 'nowhere'));
});
