# RpgUtilities

Utilities for fantasy role-playing games.

## World map editor

`map-editor/index.html` is a single-file hex map editor. It uses only native
browser JavaScript, with no frameworks, build step, or external files. Open it
directly in a browser, or serve the repository locally:

```
python3 -m http.server 8000
# then browse to http://localhost:8000/map-editor/index.html
```

The specification is [`prompt.md`](prompt.md), the implementation plan is
[`doc/map-editor-plan.md`](doc/map-editor-plan.md), and progress is tracked in
[`doc/map-editor-status.md`](doc/map-editor-status.md). To check a build by hand,
follow [`doc/manual-checklist.md`](doc/manual-checklist.md).

### Quick start

1. Open the editor. It starts with a demo world; **Open** a sample from
   `map-editor/samples/` to see every terrain and feature:
   - `sample-world.map.txt`: a small (n = 8, 216-mile hex) world with roads, a
     trail and a river crossing panel seams, landmarks and labels.
   - `sample-valley.map.txt`: a 36 × 26 local map of 6-mile hexes containing all
     17 terrains, every landmark type, road/trail/river and every label category.
2. Pick a terrain in the Properties legend and paint with **Brush (B)** or
   **Fill (G)**. **Pick (I)** (or Alt+click) copies a tile's terrain.
3. Pan with the middle/right button, Space+drag or arrow keys; zoom with the
   wheel or `+`/`-`. **Home** fits the map; double-click (Pan tool) or `P`
   focuses a panel, and `N` returns to the net view.
4. **Save** (Ctrl+S) downloads a `.map.txt`; **Export SVG** downloads a picture.

### Navigation and the status bar

The global world is an unfolded chamfered cube of 18 panels. The net view shows
them all; the focus view shows one panel with its neighbours folded around it
through their seams, so drawing and paths continue across panel edges. The
minimap recentres the view (or refocuses a panel) on click.

The status bar describes the hovered tile: its universal coordinate (panel name
and miles east/west and north/south of the panel reference point, as saved in
files), panel column/row, terrain, features, and its **true latitude and
longitude**, for example `true 35.26°N 30.00°W (true N 12.3°E of panel N)`.
True coordinates are a central projection onto a sphere: the prime meridian
passes through Eta's centre, and longitude runs west along the equatorial
panels (Alpha is centred on 30°W). The note in parentheses is the direction of
true north relative to the panel's up direction (equal on equatorial panels).
True coordinates are shown only; files always store universal coordinates.
Properties for a selected landmark or label show the same information.

### Creating and opening maps

**New** creates an all-water global world, single panel or local rectangle. World
panel size is always an even count of **XL hexes**, independent of tile scale.
Global worlds use regional L (36 mi) or XL (216 mi) tiles. **Single panel** lets
you select any of the 18 panels and use M (6 mi), L or XL tiles; it contains the
complete panel only, including clipped edge hexes, with no neighbours or wrapping.
Local maps take a
width, height and universal anchor for tile (0, 0), such as `Eta 187.1W 324.0N`.

| Local-map system | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Regional | 1 mi | 6 mi | 36 mi | 216 mi |
| Local | 1 yd | 10 yd | 100 yd | 600 yd |

Regional anchors snap to their same-scale world lattice; the dialog previews the
result. Yard-scale anchors remain free.

Equatorial east/west panel boundaries lie between columns at every resolution;
the first and last owned columns are half a column spacing inside those edges.
Files use `# RPGMAP 2` after this alignment correction. Version 1 files are rejected,
not automatically migrated.

A regional local map (1 mi per hex or larger) that crosses panel seams follows the
global map's rules at each seam. It uses whole edge hexes at equatorial east/west
seams and clipped partial tiles at other seams. Its hexes turn to match each panel's
grid, so the map looks bent at the seam. It may cross several seams, but it stops
short of any panel corner where several panels meet: the dialog shows the reduced
size and the panels crossed. Yard-scale maps always stay one flat grid, as do local
files saved with a `[local]` section. All terrain and feature tools work on all
three map kinds.

**Crop…** copies part of any map into a new local map of any size, scale and anchor.
The anchor starts out centred on the selected tile or the view centre. Choose
**Entire panel** to crop a complete panel at XL, L or M, rescaling in the same step;
**Download** exports an editable `.map.txt` without changing the open map. **Rescale…**
changes the hex size of the open map:

- global worlds: XL or L;
- single panels: XL, L or M;
- local maps: any regional or yard scale, keeping the same ground and north-west corner.

Both use the same resampling. Smaller hexes repeat the tile they lie in. Larger hexes
take the most common terrain of the tiles they cover. Landmarks, labels, roads, trails
and rivers follow their tiles. Each dialog can open the result in place of the current
map (unsaved, with no undo history) or download it. **Fit all** and the minimap navigate every kind;
panel focus with neighbours and net-view controls apply only to global worlds.

The **Equator and poles** layer shows a red equator and crosshair circles labeled
N/S at the true poles. It is virtual reference geometry, not editable map data,
and can also be toggled independently in SVG export. Polar exports include a
small transparent margin so the full circle and crosshairs remain visible.

**Open** accepts all three kinds of `.map.txt`, including the samples in
`map-editor/samples/` and the test fixtures in `tests/fixtures/`. **Save** (Ctrl+S) downloads a canonical text file. New maps start
unsaved and are autosaved even before their first edit. Canceling New or rejecting
its discard confirmation preserves the current map.

