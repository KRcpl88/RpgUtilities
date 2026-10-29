# Plan: Fantasy RPG Global Map Editor

**Spec of record:** [`prompt.md`](../prompt.md). Where this plan and `prompt.md` disagree, `prompt.md` wins. Choices that `prompt.md` leaves open are recorded in §11 and can be overridden.
**Progress:** see [`map-editor-status.md`](map-editor-status.md).

## 0. Constraints

- **Runtime:** a single self-contained `map-editor/index.html` using only native browser APIs (Canvas 2D, DOM, Blob, FileReader, localStorage). No frameworks, bundlers, CDNs, npm packages, or external files.
- **Tests:** external `tests/*.test.cjs` files using Node's built-in `node:test` and `node:assert`, run with `node --test tests/`. No npm dependencies. Node is only used for the tests.
- **Geometry source:** `tools/generate_map_projection.py`. Its geometry and validation code comes from `prompt.md`, and its output `doc/equilateral-chamfered-cube.json` is the reference ("golden") data for the JavaScript port. Do not change the geometry.
- **Style:** PascalCase function names and Hungarian-prefixed variables (`sz` string, `d` double, `n` int, `f` bool, `rg` array, `g_` globals), in both Python and JS.

## 1. Repository layout

```
prompt.md                       # specification (spec of record)
map-editor/index.html           # the whole app: markup, CSS, <script data-module="..."> blocks
tests/
  _load.cjs                     # loads the DOM-free module blocks from index.html      [done]
  scaffold.test.cjs             # enforces the module and no-external-dependency rules   [done]
  util.test.cjs                 #                                                        [done]
  projection-reference.test.cjs # golden JSON structure, Python reproducibility          [done]
  projection.test.cjs           # port vs golden JSON, frames, seams                     [done]
  lattice.test.cjs  topology.test.cjs  coordinates.test.cjs                               [done]
  model.test.cjs                                                                         [done]
  view.test.cjs                 # camera, layouts, hit testing, culling, demo terrain    [done]
  edit.test.cjs                 # brush, stroke, flood fill, undo of edits               [done]
  features.test.cjs             # A*, feature commands, seam curves, label transforms   [done]
  feature-renderer.test.cjs     # canvas contracts, picking, visibility, raster reuse    [done]
  localmap.test.cjs             # normalized local geometry, scales, edges, files       [done]
  fileformat.test.cjs           # round trips, fixtures, line-numbered errors           [done]
  fixtures/sample-global.map.txt  fixtures/sample-local.map.txt                         [done]
  regions.test.cjs  svgexport.test.cjs
tools/generate_map_projection.py                                                         [done]
doc/
  equilateral-chamfered-cube.{json,svg}   # generated with --labels                      [done]
  map-editor-plan.md  map-editor-status.md
  file-format.md                          # the .map.txt spec                            [done]
README.md
```

## 2. Module convention (implemented in step 1, enforced by `tests/scaffold.test.cjs`)

Every module is an inline block that registers one frozen object:

```html
<script data-module="Name">
(function (Root) {
  'use strict';
  const RpgMap = Root.RpgMap = Root.RpgMap || {};
  const Util = RpgMap.Util;          // dependencies are read from RpgMap
  // ...
  RpgMap.Name = Object.freeze({ /* exports */ });
})(globalThis);
</script>
```

- Blocks appear in dependency order; `Util` is first and `App` is last.
- Blocks that touch the DOM carry `data-dom="true"`. The tests skip these, so every other block must be DOM-free.
- `tests/_load.cjs` `LoadModules()` blanks out HTML comments, compiles each DOM-free block with `vm.compileFunction` (passing a sandbox object as `globalThis`, with `lineOffset` so errors report `index.html` line numbers), and returns `RpgMap`.
- **Planned modules, in order:** `Util` ✅ → `Projection` ✅ → `Lattice` ✅ → `Topology` ✅ → `Coordinates` ✅ → `Terrain` ✅ → `Model` ✅ → `History` ✅ → `View` ✅ → `Edit` ✅ → `FileFormat` ✅ → `Regions` → `SvgExport` → `Renderer`* ✅ → `App`* ✅. Modules marked * use the DOM. The tool UI (palette, pointer and key handling) lives in `App`; the testable tool logic is the DOM-free `Edit` module (§11.32), so there is no separate `Tools` module.

## 3. Projection module (port of the Python geometry)

- Port these functions 1:1 to JS: `BuildSolidVertices`, `BuildSolid`, `InitializeNet`, `AttachNetFace`, `BuildNetEdges`, `BuildNet`. Keep the same strip order, attachment list, IDs (`V01`, `N01`, `E01`, `NE01`), `g_SectorLabels`, and `g_SectorNames`.
- Port the correctness checks from `Validate`:
  - counts: solid 32/48/18; net 62 vertices, 79 edges, 17 hinges, 31 cut pairs;
  - unit edge lengths and interior angles;
  - no overlapping faces;
  - seam pairing, hinge tree, and the strip layout.
