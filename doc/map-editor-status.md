# Global Map Editor: Plan Status

Last updated: 2026-10-29 (after milestone 12; the plan is complete). See [`map-editor-plan.md`](map-editor-plan.md) for the full plan and [`../prompt.md`](../prompt.md) for the specification.

## Summary

Post-plan additions (2026-10-29): New offers a third `panel` map kind, selecting
one complete panel with M/L/XL tiles and no wrapping or neighbours. The model
exports `createPanelMap`; `doc.global.panelId` identifies its sole panel, and
`doc.topo` contains only that panel's clipped tiles and adjacency. All tools,
save/open/autosave and SVG export support it. World panel size is explicitly
in XL hexes regardless of tile scale. The optional virtual `reference` layer
uses `View.referenceGeometry` for a red equator and N/S polar crosshairs on both
canvas and SVG (also translated into local-map coordinates). It does not change
saved map data. See `panelmap.test.cjs` and `reference-layer.test.cjs`.

Post-plan additions (2026-10-30): local maps across panel seams, and crop/rescale (plan §11.68–69).

- **Seam-crossing local maps:**
  - A regional local map that crosses panel seams now gets a span topology from `Topology.buildSpan`, and `doc.topo.span` is set. It follows the global-map tile rules in each panel, so the grid turns (bends) at seams, and it may cross several seams.
  - Its width and height are reduced so it stops short of any panel corner vertex. `Coordinates.previewLocalSpan` reports the reduced size and the panels crossed.
  - It is saved with `[panel]` sections. Yard-scale maps, maps inside one panel and files with a `[local]` section stay flat.
  - The view uses a `span` layout with one placement per panel.
- **`Resample` module:**
  - `crop(source, options)`: any map → a local map of any size, scale and anchor.
  - `rescale(doc, systemName, scaleName)`: global XL↔L, panel XL/L/M, local any scale with the same ground.
  - Also exported: `rescaleOptions`, `localRescaleOptions`, `transfer`, `tileAtPoint`, `tilePoint` and `normalizePoint`.
  - Upscaling repeats tiles and downscaling takes the most common terrain. Features follow their tiles.
- **App:** the toolbar has **Crop…** and **Rescale…** dialogs (open or download). The status bar shows panel names on span maps. The New dialog previews the span and any crop.
- **Tests:** see `localspan.test.cjs` and `resample.test.cjs`.
- **Known limitation:** SVG regions and shorelines are not merged across span seams.

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold: HTML shell, module convention, test loader, Util, projection tool, golden JSON | ✅ Done |
| 2 | Projection: JS port, validation, panel frames, seam transforms | ✅ Done |
| 3 | Lattice and Topology: flat-top lattice, equatorial strip, partial tiles, adjacency, universal coordinates | ✅ Done |
| 4 | Terrain table, Model, History | ✅ Done |
| 5 | Renderer and viewport | ✅ Done |
| 6 | Terrain tools | ✅ Done |
| 7 | ASCII file format | ✅ Done |
| 8 | Overlays, landmarks, labels | ✅ Done |
| 9 | Local maps and scales | ✅ Done |
| 10 | SVG export, part 1 | ✅ Done |
| 11 | SVG export, part 2: terrain embellishments | ✅ Done |
| 12 | Polish: true latitude/longitude, L-scale performance, sample maps, README and manual checklist | ✅ Done |

## What exists now (milestones 1–12)

