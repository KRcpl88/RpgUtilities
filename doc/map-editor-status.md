# Global Map Editor: Plan Status

Last updated: 2026-10-29 (after milestone 8). See [`map-editor-plan.md`](map-editor-plan.md) for the full plan and [`../prompt.md`](../prompt.md) for the specification.

## Summary

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
| 9 | Local maps and scales | ⏭ **Next** |
| 10 | SVG export, part 1 | Pending |
| 11 | SVG export, part 2: terrain embellishments | Pending |
| 12 | Polish | Pending |

## What exists now (milestones 1–8)

- **`map-editor/index.html`**: the editor shell (toolbar, tool panel, canvas, properties panel, status bar) with thirteen modules.
  - `Util` (DOM-free): vector helpers, `Center`, `Boundary`, `Require`, `CreateRng` (mulberry32), `HashIntegers`, `FormatNumber`, and 2D geometry: `PolygonArea` (signed, CCW positive), `ClipPolygonToConvex` (Sutherland–Hodgman), `ClipSegmentToConvex` (returns `[t0, t1]` or null), `PointInConvex`.
  - `Projection` (DOM-free): a 1:1 port of the Python geometry, net and `Validate`, plus panel frames and seams. Exports `g_North`, `g_SectorLabels`, `g_SectorNames`, `g_dXlHexMiles`, `Build()`, `MilesPerEdge(nHexes)`, `FindSeam(szA, szB)`, `SolidToFrame`, `FrameToSolid`, and 2D transform helpers (`ApplyTransform`, `ComposeTransforms`, `InvertTransform`, `RigidFromSegments`).
  - `Lattice` (DOM-free): scale tables (`g_Scales`, regional XL/L/M/S = 216/72/24/8 mi; local in yards), flat-top offset ↔ axial ↔ cube ↔ point, `CubeRound`, `HexPolygon` (CCW from due east), `PointToOffset`, neighbours in order N, NE, SE, S, SW, NW (`g_rgrgnDirections`), `SharedEdge`, `OffsetDistance`, `NestOffset(q, j, r)`. Offset `(q, j)` centre = `(q·w, (j + ½·odd(q))·d)`.
  - `Topology` (DOM-free): `Build(n = 24, 'XL' | 'L')` (cached) returns `{ n, szScale, dD, dW, dHexArea, nTiles, rgTiles, Panels, rgnAdjacencyOffsets, rgnAdjacency }`.
    - Each tile: `{ nIndex, szPanel, nColumn, nRow, nLatticeColumn, nLatticeRow, rgdCenter, dArea, fPartial, rgPieces }` (frame edge units; plan §11.15–16).
    - `Panels[sz]`: `{ Lattice, nFirstTile, nTileCount, nColumns, nRows, nLatticeColumnMin, nLatticeRowMax, szWest, szEast }`.
    - Helpers: `TileAt(Topo, szPanel, [east, north])`, `LocateLattice`, `TileByColumnRow`, `Neighbors`, `AreAdjacent`, `TilePolygons`, `PanelLattice`, `LatticeCenter`, `LatticeNearest`.
    - Equatorial lattices are anchored on XL centres so finer scales nest (§11.14).
  - `Coordinates` (DOM-free): `TileToUniversal` / `UniversalToTile` (miles; returns −1 beyond 0.25·d), `FormatUniversal` (`Eta 187.1W 324.0N`), `ParseUniversal`, `PanelIdByName`, `MakeLocation`, `CreateLocalMap`, `LocalTileToUniversal`, `UniversalToLocalTile` (local x east, y south; regional anchors snap to the global lattice, §11.18).
  - `Terrain` (DOM-free): `g_rgTerrains` (17 frozen `{ nId, szChar, szKey, szName, szColor, fWater, Embellish }`, ID = row of plan §5, water = 0; `Embellish` is null until milestone 11), `g_szReservedChar` (`_`), `g_nWaterId`, `ById`, `ByChar`, `ByKey`, `IsValidId`, `IsWater`, and `g_rgLandmarkTypes` (village … dungeon) with `LandmarkType`, `IsLandmarkType`.
  - `Model` (DOM-free): `CreateGlobalMap({ nPanelHexes = 24, szTileScale = 'XL', szName })` and `CreateLocalMap({ nWidth, nHeight, szSystem, szScale, Anchor, nPanelHexes?, szName })`.
    - Document: `{ nVersion, szKind, szName, Global | Local, Topo (global only), nTiles, rgnTerrain: Uint8Array (water), Landmarks: Map<tile, {szType, szName, szNotes}>, rgOverlays: [{szId, szType, szName, szStyle, rgnTiles}], rgLabels: [{szId, nTile, szText, szCategory, dSize, dRotation, dDx, dDy}], nRevision }`. The document is mutable; its items are frozen and replaced on edit.
    - Mutators validate, apply, and return a change record `{ szLayer, Key, nIndex, Before, After }` or null for a no-op (plan §11.20): `SetTerrain`, `SetLandmark` (place/replace/edit; null removes), `RemoveLandmark`, `AddOverlay`/`UpdateOverlay`/`RemoveOverlay` (paths of adjacent tiles), `AddLabel`/`UpdateLabel`/`RemoveLabel`. `ApplyChange(Doc, Change, fForward)` replays a record and bumps `nRevision`.
    - Queries: `IsTile`, `Neighbors`, `AreAdjacent` (Topology for global maps; lattice offsets for local maps), `LocalTileIndex`/`LocalTileXY` (index = y·width + x), `GetTerrain`, `GetLandmark`, `GetOverlay`, `OverlaysAt`, `GetLabel`, `LabelsAt`.
  - `History` (DOM-free): `Create(Doc, { nLimit = 500 })`, `Begin`/`Record`/`Commit`/`Cancel` (a brush stroke is one command; repeats coalesce), `Perform(H, szLabel, (Doc, fnRecord) => …)`, `Undo`, `Redo` (return the command so the UI can redraw its tiles), `CanUndo`, `CanRedo`, `Clear`. A new command clears redo (plan §11.24).
  - `View` (DOM-free, plan §11.26–31): the camera and layouts.
    - Camera `{ dCenterX, dCenterY, dScale (px per edge unit), nWidth, nHeight }`: `CreateCamera`, `ResizeCamera`, `ClampScale` (4…400000), `WorldToScreenTransform`, `WorldToScreen`, `ScreenToWorld`, `Pan`, `ZoomAt` (keeps the cursor point fixed), `CenterOn`, `FitBounds`, `VisibleBounds`.
    - Bounds `[minX, minY, maxX, maxY]`: `BoundsOf`, `BoundsIntersect`, `UnionBounds`, `TransformBounds`.
    - Layouts (cached): `BuildNetLayout()` (18 placements at `rgdFrameToNet`) and `BuildFocusLayout(sz)` (neighbours through their seams, the focus panel last with the identity). A placement is `{ szPanel, szName, rgdFrameToWorld, rgdWorldToFrame, rgrgdOutline, rgdBounds, rgdCenter }`. `FindPlacement`, `PlacementAt` (the topmost placement containing a world point).
    - `PanelTileGroups(Topo, sz)` (cached): the panel's own tiles plus, for equatorial panels, the overhanging edge columns of the west/east strip neighbours with the seam transform. `VisibleTiles(Topo, Group, frameBounds)` culls by tile centre ± hex radius.
    - `HitTest(Topo, Layout, world)` → `{ nTile, szPanel, rgdFrame, szDrawPanel }` or null. It is exact, including partial pieces. `szPanel`/`rgdFrame` are the owning tile's panel and frame. A point inside an equatorial panel that falls in the tip of the strip neighbour's edge hex belongs to that neighbour's tile (plan §11.28, `prompt.md` "Map projection").
    - `DemoTerrain(Topo, nSeed)`: a deterministic `Uint8Array` world that uses all 17 terrains.
    - Feature geometry (§11.43–45): `PanelTransform`, `FeatureCopies`, `FeatureAnchor`, `OverlayCurves` (cached per immutable overlay; cubic segments per drawing panel), `CubicPoint`, `FlattenCurve` (half-pixel tolerance), `DistanceToSegment`, `LabelTransform`, `g_dLabelUnitsPerHex` (48). Curves and text/glyph copies cross seams through panel transforms, not net-space lines across cut edges. Partial tiles use a visible-piece anchor without changing saved coordinates or ownership.
  - `Edit` (DOM-free, plan §11.32–35, §11.41–42): terrain and feature editing logic.
    - `g_nMaxBrushRadius` (5); `BrushTiles(Doc, nCenter, nRadius)`: tiles within r adjacency steps, nearest first (crosses seams; 3r(r+1)+1 tiles in the interior).
    - `FloodRegion(Doc, nStart)`: the connected same-terrain region (BFS, no cap); `SegmentTiles(Topo, Layout, from, to)`: tiles under a world segment, sampled every d/4 with `View.HitTest`, without consecutive repeats.
    - `PaintTiles(Doc, rgnTiles, nId, fnRecord)` → changed tiles.
    - Strokes: `BeginStroke(History, nId, nRadius)` opens a `Paint <terrain>` command; `StrokeTo(Stroke, Layout, world)` stamps the brush on each new tile along the segment from the last point and returns the changed tiles; `EndStroke` commits (null if nothing changed).
    - `Fill(History, nStart, nId)` → `{ Command, rgnTiles }` as one `Fill <terrain>` command (Command null for a no-op); `CommandTiles(Command)` lists the terrain tiles a command changes (for redraws after undo/redo).
    - `FindPath(Doc, nFrom, nTo, Excluded = new Set())`: deterministic shortest A* path across the tile graph; unit cost, safe solid-space lower bound globally and hex distance locally; throws if unreachable.
    - `GetFeature(Doc, Selection)` / `SetFeature(History, szLayer, Key, Props)`: query or undoably create/edit/delete; null Key creates labels/overlays, landmarks use a tile key, null Props deletes. Identical edits are no-ops.
    - `ExtendOverlay`, `InsertOverlayPoint`, `RemoveOverlayPoint`, `SplitOverlay`, `JoinOverlays`: every operation is one command. Removal reroutes around the removed interior tile; split shares the junction; join orients chosen endpoints, fills any gap and keeps the first path's properties.
  - `FileFormat` (DOM-free, plan §6 and §11.38–39; full spec in [`file-format.md`](file-format.md)): `Write(Doc)` → canonical `*.map.txt` text; `Parse(szText)` → a new Doc (`nRevision` 0), or throws an Error with `nLine` (0 = whole file) and the message `Line N: …`.
    - Sections: `[map]`, `[legend]`, a `[panel <Name>]` per panel in Greek order (`columns`, `rows`, `latticeColumn`, `latticeRow`, grid lines north first, `_` = not a tile) or one `[local]`, then `[landmarks]`, `[labels]`, `[overlays]` with universal coordinates. Overlay points may leave out an unchanged panel.
    - Also exports `g_szMagic` (`# RPGMAP 1`), `g_szFileExtension` (`.map.txt`), `Quote`/`Tokenize` (quoted strings with `\"`, `\\`, `\uXXXX`), `CoordinateDecimals(hexMiles)` and `FileName(Doc)`.
  - `Renderer` (`data-dom="true"`): `Create(Canvas)`, `Draw(R, State)` → `{ fRaster, dHexPixels }`, `DrawMinimap(R, MiniCanvas, State)`.
    - Tiles are drawn per placement through frame → world → screen, clipped to the panel polygon, and batched by terrain colour in chunks of 512.
    - Below 4 px, cells are filled as w × d rects; below 3 px, a cached raster of the layout is used. The hex grid appears from 6 px.
    - Then: focus-view neighbour dimming, panel outlines (the focus panel in yellow), panel names, and the hovered tile.
    - The minimap shows the net raster with the view rectangle (net view) or the focus panel outline.
    - `MarkTilesChanged(R, Doc, rgnTiles)`: after an edit, cached rasters repaint just those tiles (integer-pixel boxes in every placement that draws them) on the next draw; above 3,000 tiles the raster is redrawn in place (plan §11.37). Colour buckets paint in terrain-id order.
    - The brush footprint (`State.rgnPreviewTiles`) is outlined with the hovered tile.
    - Features: smooth blue rivers, brown roads, dashed trails, eleven distinct landmark vector glyphs (`Terrain.g_rgLandmarkTypes[].szPath`), haloed labels with panel-relative size/rotation/offsets, selection outlines and label handles. Each panel clips its transformed copies, including cut-edge continuation.
    - `FeatureVisible` and `HitFeature(R, State, screen, filter)`: picking uses `R.rgFeatureHits` from the last draw and the topmost containing panel; hidden features do not enter the hit list. Label drag previews never mutate the document.
    - Feature-only changes call `MarkTilesChanged` with `[]`, retaining terrain rasters while updating their revision.
  - `App` (`data-dom="true"`, v0.5.0): `State { Doc, History, Layout, Camera, Layers, nHoverTile, rgnPreviewTiles, szTool, nTerrainId, nBrushRadius, Stroke, Selection, LabelPreview, LabelDrag, szMessage, … }`, starting with `Model.CreateGlobalMap()` (n = 24, XL) seeded with `View.DemoTerrain`.
    - Toolbar: New, Open…, Save (plan §11.40), Net view, Focus panel select, Fit all, Fit panel, Undo, Redo (disabled when unavailable). Tool panel: Pan / Brush / Fill / Pick buttons (`aria-pressed`), the brush radius slider (0–5, Brush only) and the active terrain swatch; then layer toggles (terrain, hex grid, panel outlines, panel names). The properties panel's terrain legend is the active-terrain picker (click or Enter/Space; default plain).
    - Input (plan §11.36): the left button drives the tool (Brush strokes, Fill click, Pick click; Alt+click picks with any tool); middle/right drag, Space+drag or the Pan tool pans; the wheel zooms about the cursor; a double-click focuses a panel (Pan tool only); a minimap click recentres or refocuses. Keys: `H B G I` tools, `[ ]` radius, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, Ctrl+S, Ctrl+O, arrows (Shift ×4), `+ = -`, Home, `F`, `N`, `P`.
    - Status bar: the hovered tile's universal coordinate · panel (letter) col/row (partial) · terrain · tile #, plus the last action (`Paint Forest: 116 tiles`, `Undo Fill Desert: 1,999 tiles`), the view, n/scale, tile count, hex px (raster) and version.
    - Feature tools (§11.46): Path (`O`), Landmark (`K`), Label (`T`), Select (`V`), Erase (`E`). Properties switches from the terrain legend to item fields and an overlapping-feature chooser. Path operations include explicit New/Extend/Insert/Remove/Split/Join/Finish controls; Escape finishes. Delete/Backspace deletes the selected visible item.
    - Label size and offsets are in 1/48-hex units. White/yellow handles move/rotate a preview; pointer-up commits one undo step; Escape/cancel/lost capture discards it. New label permits multiple labels per tile.
    - Layer toggles include roads, trails, rivers, landmarks and labels. Select/Erase can target a single layer/type; hidden features are protected. Terrain erase changes only the clicked tile to water. Status includes the hovered tile's landmark, overlays and labels.
    - Files (§11.40): New makes an all-water world of the same n/scale. Open parses the file; errors show `Line N: …` and keep the current map, and local maps are rejected until milestone 9. Save downloads `FileFormat.FileName(Doc)`. Dirty state is `Doc.nRevision ≠ State.nSavedRevision`; the status bar starts with `name *`, and New/Open/Restore confirm before discarding changes.
    - Autosave: 2 s after the last edit (and on `pagehide`) a dirty map goes to `localStorage['rpgmap.autosave']` as `{ szText, nTime }`; Save/Open/New clear it. On start a banner offers Restore or Discard (`#restore-banner`).
    - Exports `RpgMap.App = { g_szVersion, State, Start, ShowFocus, ShowNet, FitNet, FitPanel, SetTool, SetTerrain, SetBrushRadius, UndoOrRedo, NewMap, SaveMap, Autosave, IsDirty }`.