- **Panel frames.** These are new; `prompt.md` "Map projection" and "Universal Coordinate system" define them. True north is the 3D vector `g_North = (1,-1,-1)/√3`.
  - **Equatorial panels:** Alpha–Zeta, the six strip hexagons, where `normal·North = 0`. Panel north equals true north and is parallel to the panel's two east/west edges, which are shared with neighbouring strip panels.
    - In the net, north is +y, and the east/west edges are vertical and 1.759306 edge units apart.
    - The **equator** is the horizontal line through the strip centres (net y = 0.122008, the same for all six).
    - Strip order in the net, west to east (left to right): Epsilon, Delta, Gamma, Beta, Alpha, Zeta. The strip wraps from Zeta back to Epsilon across the cut.
  - **Other panels:** Eta, Theta, Iota (north hexagons); Kappa, Lambda, Mu (south hexagons); Nu, Xi, Omicron, Pi, Rho, Sigma (squares).
    - Panel north is the projection of `g_North` onto the panel plane, normalised. It always runs along the line through two opposite vertices, the panel's north and south vertices.
    - For the north hexagons, the north vertex is the pole V05.
  - Each frame records:
    - the reference point (the panel centre, which for equatorial panels lies on the equator);
    - unit east and north axes, in 3D and in the net;
    - the panel polygon in the frame's coordinates (miles);
    - a rigid placement transform from the frame into the net.
  - Rule for east: east = north × outward normal, so the panel reads correctly when viewed from outside.
- **Seams:** for each of the 48 solid edges, store its two panels and a 2D rigid transform from frame A to frame B. Build it by unfolding B about the shared edge into A's plane (an isometry with no reflection).
- **Tests:** compare against the golden JSON within 1e-9; all invariants; each frame is orthonormal; equatorial north is +y in the net; seam A→B is the inverse of B→A; each seam's shared endpoints map onto each other.

## 4. Hex lattice, tiles, scales, coordinates (`prompt.md` "Map projection", "Scale", "Universal Coordinate system")

### 4.1 Orientation and size
- **Flat-top hexes** (flat edges horizontal). Columns run panel-north to panel-south; the two diagonal hex directions run NE–SW and NW–SE.
- **Global size:** set by `panelHexes` (n), the number of XL hexes (216 mi between centres) across an equatorial panel from its west edge to its east edge. n is an **even** integer, default 24.
  - Column spacing `w = d·√3/2`, where `d` is the distance between hex centres.
  - Equatorial panel width `W = n·w`. At n=24: W ≈ 4489 mi, panel edge ≈ 2552 mi, equatorial circumference ≈ 26,937 mi.
- **Tile scale** of a global map: regional XL (default) or L. L has 6n columns per equatorial panel.
- **Tile counts:** about 10.33·n² at XL (~5,950 at n=24) and ~36× that at L (~214k).

### 4.2 Scales
- **Regional:** S = 1 mi, M = 6 mi, L = 36 mi, XL = 216 mi.
- **Local:** S = 1 yd, M = 10 yd, L = 100 yd, XL = 600 yd.
- Each step within a system is an even integer ratio, so a coarse lattice nests exactly inside a finer one. With ratio r, coarse hex (C, J) is fine hex (r·C, r·J); because r is even, the half-hex offset of odd columns is a whole number of fine rows. Regional and local scales never mix.

### 4.3 Equatorial panels (Alpha–Zeta)
- One continuous lattice runs across all six panels and wraps around.
  - Panel column `i = 0…k−1`. k = n × (216 / tile-scale miles). At XL the centres are at `(i+½)·w` east of the panel's west edge. Finer scales are anchored on the XL centres so they nest (§4.2, §11.14): the column at `(i+½)·w` at XL becomes fine column `r·i + r/2`, so at L the first column's centre sits on the west edge.
  - Even columns have hex centres at `north = j·d` from the equator.
  - Odd columns are shifted ½ hex north: `north = (j+½)·d`. So the east-most column sits ½ hex above the first column and lines up with the next panel's first column.
- **East/west edges:** tiles are whole and belong to their column's panel. The small hex corners that cross the line are ignored; they are **not** partial tiles.
- **North/south edges:** the boundary cuts through tiles, giving partial tiles (§4.5).

### 4.4 Other panels
- The **primary column** (`c = 0`) lies on the north–south bisector. Hex `(0,0)` is centred on the panel reference point (§11).
- Column `c` is at `east = c·w`. Rows are at `north = (j + (|c| odd ? ½ : 0))·d`.
- Every edge produces partial tiles.

### 4.5 Tiles and partial tiles
- A panel's tiles are every lattice hex whose hexagon overlaps the panel polygon by more than 1e-6 of a hex area, except at equatorial east/west edges (§4.3).
- A partial tile is a full tile with its own terrain. It is drawn **clipped to the panel polygon**, so a hex cut by a seam appears as two independent tiles, one per panel.
- Each tile has an internal ID `(panel, col, row)`: zero-based offset coordinates in the panel's bounding rectangle. A dense `tileIndex` is used for typed arrays. Store the clipped polygon (or its overlap fraction) for each partial tile.

### 4.6 Adjacency (`Topology`)
- Two tiles are adjacent when their clipped polygons share a boundary segment longer than ε:
  - in the same panel, compare them directly;
  - across a seam, first map them through the seam transform.