- **`map-editor/index.html`**: the editor shell (toolbar, tool panel, canvas, properties panel, status bar) with sixteen modules.
  - `Util` (DOM-free): vector helpers, `center`, `boundary`, `assertCondition`, `createRng` (mulberry32), `hashIntegers`, `formatNumber`, and 2D geometry: `polygonArea` (signed, CCW positive), `clipPolygonToConvex` (Sutherland–Hodgman), `clipSegmentToConvex` (returns `[t0, t1]` or null), `pointInConvex`.
  - `Projection` (DOM-free): a 1:1 port of the Python geometry, net and `validate`, plus panel frames and seams. Exports `NORTH`, `SECTOR_LABELS`, `SECTOR_NAMES`, `XL_HEX_MILES`, `build()`, `getMilesPerEdge(hexes)`, `findSeam(a, b)`, `solidToFrame`, `frameToSolid`, and 2D transform helpers (`applyTransform`, `composeTransforms`, `invertTransform`, `rigidFromSegments`).
  - `Lattice` (DOM-free): scale tables (`SCALES`, regional S/M/L/XL = 1/6/36/216 mi; local S/M/L/XL = 1/10/100/600 yd), flat-top offset ↔ axial ↔ cube ↔ point, `cubeRound`, `hexPolygon` (CCW from due east), `pointToOffset`, neighbours in order N, NE, SE, S, SW, NW (`DIRECTIONS`), `sharedEdge`, `offsetDistance`, `nestOffset(q, j, r)`. Offset `(q, j)` centre = `(q·w, (j + ½·odd(q))·d)`.
  - `Topology` (DOM-free): `build(n = 24, 'XL' | 'L')` (cached) returns `{ n, scaleName, d, w, hexArea, tileCount, tiles, panels, adjacencyOffsets, adjacency }`.
    - Each tile: `{ index, panelId, column, row, latticeColumn, latticeRow, center, area, isPartial, pieces }` (frame edge units; plan §11.15–16).
    - `panels[panelId]`: `{ Lattice, firstTile, tileCount, columnCount, rowCount, latticeColumnMin, latticeRowMax, westPanel, eastPanel }`.
    - Helpers: `tileAt(topo, panelId, [east, north])`, `locateLattice`, `tileByColumnRow`, `neighbors`, `areAdjacent`, `tilePolygons`, `panelLattice`, `latticeCenter`, `latticeNearest`.
    - Equatorial lattices are anchored on XL centres so finer scales nest (§11.14).
  - `Coordinates` (DOM-free): `tileToUniversal` / `universalToTile` (miles; returns −1 beyond 0.25·d), `formatUniversal` (`eta 187.1W 324.0N`), `parseUniversal`, `panelIdByName`, `makeLocation`, `createLocalMap`, `localTileToUniversal`, `universalToLocalTile` (local x east, y south; regional anchors snap to the global lattice, §11.18). `localTilePoint` / `localPointToTile` convert normalized local world points and full-hex hits, independently of the file-coordinate snap threshold. Dimensions/reference n use positive safe integers; anchors and parsed distances must be finite.
    - True coordinates (display only, plan §11.62): `trueCoordinates(location, milesPerEdge)` → `{ latitude, longitude, northBearing }` (degrees; bearing of true north from panel north, clockwise positive, null at a pole); `formatTrue(trueLocation, decimals = 3)` (`35.26°N 30.00°W`); `trueDecimals(hexMiles, milesPerEdge)` (about 0.1 hex, 1–9 decimals). The prime meridian is the (+1, +1, −1) direction; longitude runs west along the strip (Alpha 30°W … Zeta 30°E).
  - `Terrain` (DOM-free): `TERRAINS` (17 frozen `{ id, char, key, name, color, isWater, Embellish }`, ID = row of plan §5, water = 0; `Embellish` is a frozen `{ layoutKind: scatter | tile | field, dx, dy, chance, ink, accent, body }` pattern descriptor (plan §8, §11.58), or null for water, lakes, firth and plain), `RESERVED_CHAR` (`_`), `WATER_ID`, `byId`, `byChar`, `byKey`, `isValidId`, `isWater`, and `LANDMARK_TYPES` (village … dungeon) with `landmarkType`, `isLandmarkType`.
  - `Model` (DOM-free): `createGlobalMap({ panelHexes = 24, tileScale = 'XL', name })` and `createLocalMap({ width, height, systemName, scaleName, anchor, panelHexes?, name })`.
    - Document: `{ versionNumber, kind, name, global | local, topo (global only), tileCount, terrainIds: Uint8Array (water), landmarks: Map<tile, {type, name, notes}>, overlays: [{id, type, name, style, tileIndices}], labels: [{id, tileIndex, text, category, size, rotation, dx, dy}], revision }`. The document is mutable; its items are frozen and replaced on edit.
    - Mutators validate, apply, and return a change record `{ layer, key, index, before, after }` or null for a no-op (plan §11.20): `setTerrain`, `setLandmark` (place/replace/edit; null removes), `removeLandmark`, `addOverlay`/`updateOverlay`/`removeOverlay` (paths of adjacent tiles), `addLabel`/`updateLabel`/`removeLabel`. `applyChange(doc, change, forward)` replays a record and bumps `revision`.
    - Queries: `tileToUniversal`, `hexMiles`, `getMilesPerEdge` and `trueCoordinates(doc, tile)` (both map kinds; local maps use their anchor panel and reference n), `isTile`, `neighbors`, `areAdjacent` (Topology for global maps; lattice offsets for local maps), `localTileIndex`/`localTileXY` (index = y·width + x), `getTerrain`, `getLandmark`, `getOverlay`, `overlaysAt`, `getLabel`, `labelsAt`.
  - `History` (DOM-free): `create(doc, { limit = 500 })`, `begin`/`record`/`commit`/`cancel` (a brush stroke is one command; repeats coalesce), `perform(h, label, (doc, onChange) => …)`, `undo`, `redo` (return the command so the UI can redraw its tiles), `canUndo`, `canRedo`, `clear`. A new command clears redo (plan §11.24).
  - `View` (DOM-free, plan §11.26–31): the camera and layouts.
    - Camera `{ centerX, centerY, scale (px per world unit), minScale, width, height }`: `createCamera`, `resizeCamera`, `clampScale` (default 4…400000; fit can lower the minimum for large maps), `worldToScreenTransform`, `worldToScreen`, `screenToWorld`, `pan`, `zoomAt` (keeps the cursor point fixed), `centerOn`, `fitBounds`, `visibleBounds`.
    - Bounds `[minX, minY, maxX, maxY]`: `boundsOf`, `boundsIntersect`, `unionBounds`, `transformBounds`.
    - Layouts (cached): `buildNetLayout()` (18 placements at `frameToNet`) and `buildFocusLayout(panelId)` (neighbours through their seams, the focus panel last with the identity). A placement is `{ panelId, name, frameToWorld, worldToFrame, frameOutline, outline, bounds, center }`. `findPlacement`, `placementAt` (the topmost placement containing a world point).
    - Local geometry (§11.48–49): `mapGeometry(doc)` returns global topology or a cached rendering-only local adapter (one world unit per hex height; one identity placement). `mapLayout(doc)` returns net/local layout; `getFrameOutline` returns the panel polygon/local bounding rectangle. `doc.topo` stays null locally, and model adjacency stays independent. Bounds include full edge hexes, but empty corners do not hit a tile.
    - `panelTileGroups(topo, panelId)` (cached): the panel's own tiles plus, for equatorial panels, the overhanging edge columns of the west/east strip neighbours with the seam transform. `visibleTiles(topo, group, frameBounds)` culls by tile centre ± hex radius.
    - `hitTest(topo, layout, world)` → `{ tileIndex, panelId, framePoint, drawPanel }` or null. It is exact, including partial pieces. `panelId`/`framePoint` are the owning tile's panel and frame. A point inside an equatorial panel that falls in the tip of the strip neighbour's edge hex belongs to that neighbour's tile (plan §11.28, `prompt.md` "Map projection").
    - `demoTerrain(topo, seed)`: a deterministic `Uint8Array` world that uses all 17 terrains.
    - Feature geometry (§11.43–45, §11.55): `panelTransform`, `featureCopies`, `featureAnchor`, `overlayCurves` (cached per immutable overlay; cubic segments per drawing panel), `cubicPoint`, `splitCurve` (exact half-parameter de Casteljau split), `flattenCurve` (half-pixel tolerance), `distanceToSegment`, `labelTransform`, `LABEL_UNITS_PER_HEX` (48), `OVERLAY_STYLES` (shared canvas/export styles). Curves and text/glyph copies cross seams through panel transforms, not net-space lines across cut edges. Partial tiles use a visible-piece anchor without changing saved coordinates or ownership.
  - `Edit` (DOM-free, plan §11.32–35, §11.41–42): terrain and feature editing logic.
    - `MAX_BRUSH_RADIUS` (5); `brushTiles(doc, center, radius)`: tiles within r adjacency steps, nearest first (crosses seams; 3r(r+1)+1 tiles in the interior).
    - `floodRegion(doc, start)`: the connected same-terrain region (BFS, no cap); `segmentTiles(topo, layout, from, to)`: tiles under a world segment, sampled every d/4 with `View.hitTest`, without consecutive repeats.
    - `paintTiles(doc, tileIndices, id, onChange)` → changed tiles.
    - Strokes: `beginStroke(History, id, radius)` opens a `Paint <terrain>` command; `strokeTo(stroke, layout, world)` stamps the brush on each new tile along the segment from the last point and returns the changed tiles; `endStroke` commits (null if nothing changed).
    - `fill(History, start, id)` → `{ command, tileIndices }` as one `fill <terrain>` command (Command null for a no-op); `commandTiles(command)` lists the terrain tiles a command changes (for redraws after undo/redo).
    - `findPath(doc, fromIndex, toIndex, excluded = new Set())`: deterministic shortest A* path across the tile graph; unit cost, safe solid-space lower bound globally and hex distance locally; throws if unreachable.
    - `getFeature(doc, selection)` / `setFeature(History, layer, key, props)`: query or undoably create/edit/delete; null Key creates labels/overlays, landmarks use a tile key, null Props deletes. Identical edits are no-ops.
    - `extendOverlay`, `insertOverlayPoint`, `removeOverlayPoint`, `splitOverlay`, `joinOverlays`: every operation is one command. Removal reroutes around the removed interior tile; split shares the junction; join orients chosen endpoints, fills any gap and keeps the first path's properties.
  - `FileFormat` (DOM-free, plan §6 and §11.38–39; full spec in [`file-format.md`](file-format.md)): `write(doc)` → canonical `*.map.txt` text; `parse(text)` → a new Doc (`revision` 0), or throws an Error with `lineNumber` (0 = whole file) and the message `line N: …`.
    - Sections: `[map]`, `[legend]`, a `[panel <name>]` per panel in Greek order (`columns`, `rows`, `latticeColumn`, `latticeRow`, grid lines north first, `_` = not a tile) or one `[local]`, then `[landmarks]`, `[labels]`, `[overlays]` with universal coordinates. Overlay points may leave out an unchanged panel.
    - Also exports `MAGIC` (`# RPGMAP 1`), `FILE_EXTENSION` (`.map.txt`), `quote`/`tokenize` (quoted strings with `\"`, `\\`, `\uXXXX`), `coordinateDecimals(hexMiles)` and `fileName(doc)`.
  - `Regions` (DOM-free, §11.52–53): `outlineShape(doc, panel)` and `build(doc, panel?)` produce normalized export geometry (one unit per hex height, y north/up). `build` returns `{ panelId, outline, bounds, points, cells, edges, regions, shorelines }`; local scope defaults to `local`, global scope is required.
    - Cells retain tile ownership, terrain id and vertex/edge references; shared edges have one or two cell indices. Same-terrain cells flood-fill within the selected scope, including overhanging equatorial neighbours and partial pieces.
    - Regions contain `{ terrainId, tileIndices, loops }`; loops repeat their first point, with outer loops CCW and holes CW. Interior edges cancel. Spatial buckets merge vertices within `TOLERANCE = 1e-8` hex; malformed boundaries throw.
    - Each cell also records its `regionIndex` index.
    - `tracePaths(edges, points)` returns `{ points, isClosed }` chains/loops. Shorelines include only shared water/land edges, never exterior cuts or land/land and water/water boundaries. `smoothPath(path, passes = 2)` applies endpoint-preserving Chaikin smoothing (0–3 passes).
  - `Embellish` (DOM-free, §11.58–61): `build(Regions.build(...))` → per-region `null | { key, terrainId, instances: [{ variant, point, scale }], trunks: [[base, top]…] }` in hex units (y up), sorted north to south; `motifs(key)` → 4 cached frozen variants of `{ role: body | ink | accent | dot, points, isClosed }` shapes; `panelSeed`; constants `VARIANTS`, `JITTER`, `HEX_AREA`, `TRUNK_SPACING`, `TRUNK_HEIGHT`, `SOUTH_FACING`, `CROWN_CLEARANCE`, `FRINGE_SPACING`.
    - Scatter lattices (staggered rows, jittered, kept inside their cell) and field brick rows are anchored in the panel/local frame, so patterns continue across same-terrain tiles; mountain peaks are one motif per tile at its visible centroid, shrunk for partial tiles. Randomness is `hashIntegers(panel seed, terrain, i, j)` only.
    - Forest: trunks every 0.08 hex along internal forest/non-forest edges whose outward normal points south (y ≤ −0.3), never on export borders; crowns within 0.165 hex of such an edge are replaced by a fringe row along it (0.2 hex spacing).
  - `SvgExport` (DOM-free, §11.54–57, §11.59): `write(doc, { panelId?, width?, layers? })` → deterministic self-contained SVG; `dimensions(doc, panel?, width?)` → `{ width, height, spanWidth, spanHeight, bounds }`; `fileName(doc, panel?)`; XML `escape`; `LAYER_DEFINITIONS`, `DEFAULT_WIDTH` (1600) and `HEX_UNITS` (48).
    - `estimate(doc, panel?, embellish = true)` → `{ tileCount, embellishedCount, bytes }`: an upper-bound size of 4 KB + 4 B per tile + `EMBELLISHED_TILE_BYTES` (1,100) per embellished tile (§11.64).
    - A selected global panel is north-up and clipped; local maps export whole. The viewBox has 48 units per hex, independent of physical scale, and output height follows width/aspect ratio.
    - Terrain uses even-odd region paths/use; shorelines are smoothed, the optional hex grid has unique edges. Roads/trails and tapered rivers reuse shared curves/styles. Glyph symbols/use and haloed labels retain partial-tile anchors, seam transforms, category/rotation/offset units. Landmark names are optional.
    - The `embellishment` layer sits between terrain and shoreline: one `<g data-terrain>` per region clipped by `clip-region-N` (`<use>` of its even-odd region path); used motif variants are defined once as `emb-<key>-<n>` and placed with `<use>` (scaled for partial peaks); forest trunks are one path per region. Filled motifs use the descriptor body or terrain colour, or white with colours off.
    - `layers` boolean keys: `terrain`, `embellishment`, `shoreline`, `grid`, `road`, `trail`, `river`, `landmark`, `landmarkNames`, `label`; all default on except grid/names. Disabled groups are omitted. No external files or mutation of the model/history. XML-invalid text and invalid settings throw explicitly.
  - `Renderer` (`data-dom="true"`): `create(canvas)`, `draw(r, state)` → `{ raster, hexPixels }`, `drawMinimap(r, miniCanvas, state)`.
    - Tiles are drawn per placement through frame → world → screen, clipped to the panel polygon, and batched by terrain colour in chunks of 512.
    - Below 4 px, cells are filled as w × d rects; below 3 px, a cached raster of the layout is used. The hex grid appears from 8 px (at 6 px it doubled L-scale frame times for barely visible lines).
    - Then: focus-view neighbour dimming, panel outlines (the focus panel in yellow), panel names, and the hovered tile.
    - The minimap shows the net/local raster with the view rectangle, or the focus panel outline. Local maps skip panel names and use a rectangular map outline.
    - `markTilesChanged(r, doc, tileIndices)`: after an edit, cached rasters repaint just those tiles (integer-pixel boxes in every placement that draws them) on the next draw; above 3,000 tiles the raster is redrawn in place (plan §11.37). Colour buckets paint in terrain-id order.
    - The brush footprint (`state.previewTiles`) is outlined with the hovered tile.
    - Features: smooth blue rivers, brown roads, dashed trails, eleven distinct landmark vector glyphs (`Terrain.LANDMARK_TYPES[].path`), haloed labels with panel-relative size/rotation/offsets, selection outlines and label handles. Each panel clips its transformed copies, including cut-edge continuation.
    - `featureVisible` and `hitFeature(r, state, screen, filter)`: picking uses `r.featureHits` from the last draw and the topmost containing panel; hidden features do not enter the hit list. Label drag previews never mutate the document.
    - Feature-only changes call `markTilesChanged` with `[]`, retaining terrain rasters while updating their revision.
  - `App` (`data-dom="true"`, v1.0.0): `state { doc, History, layout, camera, layers, hoverTile, previewTiles, tool, terrainId, brushRadius, stroke, selection, labelPreview, labelDrag, message, … }`, starting with `Model.createGlobalMap()` (n = 24, XL) seeded with `View.demoTerrain`.
    - Toolbar: New, Open…, Save (plan §11.40), Export SVG (§11.56), Net view, Focus panel select, Fit all, Fit panel, Undo, Redo (disabled when unavailable). Tool panel: Pan / Brush / Fill / Pick buttons (`aria-pressed`), the brush radius slider (0–5, Brush only) and the active terrain swatch; then layer toggles (terrain, hex grid, panel outlines, panel names). The properties panel's terrain legend is the active-terrain picker (click or Enter/Space; default plain).
    - Input (plan §11.36): the left button drives the tool (Brush strokes, Fill click, Pick click; Alt+click picks with any tool); middle/right drag, Space+drag or the Pan tool pans; the wheel zooms about the cursor; a double-click focuses a panel (Pan tool only); a minimap click recentres or refocuses. Keys: `h b G I` tools, `[ ]` radius, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, Ctrl+S, Ctrl+O, arrows (Shift ×4), `+ = -`, Home, `f`, `N`, `P`.
    - Status bar: the hovered tile's universal coordinate · panel (letter) col/row (partial) · terrain · tile #, plus the last action (`Paint forest: 116 tiles`, `undo fill Desert: 1,999 tiles`), the view, n/scale, tile count, hex px (raster) and version.
    - Feature tools (§11.46): Path (`O`), Landmark (`K`), Label (`T`), Select (`V`), Erase (`e`). Properties switches from the terrain legend to item fields and an overlapping-feature chooser. Path operations include explicit New/Extend/Insert/Remove/Split/Join/Finish controls; Escape finishes. Delete/Backspace deletes the selected visible item.
    - Label size and offsets are in 1/48-hex units. White/yellow handles move/rotate a preview; pointer-up commits one undo step; Escape/cancel/lost capture discards it. New label permits multiple labels per tile.
    - Layer toggles include roads, trails, rivers, landmarks and labels. Select/Erase can target a single layer/type; hidden features are protected. Terrain erase changes only the clicked tile to water. Status includes the hovered tile's landmark, overlays and labels.
    - Files (§11.40, §11.47–51): New opens a native dialog for global/local kind, name, scale, dimensions and anchor/reference n, with validation and a snapped/free-anchor preview. Create asks before discarding unsaved changes; Cancel preserves the map. Newly created maps are dirty even before editing. Open and Restore accept either kind, reset history/selection/layout and fit the map; errors keep the current document. Save downloads `FileFormat.fileName(doc)`. Dirty state is `doc.revision ≠ state.savedRevision`; the status bar starts with `name *`.
    - Local viewport: every terrain/feature tool, label handle and layer toggle works in normalized local coordinates; status and path properties show universal miles at the file precision and the actual mi/yd scale. Net/focus controls and panel names are disabled. Fit all and the minimap navigate the local rectangle.
    - Autosave: 2 s after the last edit (and on `pagehide`) a dirty map goes to `localStorage['rpgmap.autosave']` with the original quoted wire keys `"szText"` and `"nTime"`; in-memory values use `text` and `timestamp`. Save/Open clear it, and New replaces it with a fresh scheduled autosave. On start a banner offers Restore or Discard (`#restore-banner`).
    - Export: `exportMap()` opens `#export-map-dialog`; panel/whole-local scope, positive integer width, layer toggles and a filename/dimension preview. Visibility defaults follow the canvas but remain independent. Successful export downloads SVG without marking the map saved; Cancel/errors preserve all editing state. New and Export share modal shortcut protection; Save and Export share `download`.
    - Polish (§11.63–64): the status bar and the selected landmark/label Properties show true latitude/longitude and the true-north bearing. Export, New and Open show a busy message and disable dialog buttons (`aria-busy`) until the work, deferred past the next paint, finishes; the export dialog warns when `estimate` reaches 4 MB, and a finished export reports MB and seconds.
    - Exports `RpgMap.App = { VERSION, state, start, showFocus, showNet, fitNet, fitPanel, setTool, setTerrain, setBrushRadius, undoOrRedo, newMap, saveMap, exportMap, autosave, isDirty }`.
