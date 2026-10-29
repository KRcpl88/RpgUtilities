# RpgUtilities

Utilities for fantasy role-playing games.

## World map editor (in progress)

`map-editor/index.html` is a single-file hex map editor. It uses only native
browser JavaScript, with no frameworks, build step, or external files. Open it
directly in a browser, or serve the repository locally:

```
python3 -m http.server 8000
# then browse to http://localhost:8000/map-editor/index.html
```

The specification is [`prompt.md`](prompt.md), the implementation plan is
[`doc/map-editor-plan.md`](doc/map-editor-plan.md), and progress is tracked in
[`doc/map-editor-status.md`](doc/map-editor-status.md).

### Code layout

| Path | Purpose |
| --- | --- |
| `map-editor/index.html` | The editor. Each `<script data-module="Name">` block registers `globalThis.RpgMap.Name`. |
| `tests/*.test.cjs` | Unit tests (Node's built-in test runner, no npm packages). |
| `tests/_load.cjs` | Loads the DOM-free modules from `index.html` for the tests. |
| `tests/fixtures/*.map.txt` | Sample map files in the editor's save format. |
| `doc/file-format.md` | Specification of the `.map.txt` save format. |
| `tools/generate_map_projection.py` | Builds and validates the chamfered-cube world projection. |
| `doc/equilateral-chamfered-cube.{json,svg}` | Projection geometry (reference data for the editor) and a diagram of the unfolded net. |

Module blocks appear in dependency order. Blocks marked `data-dom="true"` use
the browser DOM and are skipped by the tests; all other blocks must be DOM-free.

### Tests

Tested with Node.js 26. If Python 3.8+ is on the path, the tests also confirm
the projection exports are reproducible.

```
node --test tests/
```

### World projection

The global map is drawn on an unfolded equilateral chamfered cube: 12 hexagonal
and 6 square panels named after Greek letters. To regenerate or verify the
reference geometry:

```
python3 tools/generate_map_projection.py --labels          # write doc/ exports
python3 tools/generate_map_projection.py --labels --check  # verify they reproduce exactly
```

![Chamfered cube net](doc/equilateral-chamfered-cube.svg)
