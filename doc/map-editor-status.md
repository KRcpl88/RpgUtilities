# Global Map Editor: Plan Status

Last updated: 2026-10-29 (after milestone 1). See [`map-editor-plan.md`](map-editor-plan.md) for the full plan and [`../prompt.md`](../prompt.md) for the specification.

## Summary

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold: HTML shell, module convention, test loader, Util, projection tool, golden JSON | ✅ Done |
| 2 | Projection: JS port, validation, panel frames, seam transforms | ⏭ **Next** |
| 3 | Lattice and Topology: flat-top lattice, equatorial strip, partial tiles, adjacency, universal coordinates | Pending |
| 4 | Terrain table, Model, History | Pending |
| 5 | Renderer and viewport | Pending |
| 6 | Terrain tools | Pending |
| 7 | ASCII file format | Pending |
| 8 | Overlays, landmarks, labels | Pending |
| 9 | Local maps and scales | Pending |
| 10 | SVG export, part 1 | Pending |
| 11 | SVG export, part 2: terrain embellishments | Pending |
| 12 | Polish | Pending |

## What exists now (milestone 1)

- **`map-editor/index.html`**: the editor shell (toolbar, tool panel, canvas, properties panel, status bar) with two modules.
  - `Util` (DOM-free): vector helpers, `Center`, `Boundary`, `Require`, `CreateRng` (mulberry32), `HashIntegers`, `FormatNumber`.
  - `App` (`data-dom="true"`): sizes the canvas, draws a "No map loaded" placeholder, and lists the loaded modules in the status bar.
- **`tests/_load.cjs`**: `LoadModules()` returns `RpgMap` built from the DOM-free blocks; `ExtractModules()` and `ExtractScripts()` are used by the convention tests.
- **Tests** (12, all passing):
  - `scaffold.test.cjs`: no external scripts or stylesheets, one uniquely named module per script, Util first and App last, wrapper and `Object.freeze` registration, DOM-free modules load in Node;
  - `util.test.cjs`;
  - `projection-reference.test.cjs`: golden JSON counts, and runs `generate_map_projection.py --labels --check` when Python is installed.
- **`tools/generate_map_projection.py`**: geometry and validation from `prompt.md`; the SVG export, SVG validation and CLI (`--labels`, `--check`, `--output-dir`) were written for this repo.
- **`doc/equilateral-chamfered-cube.{json,svg}`**: generated with `--labels`. The JSON is the golden reference for milestone 2.

### Checked numerically (from the golden JSON)

- **Net size:** total area 36.9096 edge². Squares are 1.0 each; hexagons are 2.5758 each.
- **Equatorial panels:** Alpha–Zeta have `normal·North = 0`.
  - In the net, north is +y; each panel has two vertical east/west edges, 1.759306 edge units apart.
  - All six centres sit at net y = 0.122008 (the equator).
- **Other panels:** each has a single north vertex along the projection of `North = (1,-1,-1)/√3`. For Eta, Theta and Iota it is V05, the north pole.
- **At n = 24 XL:** d = 0.0846446 edge units; panel edge ≈ 2551.8 mi; equatorial circumference ≈ 26,936.9 mi; ≈ 5,949 XL tiles in total.

## Next step: milestone 2 (Projection)

Add a `<script data-module="Projection">` block right after `Util`, plus `tests/projection.test.cjs`:

1. Port `BuildSolidVertices`, `BuildSolid`, `InitializeNet`, `AddNetVertex`, `AttachNetFace`, `BuildNetEdges` and `BuildNet` exactly, keeping IDs and order identical to the Python.
   - Python `sorted()` on ID strings and tuples must give the same order in JS.
   - Python's `product((-1, 1), repeat=3)` order is the last axis fastest.
2. Port `Validate` and its helpers.
3. Export `g_SectorLabels`, `g_SectorNames`, `g_North`, and `Build()`, which returns the net, `panels`, `frames` and `seams` (plan §3). Cache the result after the first call.
4. **Tests:**
   - Deep-compare every vertex, edge and face against `doc/equilateral-chamfered-cube.json` within 1e-9.
   - Validation passes.
   - Frames are orthonormal, equatorial north is +y in the net, and east = north × outward normal.
   - Each seam's A→B transform followed by B→A is the identity, and it maps the shared edge onto itself.

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