- Across equatorial east/west seams, use plain lattice adjacency (the lattice is continuous there).
- Store adjacency in CSR form (`Int32Array`) and make it symmetric.
- **Tests:**
  - interior tiles have exactly 6 neighbours;
  - adjacency is symmetric;
  - every tile is reachable from every other;
  - the equatorial strip wraps: Zeta's east column is adjacent to Epsilon's west column.

### 4.7 Universal coordinates (`Coordinates`)
- A location is `(panel, east, north)` in **miles** measured in the panel plane: plain Cartesian distances from the panel reference point, with no curvature correction.
- For equatorial panels, north is measured from the equator and east from the panel centreline. With an even column count, no hex sits at east = 0.
- For other panels, the reference point is the panel centre, and the primary column is at east = 0.
- Provide:
  - `TileToUniversal` / `UniversalToTile` (snap to the nearest tile centre and reject anything more than 0.25·d away);
  - display formatting such as `Eta 187.1W 324.0N`;
  - (polish) `UniversalToTrue` → latitude/longitude, by central projection from the solid's centre onto the sphere. The prime meridian passes through eta's opposite vertex (+1,+1,−1), as stated in `prompt.md`.

### 4.8 Local maps
- A flat `width × height` rectangle of flat-top hexes at one scale (system plus size), with no projection.
- Oriented to panel north at its **anchor**: the universal coordinate of the centre of local tile (0,0), the north-west tile.
- For regional scales, the anchor snaps so the local lattice nests in the global lattice (§4.2). Local (yard) scales are positioned freely.

## 5. Data model

```
MapDoc {
  version, kind: 'global'|'local', name,
  global: { panelHexes n, tileScale 'XL'|'L' }
  local:  { width, height, system 'regional'|'local', size 'S'|'M'|'L'|'XL', anchor {panel, east, north} },
  terrain: Uint8Array,                                 // index into the Terrain table
  landmarks: Map<tileIndex, {type, name, notes}>,      // at most ONE per tile
  overlays: [{id, type:'road'|'trail'|'river', name, style, tiles:[tileIndex...]}],  // many may share a tile
  labels: [{id, tile, text, category:'region'|'location'|'city', size, rotation, dx, dy}],
}
```

- **Overlay paths:** each consecutive pair of tiles must be adjacent (§4.6). One tile may carry several overlays, for example a road crossing a river.
- **Terrain table:** a single source of truth. Each entry has an ASCII char, ID, name, colour, `isWater`, and an embellishment function (§8). The 17 types from `prompt.md`:

| char | terrain | water? | | char | terrain | water? |
|---|---|---|---|---|---|---|
| `~` | water | yes | | `d` | desert | |
| `i` | islands | yes (islands drawn on top) | | `D` | sand dunes | |
| `o` | lakes | yes | | `f` | forest | |
| `v` | firth | yes | | `m` | marsh | |
| `.` | plain | | | `g` | mangrove | |
| `h` | hills | | | `t` | tundra | |
| `M` | mountains | | | `c` | canyon | |
| `A` | mountain peak | | | `b` | badlands | |
| `=` | farmland | | | `_` | *(reserved: cell is not a tile of this panel)* | |

- **Landmarks:** village, town, city, castle, fortress, tower, ruins, mine, temple, cave, dungeon. Each has a canvas glyph and an SVG `<symbol>`.
- **History:** a command-pattern undo/redo stack that stores only the changes. Each brush stroke is one command.

## 6. ASCII file format (`*.map.txt`, printable ASCII; full spec in `doc/file-format.md`)

```
# RPGMAP 1
[map]
kind = global
name = "Aerth"
panelHexes = 24
tileScale = XL
# local maps instead: width, height, system, size, anchor = Eta 187.1W 324.0N

[legend]
~ water
. plain
...

[panel Alpha]            # one section per panel, in Greek order; a local map has a single [local] section
columns = 24             # characters per line
rows = 24                # the section covers the panel's whole bounding rectangle
latticeColumn = 0        # lattice column of the first character (informational, validated)
latticeRow = 11          # lattice row of the first line (informational, validated)
~~~~....                 # `rows` lines of `columns` chars, north line first; odd columns are ½ hex north; `_` = not a tile

[landmarks]
Alpha 93.5E 108.0N city "Karador" notes="Capital of the north"

[labels]
Alpha 93.5E 216.0N region id=label1 size=28 rot=-15 dx=0 dy=0 "The Northern Wastes"

[overlays]
road road1 style=highway "King's Road" : Alpha 93.5E 108.0N; 280.6E 0.0N; ...; Zeta 93.5W 216.0N
```

- **Coordinates** are universal (panel, miles), written to 0.1 mi (finer for yard-scale local maps, §11.39). The parser snaps each one to a tile centre within 0.25 hex.
- **Strings** are double-quoted with `\"`, `\\` and `\uXXXX` escapes, so files stay pure ASCII (§11.38).
- **Overlays:** the panel name may be left out when it hasn't changed from the previous point.
- **Writer:** output is deterministic so files diff cleanly in git.
- **Parser:**
  - accepts blank lines, `#` comment lines, and `\r\n` line endings;
  - reports errors with line numbers;
  - validates line widths, unknown characters, `_` placement against the panel's tile mask, duplicate landmarks, and path adjacency.

