# Global Map Editor: Plan Status

Last updated: 2026-10-29 (after milestone 4). See [`map-editor-plan.md`](map-editor-plan.md) for the full plan and [`../prompt.md`](../prompt.md) for the specification.

## Summary

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold: HTML shell, module convention, test loader, Util, projection tool, golden JSON | ✅ Done |
| 2 | Projection: JS port, validation, panel frames, seam transforms | ✅ Done |
| 3 | Lattice and Topology: flat-top lattice, equatorial strip, partial tiles, adjacency, universal coordinates | ✅ Done |
| 4 | Terrain table, Model, History | ✅ Done |
| 5 | Renderer and viewport | ⏭ **Next** |
| 6 | Terrain tools | Pending |
| 7 | ASCII file format | Pending |
| 8 | Overlays, landmarks, labels | Pending |
| 9 | Local maps and scales | Pending |
| 10 | SVG export, part 1 | Pending |
| 11 | SVG export, part 2: terrain embellishments | Pending |
| 12 | Polish | Pending |

## What exists now (milestones 1–4)

- **`map-editor/index.html`**: the editor shell (toolbar, tool panel, canvas, properties panel, status bar) with nine modules.
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
  - `App` (`data-dom="true"`): sizes the canvas, draws a "No map loaded" placeholder, and lists the loaded modules in the status bar.
- **`Projection.Build()`** runs once, validates, and returns a deep-frozen object:
  - `Vertices`, `Faces`, `Edges`, `NetVertices`, `NetFaces`, `NetEdges` with the same IDs, order and fields as the golden JSON (edge maps are keyed `"V01|V09"`);
  - `rgszStrip` (net left to right), `rgszEquatorialWestToEast` (Epsilon … Zeta), `Validation`, `dEquatorialWidth` (1.759306);
  - `Panels[faceId]` = `{ szId, szLetter, szName, szKind, fEquatorial, Frame }`, and `Frames[faceId]`;
  - each frame: `rgdOrigin3D` (panel centre), unit `rgdEast3D`/`rgdNorth3D`/`rgdNormal3D`, `rgrgdPolygon` (frame `[east, north]` in edge units), `rgdOriginNet`/`rgdEastNet`/`rgdNorthNet`, `rgdFrameToNet`/`rgdNetToFrame`, and `szNorthVertex`/`szSouthVertex` (null for equatorial panels);
  - `Seams`: 48 entries `{ szEdge, rgszVertices, szPanelA, szPanelB, rgdAToB, rgdBToA }`.
- **Transforms** are `[a, b, c, d, e, f]` (canvas/SVG layout): `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Units are edge lengths; multiply by `MilesPerEdge(n)` for miles (plan §11.12).
- **`tests/_load.cjs`**: `LoadModules()` returns `RpgMap` built from the DOM-free blocks.
- **Tests** (74, all passing): `scaffold`, `util` (including the geometry helpers), `lattice`, `topology`, `coordinates`, `model` (terrain table vs plan §5, global/local documents, local adjacency, terrain/landmark/overlay/label undo-redo round trips, grouped strokes, Perform rollback, validation, history limit), `projection-reference` (golden JSON counts and Python `--check`), and `projection.test.cjs`:
  - every solid/net vertex, edge and face deep-equals the golden JSON within 1e-9; validation summary matches;
  - frames are orthonormal, east = north × normal, origins at panel centres, frame→net placement and frame→solid round trips;
  - equatorial north/east are +y/+x in the net, centres on y = 0.122008, east/west edges at ±W/2;
  - other panels: north vertex and south vertex are opposite and on east = 0; Eta/Theta/Iota contain V05, Kappa/Lambda/Mu contain V04;
  - seams are rotations, A→B→A is the identity, shared endpoints map onto each other, B unfolds to the far side of the edge, net folds agree;
  - the equatorial strip wraps (Zeta → Epsilon) with a pure translation of −W east;
  - `MilesPerEdge(24)` ≈ 2551.8.
- **`tools/generate_map_projection.py`** and **`doc/equilateral-chamfered-cube.{json,svg}`**: unchanged since milestone 1.

### Checked numerically

- **Net size:** total area 36.9096 edge². Squares are 1.0 each; hexagons are 2.5758 each.
- **Equatorial panels:** Alpha–Zeta have `normal·North = 0`; width 1.759306 edge units; all centres at net y = 0.122008.
- **Non-equatorial north/south vertices:** Eta V05/V07, Theta V05/V01, Iota V05/V06, Kappa V03/V04, Lambda V02/V04, Mu V08/V04, Nu V29/V27, Xi V21/V18, Omicron V13/V16, Pi V09/V12, Rho V30/V28, Sigma V23/V20.
- **At n = 24 XL:** d = 0.0846446 edge units; panel edge ≈ 2551.8 mi; equatorial circumference ≈ 26,936.9 mi; equatorial panel width ≈ 4489.5 mi.
- **Tile counts** (total / partial, build time): n = 4 XL 264 / 180; n = 8 XL 882 / 390; n = 24 XL 6,564 / 1,218 (~0.1 s); n = 4 L 6,570 / 1,224; n = 24 L 218,088 / 7,572 (~1 s). Tile areas sum to the panel areas, and the tile graph is connected in every case.

## Next step: milestone 5 (Renderer and viewport)

Read plan §7 ("Layout", "Viewport", "Global view", "Layers") and `prompt.md` "Map projection". Add a `Renderer` module (`data-dom="true"`) before `App`, keep geometry that can be tested DOM-free (view transforms, culling, hit testing) in a DOM-free helper or in `Renderer`'s pure functions exposed for tests, and extend `App`:

1. **View state:** net-space camera (centre, zoom); screen ↔ net ↔ panel-frame transforms via `Projection.Frames[sz].rgdFrameToNet`. Pan with drag or the arrow keys, wheel zoom around the cursor, *fit net* and *fit panel* buttons.
2. **Drawing:** for each panel, set the frame→net→screen transform, clip to the panel polygon, fill visible tiles batched by `Terrain` colour (`Topology.TilePolygons`), then panel outlines and Greek names; optional hex grid. Cull tiles by panel bounding box and tile centre. When zoomed far out, fall back to an `ImageData` / coarse fill.
3. **Panel focus view:** one panel north-up, with neighbouring panels unfolded across seams (`Projection.Seams[...].rgdAToB`).
4. **Minimap:** a small clickable net that recentres the main view.
5. **Status bar:** hovered tile → `Coordinates.FormatUniversal(TileToUniversal(...))`, panel name, terrain name; use `Topology.LocateLattice` / a point-in-tile test for hit testing.
6. **Layer toggles:** terrain, hex grid, panel outlines (overlays/landmarks/labels come in milestone 8).
7. On start, create `Model.CreateGlobalMap()` (n = 24, XL) and seed a few terrain tiles so colours are visible; keep a `History` instance on the app state for milestone 6.
8. **Tests:** add `tests/renderer.test.cjs` for the pure parts (screen ↔ net round trips, zoom about a point keeps it fixed, culling keeps every on-screen tile, hit test returns the tile whose centre is nearest). Browser check: no console errors, pan/zoom/fit work, hover shows coordinates.

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