- **`Projection.Build()`** runs once, validates, and returns a deep-frozen object:
  - `Vertices`, `Faces`, `Edges`, `NetVertices`, `NetFaces`, `NetEdges` with the same IDs, order and fields as the golden JSON (edge maps are keyed `"V01|V09"`);
  - `rgszStrip` (net left to right), `rgszEquatorialWestToEast` (Epsilon … Zeta), `Validation`, `dEquatorialWidth` (1.759306);
  - `Panels[faceId]` = `{ szId, szLetter, szName, szKind, fEquatorial, Frame }`, and `Frames[faceId]`;
  - each frame: `rgdOrigin3D` (panel centre), unit `rgdEast3D`/`rgdNorth3D`/`rgdNormal3D`, `rgrgdPolygon` (frame `[east, north]` in edge units), `rgdOriginNet`/`rgdEastNet`/`rgdNorthNet`, `rgdFrameToNet`/`rgdNetToFrame`, and `szNorthVertex`/`szSouthVertex` (null for equatorial panels);
  - `Seams`: 48 entries `{ szEdge, rgszVertices, szPanelA, szPanelB, rgdAToB, rgdBToA }`.
- **Transforms** are `[a, b, c, d, e, f]` (canvas/SVG layout): `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Units are edge lengths; multiply by `MilesPerEdge(n)` for miles (plan §11.12).
- **`tests/_load.cjs`**: `LoadModules()` returns `RpgMap` built from the DOM-free blocks.
- **Tests** (123, all passing): `scaffold`, `util` (including the geometry helpers), `lattice`, `topology`, `coordinates`, `model` (terrain table vs plan §5, global/local documents, local adjacency, terrain/landmark/overlay/label undo-redo round trips, grouped strokes, Perform rollback, validation, history limit), `view` (camera round trips, zoom about a point, clamping, fit, net and focus layouts and shared seam edges, `HitTest` on every tile centre/piece centroid in the net and in every focus layout, random hits land inside the hit tile, seam ownership (equatorial edge-hex tips belong to the neighbour; elsewhere the containing panel), `PanelTileGroups`, culling keeps every tile touching the view, deterministic demo terrain), `edit` (brush sizes 3r(r+1)+1 for r = 0–5, brush = BFS distance ≤ r in order and across a seam, radius validation, flood fill of the whole world / a blob / across seams, segment tiles cover dense sampling and are connected, a stroke is one command that undoes and redoes exactly, empty strokes record nothing, fill inside a ring, fill no-op), `features` / `feature-renderer` (details below), `fileformat` (fixtures parse and are canonical; byte-identical round trips for global n = 4/24 XL and 4 L with landmarks, labels and overlays on partial tiles and across seams, and local maps at every regional and yard scale; every 7th tile location at n = 24 L snaps back; CRLF, comments, missing or remapped legend; optional item defaults; quoting; 26 error cases with their line numbers; file names), `projection-reference` (golden JSON counts and Python `--check`), and `projection.test.cjs`:
  - every solid/net vertex, edge and face deep-equals the golden JSON within 1e-9; validation summary matches;
  - frames are orthonormal, east = north × normal, origins at panel centres, frame→net placement and frame→solid round trips;
  - equatorial north/east are +y/+x in the net, centres on y = 0.122008, east/west edges at ±W/2;
  - other panels: north vertex and south vertex are opposite and on east = 0; Eta/Theta/Iota contain V05, Kappa/Lambda/Mu contain V04;
  - seams are rotations, A→B→A is the identity, shared endpoints map onto each other, B unfolds to the far side of the edge, net folds agree;
  - the equatorial strip wraps (Zeta → Epsilon) with a pure translation of −W east;
  - `MilesPerEdge(24)` ≈ 2551.8.
- **Milestone 8 coverage:** A* versus independent BFS, crossings of all 48 seams, exclusions/unreachable paths, exact undo/redo/save round trips for every feature operation, split/join endpoint orientations, one-landmark and multiple-label behavior, partial-tile anchors, matching seam curves/tangents, adaptive hit geometry and label transforms. Renderer canvas-contract tests cover visibility/picking, label previews/handles and raster reuse.
- **Browser check:** cross-seam river in focus/net views; path insert/remove/split/join; landmark replacement; multiple labels and feature chooser; property validation; move/rotate/cancel and undo; target-layer selection/erase and hidden-layer protection; terrain erase/undo; Ctrl+S download, New/Open round trip and autosave restore. No console errors.
- **`doc/file-format.md`** (the `.map.txt` spec) and **`tests/fixtures/sample-global.map.txt`** (n = 4 XL demo terrain; landmarks with escaped strings; labels; a river crossing a seam) / **`sample-local.map.txt`** (12 × 8 regional M map at `Eta 187.1W 324.0N` with a road).
- **`tools/generate_map_projection.py`** and **`doc/equilateral-chamfered-cube.{json,svg}`**: unchanged since milestone 1.

### Checked numerically

- **Net size:** total area 36.9096 edge². Squares are 1.0 each; hexagons are 2.5758 each.
- **Equatorial panels:** Alpha–Zeta have `normal·North = 0`; width 1.759306 edge units; all centres at net y = 0.122008.
- **Non-equatorial north/south vertices:** Eta V05/V07, Theta V05/V01, Iota V05/V06, Kappa V03/V04, Lambda V02/V04, Mu V08/V04, Nu V29/V27, Xi V21/V18, Omicron V13/V16, Pi V09/V12, Rho V30/V28, Sigma V23/V20.
- **At n = 24 XL:** d = 0.0846446 edge units; panel edge ≈ 2551.8 mi; equatorial circumference ≈ 26,936.9 mi; equatorial panel width ≈ 4489.5 mi.
- **Tile counts** (total / partial, build time): n = 4 XL 264 / 180; n = 8 XL 882 / 390; n = 24 XL 6,564 / 1,218 (~0.1 s); n = 4 L 6,570 / 1,224; n = 24 L 218,088 / 7,572 (~1 s). Tile areas sum to the panel areas, and the tile graph is connected in every case.
- **Draw times** (headless Chromium, 920 × 790 canvas): n = 24 XL fit-net ≈ 20–50 ms. For n = 24 L: building the raster takes ≈ 0.3 s once, and each cached raster frame ≈ 5 ms; vector frames at 3.7–22 px hexes take 10–85 ms.
- **File sizes:** n = 24 XL is about 11 KB. Every tile location written at 0.1 mi snaps back to its tile at n = 4/8/24 XL and 4/24 L.
- **Feature costs** (Node, n = 24 L): a 177-tile shortest path takes about 340 ms including first-use heuristic geometry; its 331 clipped-panel curve copies take about 3 ms to prepare. Every partial tile's visual anchor hit-tests back to that tile.
- **Edit costs** (n = 24 L): a 41-sample radius-3 stroke (6,401 tiles) takes ≈ 20 ms to apply; repainting ~1,000–2,800 changed tiles into the raster takes 40–90 ms (a full in-place redraw ≈ 0.25 s). Filling the whole world (218,088 tiles) takes ≈ 0.2 s in Node, and undoing it ≈ 3 ms. The partially repainted raster differs from a full rebuild in only 138–316 anti-aliased pixels (max 23/255).

## Next step: milestone 9 (local maps and scales)

Read plan §4.2, §4.8, §7 ("File") and `prompt.md` "Scale" / "Universal Coordinate system". Local documents, coordinate snapping, adjacency, file parsing/writing and feature-edit commands already exist. The renderer and most App viewport/terrain-input paths still assume `Doc.Topo`.

1. **New-map dialog:** choose global (positive even panelHexes, L/XL tile scale) or local (regional/yard system, S/M/L/XL size, positive width/height, universal anchor), with a map name and validation. Keep unsaved-change protection.
2. **Local viewport:** flat rectangular lattice, row 0 north, parity from `Doc.Local`; camera fit, hit testing, hover coordinates and optional local navigator. Disable global-only panel focus controls for local maps.
3. **Terrain editing:** adapt stroke interpolation/hit testing and preview/rendering to local maps, preserving brush/fill/undo behavior at rectangle edges.
4. **Feature rendering and tools:** adapt feature anchors, path geometry, label transforms/handles, selection and status to local coordinates. Reuse the existing model, A* and command helpers; maintain physical label units and every layer toggle.
5. **Files/autosave:** remove the App local-map rejection; opening/restoring both kinds resets appropriate layout, history and selection. Existing local fixtures must open, render, edit and save canonically.
6. **Coordinate validation:** regional anchors snap to their nested lattice; yard-scale anchors remain free. Verify every configured scale against `prompt.md`, including universal coordinates after creating/opening local maps.
7. **Tests/browser:** local hit testing, bounds and edge strokes; anchor/scale round trips; every feature tool and undo; global-to-local and local-to-global New/Open/Restore transitions; save/reopen with no console errors.

## How to continue (for an unattended or auto-mode session)

Work one milestone at a time, in order. For each milestone:

1. Read its section in `map-editor-plan.md`, together with the matching parts of `prompt.md`. **`prompt.md` wins any conflict.** If something isn't specified, make a reasonable choice and add it to plan §11 instead of stopping.
2. Implement it in `map-editor/index.html`. New modules follow plan §2: insert them in dependency order, keep `App` last, and mark DOM code `data-dom="true"`.
3. Add or extend `tests/<area>.test.cjs` using `require('./_load.cjs').LoadModules()`. No npm packages.
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
- Follow the naming style: PascalCase functions; Hungarian prefixes `sz`, `d`, `n`, `f`, `rg`, `g_`.
- Output must be deterministic (SVG, file writer, any randomness): use `Util.CreateRng` / `Util.HashIntegers`, never `Math.random`.

### Gotchas found so far

- Inside module code, never write a literal `</script>`, because it ends the HTML element; write `'<\/script>'`. Also avoid a literal `<!--`, for example an SVG comment: `_load.cjs` blanks out HTML comments before extracting scripts, so tests would see different code than the browser. Build it as `'<!' + '--'`.
- Modules are compiled in the test's own realm, so `assert.deepStrictEqual` works on the arrays they return. Don't switch to `vm.runInContext`.
- Playwright timed out when opening the SVG file directly. Wrap it in an HTML page with an `<img>` to view it.
- `Object.freeze` throws on a non-empty typed array. Freeze the containing object, but leave `Int32Array`/`Uint8Array` members unfrozen (`Topology` CSR arrays, future terrain arrays).
- Playwright screenshots in this headless setup can lag one frame behind evaluate-driven changes. Take the screenshot twice, or read `#status-message` / `RpgMap.App.State` to confirm the view.