- **`Projection.build()`** runs once, validates, and returns a deep-frozen object:
  - `vertices`, `faces`, `edges`, `netVertices`, `netFaces`, `netEdges` with the same IDs, order and fields as the golden JSON (edge maps are keyed `"V01|V09"`);
  - `strip` (net left to right), `equatorialWestToEast` (Epsilon … Zeta), `validation`, `equatorialWidth` (1.759306);
  - `panels[faceId]` = `{ id, letter, name, kind, isEquatorial, frame }`, and `frames[faceId]`;
  - each frame: `origin3D` (panel centre), unit `east3D`/`north3D`/`normal3D`, `polygon` (frame `[east, north]` in edge units), `originNet`/`eastNet`/`northNet`, `frameToNet`/`netToFrame`, and `northVertex`/`southVertex` (null for equatorial panels);
  - `seams`: 48 entries `{ edge, vertexIds, panelA, panelB, aToB, bToA }`.
- **Transforms** are `[a, b, c, d, e, f]` (canvas/SVG layout): `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Units are edge lengths; multiply by `getMilesPerEdge(n)` for miles (plan §11.12).
- **`tests/_load.cjs`**: `loadModules()` returns `RpgMap` built from the DOM-free blocks.
- **Tests** (175, all passing): `scaffold`, `util` (including the geometry helpers), `lattice`, `topology`, `coordinates`, `model` (terrain table vs plan §5, global/local documents, local adjacency, terrain/landmark/overlay/label undo-redo round trips, grouped strokes, Perform rollback, validation, history limit), `view` (camera round trips, zoom about a point, clamping, fit, net and focus layouts and shared seam edges, `hitTest` on every tile centre/piece centroid in the net and in every focus layout, random hits land inside the hit tile, seam ownership (equatorial edge-hex tips belong to the neighbour; elsewhere the containing panel), `panelTileGroups`, culling keeps every tile touching the view, deterministic demo terrain), `edit` (brush sizes 3r(r+1)+1 for r = 0–5, brush = BFS distance ≤ r in order and across a seam, radius validation, flood fill of the whole world / a blob / across seams, segment tiles cover dense sampling and are connected, a stroke is one command that undoes and redoes exactly, empty strokes record nothing, fill inside a ring, fill no-op), `features` / `feature-renderer` (details below), `fileformat` (fixtures parse and are canonical; byte-identical round trips for global n = 4/24 XL and 4 L with landmarks, labels and overlays on partial tiles and across seams, and local maps at every regional and yard scale; every 7th tile location at n = 24 L snaps back; CRLF, comments, missing or remapped legend; optional item defaults; quoting; 26 error cases with their line numbers; file names), `projection-reference` (golden JSON counts and Python `--check`), and `projection.test.cjs`:
  - every solid/net vertex, edge and face deep-equals the golden JSON within 1e-9; validation summary matches;
  - frames are orthonormal, east = north × normal, origins at panel centres, frame→net placement and frame→solid round trips;
  - equatorial north/east are +y/+x in the net, centres on y = 0.122008, east/west edges at ±W/2;
  - other panels: north vertex and south vertex are opposite and on east = 0; Eta/Theta/Iota contain V05, Kappa/Lambda/Mu contain V04;
  - seams are rotations, A→B→A is the identity, shared endpoints map onto each other, B unfolds to the far side of the edge, net folds agree;
  - the equatorial strip wraps (Zeta → Epsilon) with a pure translation of −W east;
  - `getMilesPerEdge(24)` ≈ 2551.8.
- **Milestone 8 coverage:** A* versus independent BFS, crossings of all 48 seams, exclusions/unreachable paths, exact undo/redo/save round trips for every feature operation, split/join endpoint orientations, one-landmark and multiple-label behavior, partial-tile anchors, matching seam curves/tangents, adaptive hit geometry and label transforms. Renderer canvas-contract tests cover visibility/picking, label previews/handles and raster reuse.
- **Milestone 8 browser check:** cross-seam river in focus/net views; path insert/remove/split/join; landmark replacement; multiple labels and feature chooser; property validation; move/rotate/cancel and undo; target-layer selection/erase and hidden-layer protection; terrain erase/undo; Ctrl+S download, New/Open round trip and autosave restore. No console errors.
- **Milestone 9 coverage:** `localmap` tests cover every local scale, both regional parities and panel lattice alignment, full-hex edge hits/gaps, 1×1 and one-row/column maps, large-map fitting/zoom, bounded strokes/fill/undo, flat feature geometry beyond panel boundaries, arbitrary free-anchor canonical saves and invalid settings. Renderer contracts run on both map kinds and cover vector/raster terrain, incremental edits and document switches.
- **Milestone 9 browser check:** create global L/XL and all eight local scales; validation, Cancel, modal typing and rejected discard confirmation; open/edit the local fixture; brush/fill/pick/undo; path insert/remove/split/join; landmark replacement; label properties, move/rotate/cancel/undo and native pointer capture outside the canvas; layer selection/erase and hidden-layer protection; local navigator; Ctrl+S download and canonical reopen; global/local New/Open transitions and both kinds of autosave Restore; a 300×260 yard map fitting in raster mode and autosaving before its first edit; preserved Gamma-owned edge-hex tip editing inside Delta. No console errors.
- **Milestone 10 coverage:** `regions` / `svgexport` test single hexes, holes/rings, disconnected equal terrain, coast classification, endpoint-preserving smoothing, global clipped areas/loop closure (4/24 XL, 4 L), a 24 L panel, equatorial neighbour tips, random local partitions, deterministic bytes, every layer, XML validity/references/escaping, filenames, non-mutation, all eight local scales, non-equatorial partial-tile label/glyph transforms and source-to-mouth river taper.
- **Milestone 10 browser check:** global/local export dialogs, scope/defaults, independent layer overrides, width validation and modal keys, Cancel, real SVG download, XML errors, dirty/history preservation, New/Save regression checks. Rendered exported SVG with paths, symbols, escaped names and rotated labels; checked 392 terrain-centre pixels across eight local scales (including a ring hole), transparent clipping and a Gamma-owned forest tip in the Beta export. No application console errors.
- **Milestone 11 coverage:** `embellish` tests check the 13 descriptors and their four frozen variants, deterministic read-only output, scatter motifs inside their regions, lattice continuity when a neighbour joins the terrain, one mountain-peak motif per tile (shrunk only when partial), forest trunks only on south-facing internal edges (none on shared forest edges or export borders), the crown clearance band and fringe row, SVG motif definitions/references, layer order, colours-off white bodies, width-independent content, all eight local scales and every n = 8 global panel. The XML reference test now includes all-terrain local and rich global panels.
- **Milestone 11 browser check:** rendered a 20 × 12 local map containing all 17 terrains (colours on and off) and a demo global panel with forest lakes; checked clipping, holes, shoreline order, trunks under the forest's southern treeline, canyon/desert/badlands/farmland motifs; the export dialog defaults Terrain embellishments on and its downloaded SVG parses with 816 resolved references. No console errors.
- **Milestone 12 coverage:** `truecoords` tests check panel-centre latitudes/longitudes (Eta 54.736°N 0°, the strip at 30°W … 30°E, Theta/Iota/Kappa/Lambda/Mu), the poles, continuity across every seam, east/north monotonicity and bearings, `Model` for both map kinds and formatting precision. `svgexport` checks `estimate` against counted tiles. `samples` checks the two sample maps are canonical, match `tools/make_sample_maps.cjs`, cover every terrain/landmark/label category/overlay type (valley) and seam-crossing routes (world), and export every panel as well-formed SVG. Profiling optimizations were checked byte-identical against pre-change SVG hashes.
- **Milestone 12 browser check:** true coordinates in the status bar and properties; opened both samples through the file chooser and previewed their SVG exports; Eta bearings symmetric (37.7° east/west at its upper corners); built n = 24 L (218,088 tiles, ≈ 1.2 s with "Building map…"); vector/raster frame times below; an L panel export dialog showed the large-export warning, disabled its buttons while exporting and reported "Exported Untitled-Alpha.svg (12.5 MB, 1.2 s)". No console errors.
- **Sample maps:** `map-editor/samples/sample-world.map.txt` (n = 8 XL, 882 tiles) and `sample-valley.map.txt` (36 × 26 regional M at `eta 119.5W 339.0N` after snapping), generated by `node tools/make_sample_maps.cjs` (`--check` verifies them).
- **Embellishment costs** (Node, before the milestone 12 optimizations): n = 24 XL mixed panel ≈ 60 ms / 0.26 MB (≈ 4,200 motifs); n = 24 L mixed panel ≈ 1.2 s / 8.3 MB (≈ 138,000 motifs); an all-forest L panel ≈ 1.9 s / 13.9 MB. All 18 demo panels at n = 24 XL export in ≤ 35 ms each in Chromium.
- **`doc/file-format.md`** (the `.map.txt` spec) and **`tests/fixtures/sample-global.map.txt`** (n = 4 XL demo terrain; landmarks with escaped strings; labels; a river crossing a seam) / **`sample-local.map.txt`** (12 × 8 regional M map at `eta 187.1W 324.0N` with a road).
- **`tools/generate_map_projection.py`** and **`doc/equilateral-chamfered-cube.{json,svg}`**: unchanged since milestone 1.

### Checked numerically

- **Net size:** total area 36.9096 edge². Squares are 1.0 each; hexagons are 2.5758 each.
- **Equatorial panels:** Alpha–Zeta have `normal·north = 0`; width 1.759306 edge units; all centres at net y = 0.122008.
- **Non-equatorial north/south vertices:** Eta V05/V07, Theta V05/V01, Iota V05/V06, Kappa V03/V04, Lambda V02/V04, Mu V08/V04, Nu V29/V27, Xi V21/V18, Omicron V13/V16, Pi V09/V12, Rho V30/V28, Sigma V23/V20.
- **At n = 24 XL:** d = 0.0846446 edge units; panel edge ≈ 2551.8 mi; equatorial circumference ≈ 26,936.9 mi; equatorial panel width ≈ 4489.5 mi.
- **Tile counts** (total / partial, build time): n = 4 XL 264 / 180; n = 8 XL 882 / 390; n = 24 XL 6,564 / 1,218 (~0.1 s); n = 4 L 6,570 / 1,224; n = 24 L 218,088 / 7,572 (~1 s). Tile areas sum to the panel areas, and the tile graph is connected in every case.
- **Draw times** (headless Chromium, 920 × 790 canvas): n = 24 XL fit-net ≈ 20–50 ms. For n = 24 L: building the raster takes ≈ 0.3 s once, and each cached raster frame ≈ 5 ms; vector frames (920 × 836, mixed terrain, milestone 12) take ≈ 14 ms at 3.3 px hexes, ≈ 70 ms at 5 px (the worst band: hex fills, no grid), 33–38 ms at 7–10 px with the grid, 7 ms at 21 px and under 2 ms beyond 40 px.
- **L-scale export** (Node, after milestone 12): a mixed n = 24 L panel ≈ 0.5 s / 2.7 MB; all-forest ≈ 1.2 s / 13.9 MB (≈ 0.35 s without embellishments). Creating an n = 24 L map ≈ 1.0–1.6 s (cached topology), writing ≈ 18 ms, parsing ≈ 13 ms.
- **File sizes:** n = 24 XL is about 11 KB. Every tile location written at 0.1 mi snaps back to its tile at n = 4/8/24 XL and 4/24 L.
- **Feature costs** (Node, n = 24 L): a 177-tile shortest path takes about 340 ms including first-use heuristic geometry; its 331 clipped-panel curve copies take about 3 ms to prepare. Every partial tile's visual anchor hit-tests back to that tile.
- **Edit costs** (n = 24 L): a 41-sample radius-3 stroke (6,401 tiles) takes ≈ 20 ms to apply; repainting ~1,000–2,800 changed tiles into the raster takes 40–90 ms (a full in-place redraw ≈ 0.25 s). Filling the whole world (218,088 tiles) takes ≈ 0.2 s in Node, and undoing it ≈ 3 ms. The partially repainted raster differs from a full rebuild in only 138–316 anti-aliased pixels (max 23/255).

## Plan complete

All twelve milestones are done; the editor reports v1.0.0. The user guide is [`../README.md`](../README.md) and the manual browser test is [`manual-checklist.md`](manual-checklist.md). Possible follow-ups are the open questions in plan §12 (merging sliver partial tiles, palette tuning) and any new requests in `prompt.md`.

## How to continue (for an unattended or auto-mode session)

For further work (new features from `prompt.md` or plan §12), work one change at a time. For each:

1. Read its section in `map-editor-plan.md`, together with the matching parts of `prompt.md`. **`prompt.md` wins any conflict.** If something isn't specified, make a reasonable choice and add it to plan §11 instead of stopping.
2. Implement it in `map-editor/index.html`. New modules follow plan §2: insert them in dependency order, keep `App` last, and mark DOM code `data-dom="true"`.
3. Add or extend `tests/<area>.test.cjs` using `require('./_load.cjs').loadModules()`. No npm packages.
4. Make sure the milestone ends green:
   ```
   node --test tests/
   python3 tools/generate_map_projection.py --labels --check
   ```
5. For UI milestones (5 and later), also check in a browser:
   - serve the repo with `python3 -m http.server 8000`;
   - open `http://localhost:8000/map-editor/index.html`;
   - confirm there are no console errors and that the new feature works.