## 7. Editor UI (canvas)

- **Layout:** the step 1 shell (toolbar, tool panel, canvas, properties panel, status bar).
  - The status bar shows the hovered tile's universal coordinate, panel, terrain, landmark and overlays, plus true latitude/longitude (polish).
- **Viewport:**
  - Pan with drag or the arrow keys; zoom with the mouse wheel around the cursor; *fit net* and *fit panel*.
  - Draw only visible tiles, batched by colour. When zoomed far out, fall back to `ImageData`.
- **Global view:** each panel is drawn through its placement transform and clipped to its polygon, with panel outlines and Greek names.
  - A clickable minimap of the net acts as a navigator.
  - A **panel focus view** shows one panel north-up. Neighbouring panels' tiles are unfolded across the seams so editing can continue across edges.
- **Local view:** one flat rectangle of full hexes, north up, with the same terrain and feature tools. Fit all and the minimap work locally; global panel-focus/net controls and panel names are disabled. Hover shows universal miles, local col/row and the configured mi/yd scale.
- **Tools:**
  1. Terrain brush (radius 0–5) and flood fill.
  2. Eyedropper.
  3. Overlay tool (road, trail, river): click tiles to extend a path. Gaps are filled automatically with A* over model adjacency. Supports select, insert/remove point, split, join and delete.
  4. Landmark tool: place, replace or edit a landmark (one per tile).
  5. Label tool: text, category, size, rotation and offset in the properties panel, with drag and rotate handles.
  6. Erase/select tool for each layer.
- **Layers:** toggles for terrain, hex grid, panel outlines, each overlay type, landmarks and labels.
- **File:**
  - New dialog: name and global (n, L/XL tile scale) or local (regional/yard system, S/M/L/XL size, width, height, anchor, reference n). Validates before replacing the document and previews snapped/free anchors (§11.47).
  - Open with `<input type=file>`; save via a `Blob` download.
  - Export SVG (§8).
  - Autosave to `localStorage`, with a prompt to restore.
- **Keyboard:** tool hotkeys, Ctrl+Z, Ctrl+Y and Ctrl+S.

## 8. SVG export (`prompt.md` "SVG Export")

- **Scope:** a global map is exported **one panel at a time**, drawn north-up in the panel frame and clipped to the panel polygon. A local map is exported whole.
- **Options popup:**
  - which layers to include: terrain colours, terrain embellishments, shoreline, roads, trails, rivers, landmarks, labels;
  - hex overlay (on/off);
  - output size;
  - panel selector.
- **Output:**
  - Built as a string, so it is testable in Node.
  - Uses `<defs>` and `<symbol>`/`<use>`.
  - Deterministic: all randomness comes from `Util.CreateRng` seeded with `Util.HashIntegers` of panel and position.
- **Regions:**
  - Flood-fill tiles of the same terrain into regions.
  - Trace the boundary edges of the clipped tiles into closed loops (outer rings plus holes).
  - Each region becomes one `<path fill-rule="evenodd">`, which also serves as the embellishment clip path.
- **Shoreline:**
  - The land/water boundary loops, smoothed with Chaikin (2–3 passes) and stroked.
  - Segments that lie along the panel border are not stroked.
- **Embellishments:**
  - Patterns are laid out in panel coordinates, so a pattern continues seamlessly across neighbouring tiles of the same terrain.
  - Each pattern is clipped to its region, so it never spills into a different terrain.

| terrain | embellishment |
|---|---|
| plain, water, lakes, firth | none (`prompt.md`: plains and open water have no embellishment) |
| hills | small overlapping curves (hill outlines) |
| mountains | a cluster of steep angular peaks |
| mountain peak | one large angular peak filling the hex |
| desert | dot-and-dash pattern |
| sand dunes | hill-like dunes: straight slope on the left, gentle curve on the right |
| forest | overlapping tree crowns (foliage only); along the forest's south edge (tiles whose south neighbour is not forest), short vertical trunk lines |
| marsh | horizontal water dashes and clusters of 3 short vertical grass lines |
| tundra | dot and short horizontal dash |
| mangrove* | marsh water dashes plus small rounded crowns on short arched root lines |
| islands* | small irregular island blobs with a shoreline stroke, over water |
| canyon* | a pair of jagged rim lines with short hatching between them |
| badlands* | small flat-topped mesas and eroded hatching |
| farmland* | a patchwork of field rectangles with furrow lines |

\* `prompt.md` doesn't specify these; the designs are the planner's choice (§11).

- **Overlays:** rivers are Catmull-Rom curves through tile centres, converted to Béziers and tapering toward the source. Roads are solid lines; trails are dashed.
- **Landmarks:** `<use>` glyphs, optionally with the name alongside.
- **Labels:** `<text transform="translate rotate">` using the label's own size and rotation, with a `paint-order="stroke"` halo and escaped text.

## 9. Testing strategy (`node --test tests/`)

