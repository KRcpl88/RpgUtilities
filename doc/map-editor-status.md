# Global Map Editor: Plan Status

Last updated: 2026-10-29 (after milestone 2). See [`map-editor-plan.md`](map-editor-plan.md) for the full plan and [`../prompt.md`](../prompt.md) for the specification.

## Summary

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold: HTML shell, module convention, test loader, Util, projection tool, golden JSON | ✅ Done |
| 2 | Projection: JS port, validation, panel frames, seam transforms | ✅ Done |
| 3 | Lattice and Topology: flat-top lattice, equatorial strip, partial tiles, adjacency, universal coordinates | ⏭ **Next** |
| 4 | Terrain table, Model, History | Pending |
| 5 | Renderer and viewport | Pending |
| 6 | Terrain tools | Pending |
| 7 | ASCII file format | Pending |
| 8 | Overlays, landmarks, labels | Pending |
| 9 | Local maps and scales | Pending |
| 10 | SVG export, part 1 | Pending |
| 11 | SVG export, part 2: terrain embellishments | Pending |
| 12 | Polish | Pending |

## What exists now (milestones 1–2)

- **`map-editor/index.html`**: the editor shell (toolbar, tool panel, canvas, properties panel, status bar) with three modules.
  - `Util` (DOM-free): vector helpers, `Center`, `Boundary`, `Require`, `CreateRng` (mulberry32), `HashIntegers`, `FormatNumber`.
  - `Projection` (DOM-free): a 1:1 port of the Python geometry, net and `Validate`, plus panel frames and seams. Exports `g_North`, `g_SectorLabels`, `g_SectorNames`, `g_dXlHexMiles`, `Build()`, `MilesPerEdge(nHexes)`, `FindSeam(szA, szB)`, `SolidToFrame`, `FrameToSolid`, and 2D transform helpers (`ApplyTransform`, `ComposeTransforms`, `InvertTransform`, `RigidFromSegments`).
  - `App` (`data-dom="true"`): sizes the canvas, draws a "No map loaded" placeholder, and lists the loaded modules in the status bar.
- **`Projection.Build()`** runs once, validates, and returns a deep-frozen object:
  - `Vertices`, `Faces`, `Edges`, `NetVertices`, `NetFaces`, `NetEdges` with the same IDs, order and fields as the golden JSON (edge maps are keyed `"V01|V09"`);
  - `rgszStrip` (net left to right), `rgszEquatorialWestToEast` (Epsilon … Zeta), `Validation`, `dEquatorialWidth` (1.759306);
  - `Panels[faceId]` = `{ szId, szLetter, szName, szKind, fEquatorial, Frame }`, and `Frames[faceId]`;
  - each frame: `rgdOrigin3D` (panel centre), unit `rgdEast3D`/`rgdNorth3D`/`rgdNormal3D`, `rgrgdPolygon` (frame `[east, north]` in edge units), `rgdOriginNet`/`rgdEastNet`/`rgdNorthNet`, `rgdFrameToNet`/`rgdNetToFrame`, and `szNorthVertex`/`szSouthVertex` (null for equatorial panels);
  - `Seams`: 48 entries `{ szEdge, rgszVertices, szPanelA, szPanelB, rgdAToB, rgdBToA }`.
- **Transforms** are `[a, b, c, d, e, f]` (canvas/SVG layout): `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Units are edge lengths; multiply by `MilesPerEdge(n)` for miles (plan §11.12).
- **`tests/_load.cjs`**: `LoadModules()` returns `RpgMap` built from the DOM-free blocks.
- **Tests** (24, all passing): `scaffold`, `util`, `projection-reference` (golden JSON counts and Python `--check`), and `projection.test.cjs`:
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
- **At n = 24 XL:** d = 0.0846446 edge units; panel edge ≈ 2551.8 mi; equatorial circumference ≈ 26,936.9 mi; ≈ 5,949 XL tiles in total.

## Next step: milestone 3 (Lattice and Topology)

Read plan §4 and `prompt.md` "Map projection", "Scale" and "Universal Coordinate system". Add modules `Lattice`, `Topology` and `Coordinates` after `Projection`, plus `tests/{lattice,topology,coordinates}.test.cjs`:

1. **`Lattice`** (§4.1–4.2): scale tables (regional and local), flat-top offset ↔ cube ↔ point conversions, hex polygon, point → hex hit test, scale nesting (coarse `(C, J)` = fine `(r·C, r·J)`).
2. **`Topology`** (§4.3–4.6), for a given `nPanelHexes` and tile scale (XL or L):
   - equatorial panels: continuous lattice, columns at `(i+½)·w` from the west edge, odd columns +½ hex north, whole tiles at east/west edges;
   - other panels: primary column on the bisector, hex (0,0) at the reference point, odd |c| shifted ½ hex north;
   - partial tiles clipped to the panel polygon (overlap > 1e-6 of a hex), dense tile index, clipped polygons;
   - CSR adjacency (`Int32Array`), symmetric, using seam transforms across non-equatorial seams and lattice adjacency across equatorial east/west seams.
3. **`Coordinates`** (§4.7): `TileToUniversal` / `UniversalToTile` in miles (snap, reject > 0.25·d), formatting like `Eta 187.1W 324.0N`.
4. **Tests** for n ∈ {4, 8, 24}: round trips; partial-tile areas sum to the panel area; equatorial columns = n·ratio with no east/west partials; primary column on the bisector; interior tiles have 6 neighbours; adjacency symmetric and connected; strip wraps; at n = 24 XL the equatorial width ≈ 4489 mi and no equatorial hex has east = 0.

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