6. Update this file: the summary table, the "What exists now" section, and the next step's checklist. Then commit with a descriptive message ending in the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.

### Rules

- Don't change the projection geometry in `tools/generate_map_projection.py`, and don't hand-edit the `doc/equilateral-chamfered-cube.*` files. If the tool changes, regenerate them with `--labels`.
- Everything the browser runs lives in `index.html`: no external JS, CSS, fonts or images.
- Follow [Copilot instructions](../.github/copilot-instructions.md): camelCase variables/functions in JavaScript, snake_case in Python, and UPPER_SNAKE_CASE fixed module constants. Never use Hungarian notation outside C and C++.
- Output must be deterministic (SVG, file writer, any randomness): use `Util.createRng` / `Util.hashIntegers`, never `Math.random`.

### Gotchas found so far

- Inside module code, never write a literal `</script>`, because it ends the HTML element; write `'<\/script>'`. Also avoid a literal `<!--`, for example an SVG comment: `_load.cjs` blanks out HTML comments before extracting scripts, so tests would see different code than the browser. Build it as `'<!' + '--'`.
- Modules are compiled in the test's own realm, so `assert.deepStrictEqual` works on the arrays they return. Don't switch to `vm.runInContext`.
- Playwright timed out when opening the SVG file directly. Wrap it in an HTML page with an `<img>` to view it.
- `Object.freeze` throws on a non-empty typed array. Freeze the containing object, but leave `Int32Array`/`Uint8Array` members unfrozen (`Topology` CSR arrays, future terrain arrays).
- Playwright screenshots in this headless setup can lag one frame behind evaluate-driven changes. Take the screenshot twice, or read `#status-message` / `RpgMap.App.state` to confirm the view.