- **projection:** golden JSON comparison, invariants, frames and seams (§3).
- **lattice:** offset ↔ cube coordinate ↔ point round trips for flat-top odd-q layouts; point → hex hit tests; nesting of scale ratios (§4.2).
- **topology:** for n ∈ {4, 8, 24}:
  - per panel: tile ↔ index round trips; total partial-tile area matches the panel area;
  - equatorial columns are exactly n·ratio with no east/west partial tiles;
  - the primary column sits on the bisector of non-equatorial panels;
  - adjacency is symmetric and connected, interior tiles have 6 neighbours, and the strip wraps.
- **coordinates:** universal ↔ tile round trips; at n=24 XL, the equatorial width is ≈4489 mi and no equatorial hex sits at east = 0.
- **model/history:** only one landmark per tile; overlay adjacency is enforced; undo/redo restores exactly.
- **features:** A* versus BFS, all seams, exclusions/unreachable paths; insert/remove/split/join and feature edits undo and round-trip exactly; matching seam curves and tangents; label transforms and adaptive curve hit geometry.
- **feature-renderer:** canvas contract tests for drawing/picking visibility, label previews and handles, and terrain raster reuse after feature changes; real browser checks cover pixels and pointer/file interactions.
- **localmap:** all eight scales, regional anchor parity/nesting, normalized full-hex hits and rectangular bounds, one-row/column maps, large-map camera fitting, bounded strokes/fill/undo, flat feature geometry, arbitrary free-anchor canonical saves and invalid configurations.
- **fileformat:** global and local round trips; fixtures; line-numbered errors.
- **regions:** a single hex gives 1 loop; a ring gives an outer ring plus a hole; loops close.
- **svgexport:** well-formed XML; layer toggles add or remove groups; output is byte-identical across runs; text is escaped; the hex overlay toggles.
- **Manual smoke checklist:** README, plus a browser check (serve the repo, open the editor, confirm there are no console errors).

## 10. Milestones (each ends green: `node --test tests/` and `python3 tools/generate_map_projection.py --labels --check`)

1. ✅ **Scaffold:** HTML shell, module convention, `_load.cjs`, Util, projection tool, golden JSON.
2. ✅ **Projection:** JS port, validation, panel frames (north axis, reference point, equator), 48 seam transforms.
3. ✅ **Lattice and Topology:** flat-top lattice, global size and scales, equatorial continuous lattice, partial tiles clipped per panel, adjacency, universal coordinates (miles), local-map lattice.
4. ✅ **Terrain table, Model, History.**
5. ✅ **Renderer and viewport:** pan, zoom, culling, clipped panels, outlines, minimap, panel focus view, status bar coordinates.
6. ✅ **Terrain tools:** brush, fill, eyedropper, undo/redo.
7. ✅ **File format:** `doc/file-format.md`, writer, parser, open/save/autosave, fixtures.
8. ✅ **Overlays, landmarks, labels:** tools, properties panel, A* gap filling, path operations, layer-specific selection/erase, label drag/rotate handles.
9. ✅ **Local maps:** new-map dialog, all scales, anchor snapping, normalized viewport, every editing tool, universal coordinates, open/save/autosave for either map kind.
10. **SVG export, part 1:** per-panel options popup, regions, shoreline, colours, hex overlay, overlays, landmarks, labels.
11. **SVG export, part 2:** an embellishment algorithm for each terrain (§8).
12. **Polish:** true latitude/longitude, performance at L scale, sample maps, README and manual checklist.

## 11. Decisions made where `prompt.md` is silent (override by editing `prompt.md` or this list)