**Import / merge…** reads another `.map.txt` into the open map without changing its
name, extent or hex size. Imported terrain and features replace the contents of
overlapping hexes, including imported water; existing content outside that area
is preserved. A panel or local rectangle clips the import at its boundary, and
an entirely outside file changes nothing. Smaller/larger incoming hexes use the
same repeat/majority resampling as Crop and Rescale. Crossing paths are split at
the replacement boundary, feature IDs are made unique, and label sizes/offsets
retain their ground size. The entire merge is one undo step.

Both files must use the same world panel size and hex system: regional (miles) or
local (yards). A rectangular map using regional hexes can merge with a globe or
panel. Yard-scale and mile-scale hexes cannot be mixed.

### Feature editing

Use **Path (O)** to draw a road, trail or river: choose its type, click **New path**,
then click tiles to extend it. Gaps follow the shortest connected tile path across
panel seams. **Escape** finishes the path. Select a path to edit its name/style,
insert or remove a point, split at an interior point, or join another path of the
same type. Joining keeps the selected path's name/style.

**Landmark (K)** places one landmark per tile; its type, name and notes are editable
in Properties. **Label (T)** adds text with per-label category, size, rotation and
offsets. Drag a selected label's white handle to move it or its yellow handle to
rotate it; Escape cancels the drag. **New label** allows multiple labels on a tile.
Label size and offsets use 48 units per hex height and scale with zoom.

**Select (V)** and **Erase (E)** have a target-layer selector. Overlapping features
can be selected individually using **Features on this tile** in Properties.
Hidden layers cannot be selected or erased. Delete/Backspace deletes the selected
visible feature. Each property change, path operation and completed label drag is
one undo step (Ctrl+Z; Ctrl+Y to redo). Changes are included in Save (Ctrl+S) and
browser autosave.

### SVG export

**Export SVG** downloads one selected global panel, the complete single-panel map,
or the entire local map, north-up. Choose the output width (default 1600 px); height preserves the map's aspect
ratio. Layer options include terrain colours, terrain embellishments, smoothed
shorelines, hex grid, roads, trails, tapered rivers, landmarks, optional landmark
names, labels, and the equator/poles reference layer.
The initial visibility follows the canvas where applicable, but export settings
do not change the canvas.

**Shorelines** draws every shared boundary between water (including islands,
lakes and firth) and land with a deterministic, gently wandering curve. There is
one point per hex edge, displaced from its midpoint along the centre-to-face ray
by up to 30% of a hex's full width. The smooth curve passes directly between these
points without interpolating hex corners; short clipped edges vary less.
When terrain colours are enabled, both adjacent fills follow that
same curve; embellishments are clipped to the adjusted regions. Turning
Shorelines off restores the original hex-edge fills. Canvas rendering and saved
terrain are unchanged.

The SVG is self-contained and deterministic, with transparent space outside the
map and where terrain colours are omitted. Regions preserve holes; panel edges
are clipped without inventing coastlines along the cut. Feature placement and
rotation follow the editor, including seam copies and partial tiles. Export
does **not** save the editable map, clear its unsaved indicator, or change undo
history; use Save for `.map.txt`.

Terrain embellishments draw a pattern for every terrain except plain and open
water: hill curves, mountain peaks, dunes, tree crowns with trunks along a
forest's southern edge, marsh grass, field patchworks, and so on. Patterns
continue across neighbouring tiles of the same terrain and are clipped to their
own terrain region. With terrain colours off, filled motifs (crowns, islands,
fields) are white.

### Large maps and performance

An n = 24 world with L (36-mile) hexes has 218,070 tiles. Building it takes about
a second ("Building map…" shows meanwhile); painting, filling and undo stay
interactive. Zoomed far out, the map is drawn from a cached image; the hex grid
appears once hexes are at least 8 px across.

Terrain embellishments dominate SVG size: about 1 KB per embellished tile. A full
L-scale panel can reach 10–14 MB and take a second or two to export. The export
dialog warns when an export is likely to exceed about 4 MB; turning off
**Terrain embellishments** makes such files far smaller. The status bar reports
each export's size and time.

### Code layout

| Path | Purpose |
| --- | --- |
| `map-editor/index.html` | The editor. Each `<script data-module="Name">` block registers `globalThis.RpgMap.Name`. |
| `tests/*.test.cjs` | Unit tests (Node's built-in test runner, no npm packages). |
| `tests/_load.cjs` | Loads the DOM-free modules from `index.html` for the tests. |
| `tests/fixtures/*.map.txt` | Small map files used by the tests. |
| `map-editor/samples/*.map.txt` | Sample maps for users, generated by `tools/make_sample_maps.cjs`. |
| `doc/manual-checklist.md` | Step-by-step manual browser test. |
| `doc/file-format.md` | Specification of the `.map.txt` save format. |
| `tools/generate_map_projection.py` | Builds and validates the chamfered-cube world projection. |
| `doc/equilateral-chamfered-cube.{json,svg}` | Projection geometry (reference data for the editor) and a diagram of the unfolded net. |

Module blocks appear in dependency order. Blocks marked `data-dom="true"` use
the browser DOM and are skipped by `LoadModules`; all other blocks must be
DOM-free. Renderer contract tests load that module separately with canvas doubles;
browser smoke checks verify actual rendering and interaction. SVG tests also use
Python's standard-library XML parser when available; the browser checks parse
and render SVGs independently.

### Tests

Tested with Node.js 26. If Python 3.8+ is on the path, the tests also confirm
the projection exports are reproducible.

```
node --test tests/
```

The sample maps are generated deterministically. After changing the file format
or the generator, regenerate them; `--check` verifies the committed files:

```
node tools/make_sample_maps.cjs          # rewrite map-editor/samples/*.map.txt
node tools/make_sample_maps.cjs --check  # verify they are up to date
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