1. **One hex grid per panel** (user decision). The equatorial strip shares one continuous lattice, as `prompt.md` requires.
2. **Non-equatorial panels:** hex `(0,0)` is centred on the panel reference point. Odd columns (|c| odd) are shifted ½ hex north.
3. **Equatorial panels:** even columns have a hex centred on the equator, and odd columns are shifted ½ hex north.
4. **Partial tiles:** a hex is a tile of a panel if its overlap area is more than 1e-6 of a hex. A cut hex is two independent tiles.
5. **Global tile scale:** XL by default, with L as the only alternative. Finer scales use local maps.
6. **Local-map anchor:** the north-west tile (0,0). It snaps to the global lattice for regional scales.
7. **Universal coordinates in files:** miles to 0.1, snapped to the nearest tile centre when read.
8. **Overlay layer types:** road, trail and river, following the newer `prompt.md` list, which replaces "water courses".
9. **Terrain characters:** as in the §5 table. `_` means "not a tile".
10. **Embellishments for mangrove, islands, canyon, badlands and farmland:** as in the §8 table.
11. **True latitude/longitude:** central projection onto the sphere. Used for display only.
12. **Frame units:** `Projection` frames and seams are in edge units, so `Build()` is independent of panel size. `MilesPerEdge(nHexes)` converts to miles: `nHexes · 216 · √3/2` miles across the equatorial panel width.
13. **Seam direction:** panel A and B of a seam are the solid edge's `faces[0]` and `faces[1]`. Transforms use the canvas/SVG matrix layout `[a, b, c, d, e, f]`.
14. **Equatorial lattice anchor at finer scales:** equatorial lattices at every scale are anchored on the XL hex centres, so a coarse hex `(C, J)` is fine hex `(r·C, r·J)` (`prompt.md` nesting rule). This overrides the `(i+½)·w` rule of §4.3 for scales finer than XL.
15. **Tile numbering:** tiles are ordered by panel (golden JSON face order), then north to south, then west to east. `nRow = 0` is the northernmost lattice row in the panel; `nColumn` counts from the westernmost lattice column (equal to `i` on equatorial panels).
16. **Partial-tile pieces:** a partial tile stores `rgPieces = [{szPanel, rgrgdPolygon}]` in its own panel's frame (edge units). An equatorial east/west tile can have pieces in the neighbouring panel, mapped through the seam transform. Whole tiles store `rgPieces = null`. A tile is whole if its area is at least (1 − 1e-9) of a hex.
17. **Adjacency tolerance:** two tiles are adjacent if their shared lattice edge, clipped to the regions they cover, is longer than 1e-6·d. Across non-equatorial seams, the pieces' boundary intervals along the seam edge must overlap by more than that.
18. **Local-map anchor parity:** a regional local map snaps its anchor to the global lattice of the same scale and records that hex's column parity, so its odd columns shift north exactly like the global lattice. Local (yard) maps are not snapped.
19. **Terrain IDs and colours:** a terrain's ID is its row in the §5 table (water = 0, the default), so IDs must never be reordered. Files store the char, not the ID. Colours are the planner's choice (§12).
20. **Model change records:** every mutator validates, applies, and returns `{ szLayer: 'terrain'|'landmark'|'overlay'|'label', Key, nIndex, Before, After }` (or null for a no-op). `Key` is the tile index (terrain, landmark) or item id (overlay, label); `nIndex` is the list position, so undoing a removal restores the original order. Overlay, label and landmark values are frozen objects and are replaced, never edited in place.
21. **Ids:** overlay ids default to `road1`, `trail1`, `river1`, … and label ids to `label1`, …: the smallest unused number, computed from the current contents (no counter, so history never needs to restore one). Ids match `[A-Za-z][A-Za-z0-9_-]*`; overlay styles match `[A-Za-z0-9_-]*`; names, notes and label text may not contain control characters.
22. **Overlay paths** need at least one tile (the overlay tool starts a path with one click). Consecutive tiles must be adjacent, so a tile cannot repeat consecutively; a path may revisit a tile non-consecutively.
23. **Label defaults:** size region 28, city 18, location 14 (SVG px at 1:1 export); rotation in degrees, clockwise; `dx`, `dy` offsets default to 0.
24. **History:** a command is `{ szLabel, rgChanges }`. `Begin`/`Record`/`Commit` group a brush stroke; on commit, repeated terrain or landmark changes to one tile coalesce (first `Before`, last `After`) and net no-ops are dropped; an empty command is discarded without clearing redo. `Perform(History, szLabel, (Doc, fnRecord) => …)` reverts recorded changes if the callback throws. The stack keeps the latest 500 commands.
25. **Local tile numbering:** local tile index = `y · width + x`; local `(x, y)` is lattice offset `(x + parity, −y)`, which gives the neighbours.
26. **View module:** camera, layouts, culling, hit testing and the demo terrain live in a DOM-free `View` module (after `History`) so they are unit-tested; `Renderer` only does canvas drawing.
27. **World space:** in the net view, world = net space; in the panel focus view, world = the focus panel's frame. Both are y-up edge units. A layout is a list of placements `{ szPanel, rgdFrameToWorld, … }`; focus layouts place each edge-neighbour through its seam transform and draw the focus panel last.
28. **Point ownership at seams** (`prompt.md` "Map projection"): on the east/west seams between equatorial panels, edge hexes belong wholly to their own panel. The small tip of an edge hex that pokes across the seam into the neighbouring panel therefore belongs to that hex, and so to the other panel. On every other seam, partial tiles are clipped to their panel, so the panel containing the point owns it. Each equatorial panel draws its strip neighbours' edge columns (mapped through the seam), clipped to its own polygon. `View.HitTest` follows the same rule: it returns the owning tile, `szPanel` = the owner's panel, `rgdFrame` = the point in the owner's frame, and `szDrawPanel` = the panel whose outline contains the point.
29. **Drawing thresholds (hex size in screen pixels):** below 3 px, a cached raster of the whole layout is used (at most 4096 px across; rebuilt when the document changes in a way it was not told about, otherwise repainted per tile, §11.37); below 4 px, tiles are filled as their w × d cells; the hex grid appears at 6 px. Fills are inflated by ½ px to hide anti-aliasing seams and are issued in chunks of 512 tiles, because canvas path fills slow down superlinearly with subpath count.
30. **Demo terrain:** until files can be opened (milestone 7), the editor starts with `View.DemoTerrain(Topo, 1)`, a deterministic world from seeded sphere waves.
31. **Viewport input (milestone 5):** dragging with any button pans; milestone 6 moves pan to the middle/right button or Space+drag when the left button becomes the active tool. A double-click opens the focus view on the clicked panel. A minimap click recentres the net view, or refocuses on the clicked panel in focus view. Keys: arrows pan (Shift ×4), `+`/`=`/`-` zoom, Home fits all, `F` fits the panel, `N` shows the net, `P` focuses the panel at the view centre.

32. **Edit module:** the brush, stroke, flood fill and command helpers are a DOM-free `Edit` module (after `View`), unit-tested in `tests/edit.test.cjs`. `App` owns the tool state and input.
33. **Brush:** the radius (0–5, default 1) is in tiles: the footprint is every tile within that many adjacency steps (BFS over `Topology.Neighbors`), so it crosses seams and is a hex of 3r(r+1)+1 tiles away from panel corners. While the Brush tool is active, the footprint under the cursor is outlined.
34. **Strokes:** between pointer samples, the segment is hit-tested every d/4 world units so fast strokes leave no gaps; each tile under the path stamps the brush once per stroke. A whole stroke (pointer down to up) is one History command, labelled `Paint <terrain>`.
35. **Flood fill** replaces the connected region of the clicked tile's terrain (BFS across seams, no size cap) with the active terrain, as one command labelled `Fill <terrain>`; filling with the same terrain is a no-op. Even the whole world at n = 24 L (218,088 tiles) fills in well under a second, so no confirmation is asked.
36. **Tool input (replaces §11.31's "any button pans"):** tools are Pan (`H`), Brush (`B`), Fill (`G`) and Pick/eyedropper (`I`); `[`/`]` change the brush radius. The left button drives the active tool; the middle or right button, Space+drag, or the Pan tool pans. Alt+click picks a terrain with any tool. A double-click opens the focus view only with the Pan tool, so quick brush clicks never change view. Clicking a terrain in the properties legend makes it active (default: plain). Ctrl+Z undoes; Ctrl+Y and Ctrl+Shift+Z redo; toolbar Undo/Redo buttons are disabled when unavailable. The status message leads with the last action (`Paint Forest: 37 tiles`, `Undo Fill Water: 1,999 tiles`).
37. **Incremental raster:** after an edit, undo or redo, `Renderer.MarkTilesChanged` marks the changed tiles on each cached raster of that document. The next draw clears an integer-pixel box around each tile in every placement it is drawn in (its own panel, plus the strip neighbours for equatorial tiles) and redraws whatever overlaps the boxes, clipped to them. More than 3,000 changed tiles redraws the whole raster in place. Colour buckets are painted in terrain-id order so a partial repaint matches a full redraw (apart from a few hundred anti-aliased pixels, which are invisible).
38. **File details:** one module, `FileFormat` (after `Edit`), writes and parses `*.map.txt` (spec: `doc/file-format.md`).
    - The writer always emits `[legend]`, but a missing legend means the default characters; a legend may remap characters (except space, `#`, `[`, `]`, `"`, `\` and `_`).
    - Panel sections also carry `latticeColumn`/`latticeRow` (the lattice cell of the first character), which are validated like `columns`/`rows`.
    - Quoted strings escape `\"` and `\\`, and write everything outside printable ASCII as `\uXXXX`, so files are pure ASCII but keep any Unicode name.
    - Labels write their `id=` and all style keys. Overlays are written `<type> <id> [style=…] "<name>" : points`.
    - Empty item sections are left out. Comments only cover whole lines, because `#` is legal inside strings.
    - Unknown or duplicate sections and keys are errors (they would otherwise silently lose data). Parsing resets `nRevision` to 0.
39. **Coordinate precision:** locations are written with `max(1, ceil(−log10(hexMiles / 10)))` decimals. That gives 0.1 mi for every global and regional map (always well inside the 0.25-hex snap; checked for every tile at n = 24 L), and enough digits for yard-scale local hexes.
40. **File UI and autosave:** the toolbar has New, Open… and Save.
    - New (until the milestone 9 dialog): an all-water world with the current n and tile scale.
    - Open: errors show `Line N: …` in the status bar and keep the current map. Local maps are rejected until milestone 9.
    - Save: a `Blob` download named `FileFormat.FileName` (the map name, sanitised, plus `.map.txt`). Ctrl+S saves and Ctrl+O opens.
    - Dirty tracking compares `Doc.nRevision` with the saved revision. The status bar shows `name *`, and New/Open/Restore ask before discarding unsaved changes.
    - Autosave writes `{ szText, nTime }` to `localStorage['rpgmap.autosave']` 2 s after the last edit (and on `pagehide`) when the map is dirty. Save, Open and New clear it.
    - On start, a non-blocking banner offers Restore or Discard. Until the user chooses, autosave doesn't overwrite the copy on offer.
41. **Pathfinding:** `Edit.FindPath` is deterministic A* with unit cost per adjacency edge (no terrain preference). Local maps use hex distance. Global maps use solid-space chord distance divided by the longest adjacency edge, an admissible/consistent lower bound even for partial tiles and seams. Geometry is cached per topology and the heap breaks equal scores by tile index. Excluded tiles are supported for rerouting; an impossible path reports an error without changing the map.
42. **Feature commands:** `Edit.SetFeature` creates, edits or deletes a landmark, label or overlay in one History command; identical property edits are no-ops. Overlay helpers extend, insert after a selected point, remove, split and join:
    - Insert bridges both sides with A*. Removing an interior point reroutes around that tile; removing the sole point deletes the path.
    - Split shares the selected interior junction between the two resulting paths.
    - Join allows either endpoint on each path, bridges gaps with A*, and keeps the first path's id/name/style while deleting the second. Undo restores both originals and their order.
43. **Feature seam geometry:** `View.OverlayCurves` computes Catmull-Rom-to-cubic segments in panel frames. Adjacent panels draw transformed copies of the same curve, clipped to their own polygons. Never connect two net-space centres across a cut edge. `FeatureCopies` applies the same seam transforms to glyphs and labels. Whole tiles use their lattice centres; partial tiles use a point inside their largest visible piece (`FeatureAnchor`) so even slivers can carry a visible feature. Saved coordinates and point ownership are unchanged.
44. **Feature appearance and picking:** rivers are blue, roads brown and trails dashed. Overlay `style` is preserved metadata for future styling/export; canvas appearance currently follows type. The eleven landmark types carry vector path data in `Terrain.g_rgLandmarkTypes[].szPath` (canvas `Path2D`, reusable for SVG). Labels have a light halo. Selection uses the drawn, clipped geometry: adaptively flattened cubic curves (half-pixel tolerance), glyph hit radii, and inverse-transformed label bounds. Each feature layer has its own visibility toggle; hidden features cannot be picked or erased.
45. **Label units and handles:** one size/offset unit is 1/48 hex height. Positive dx is right/east, dy is down/south, rotation is clockwise relative to panel north. Labels scale with zoom. The white centre handle changes offsets; the yellow handle rotates. Pointer motion only changes a preview; pointer-up commits one command, while Escape, cancellation or lost capture discards the preview. Property fields commit on change, not per keystroke.
46. **Feature UI (v0.5.0):** Path (`O`), Landmark (`K`), Label (`T`), Select (`V`) and Erase (`E`) supplement the terrain tools. Path clicks extend until Escape/Finish; New path and New label explicitly start additional items. The properties panel has an overlapping-feature chooser, editable fields, path operations and Delete; Delete/Backspace also removes the selected visible feature. Select/Erase can target terrain, one overlay type, landmarks or labels. Terrain erase resets just that tile to water. The hovered tile's landmark, overlays and labels appear in the status bar. Feature changes/undo/redo use existing dirty/autosave handling and call `MarkTilesChanged` with an empty terrain list to advance cached raster revisions without rebuilding terrain.
47. **New-map dialog (v0.6.0; replaces the temporary New behavior in §11.40):** a native modal dialog validates names/settings and previews the regional snapped anchor or yard free anchor. Defaults reuse the current map's configuration; a global map supplies a selected/hovered tile, the view-centre tile, or Eta's origin as the initial anchor. A local map reuses its anchor. Width/height default to 32/24 when creating from a global map. The map name starts as Untitled. Hidden fieldsets are disabled, and modal keyboard input never invokes editor shortcuts. Cancel and invalid input leave the map unchanged. Discard confirmation occurs on a valid Create submission, not on opening the dialog.
48. **Local display geometry:** `Doc.Topo` remains null. `View.MapGeometry(Doc)` returns the actual global topology or a cached rendering-only local adapter, with one full hex per tile and one identity placement named `local`; `View.MapLayout` chooses net/local layout. Local world coordinates are y-up normalized hex heights (d = 1), with tile (0,0) at the origin and column parity from the anchor. Miles/yard magnitudes never enter camera or pointer math. `Model.Neighbors` remains the adjacency authority; `Model.TileToUniversal` and `Model.HexMiles` supply map-kind-aware coordinates/units.
49. **Local bounds and navigation:** the viewport outline is the rectangle containing every full edge hex, including parity offsets. Gaps in its corners/edges do not own tiles. `Coordinates.LocalPointToTile` tests full hexes, separately from the 0.25-hex file-coordinate snap threshold. Local maps stay flat beyond their anchor panel; no projection seams, wrapping or partial tiles are introduced. Panel focus/net/name controls are disabled; the minimap recentres the local camera. Fit sets a camera-specific minimum of min(4, fit scale / 4), allowing large local rectangles to fit and zoom out further without changing ordinary global zoom behavior.
50. **Shared local editing:** terrain strokes, raster caches, feature curves, glyphs, label transforms/handles, picking, properties and status all use the same local geometry. Label size/offset units remain 1/48 hex. Open and Restore accept either kind and reset layout, history, hover, selection and draw metadata. New documents are dirty immediately, including untouched all-water maps; creation clears the previous autosave and schedules a fresh one.
51. **Free-anchor serialization:** yard-scale anchors are rounded to the scale-dependent precision in §11.39 when saved. All saved feature coordinates are calculated against that rounded anchor, without mutating the document, so even arbitrary high-precision free anchors produce byte-identical write → parse → write output. Regional anchors retain their same-scale lattice snapping.

## 12. Open questions

- Should partial tiles below some area threshold be merged into a neighbouring tile, to avoid slivers that are hard to click?
- Should local maps be allowed to span panel seams? The plan currently treats a local map as flat and continuing beyond its panel.
- Exact colour palette and SVG stroke widths (cosmetic).
