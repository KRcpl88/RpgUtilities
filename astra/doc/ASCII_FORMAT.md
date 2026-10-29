# Map document and ASCII format, version 1

The DOM-independent `MapDocuments` API lives in `map-editor.html`. Phase 2
provides the model and text reader/writer; phases 3-4 add local/global terrain
editing, shared Open/Save controls, and undo/redo. Phases 5-6 add layer editing,
derived resolutions, and anchor registration without changing the version-1
format. See `doc/LOCAL_EDITOR.md`, `doc/GLOBAL_EDITOR.md`, `doc/LAYER_EDITOR.md`,
and `doc/SCALE_AND_ANCHORS.md` for the editing workflows.
No runtime library or server is required.

## Document API

```javascript
const document = MapDocuments.create({
  id: "my-local-map",
  kind: "local",
  name: "Harbor",
  scaleFamily: "local",
  scale: "M",
  extent: { width: 20, height: 12, origin: [0, 0] }
});
document.setTerrain("local", 0, 0, "water");
document.putLandmark({
  id: "town-1", type: "town", tile: { panelId: "local", q: 1, r: 0 }
});
document.putLabel({
  id: "name-1", text: "Harbor", tile: { panelId: "local", q: 1, r: 0 },
  size: 12, rotation: 0
});
const savedText = MapDocuments.serialize(document);
const candidate = MapDocuments.parse(savedText);
// Replace the active document only after parse returns successfully.
```

`create` requires an ASCII `id`. Defaults are:

| Field | Global document | Local document |
| --- | --- | --- |
| `kind` | `global` | Select `local` explicitly |
| `name` | `Untitled map` | `Untitled map` |
| `scaleFamily` | `regional` (required) | `local`; may explicitly select `regional` |
| `scale` | `XL` | `S` |
| `defaultTerrain` | `water` | `plain` |
| `projection` | `{id: "equilateral-chamfered-cube", version: 1, columns: 24}` | Not present |
| `extent` | Not present | `{width: 16, height: 16, origin: [0, 0]}` |
| `anchor` | Not present | `null` |

Unknown fields and invalid values are errors. Nested objects, when supplied,
must be complete. Metadata is copied and deeply frozen; changing dimensions or
resolution requires a new document rather than invalidating existing tiles.
`setAnchor(anchorOrNull)` atomically replaces local metadata with a new deeply
frozen snapshot; old snapshots remain unchanged. Editing sessions provide an
undoable `setAnchor` method for this update.
Import files must contain all applicable metadata fields, not just defaults.

### Coordinates and terrain

Tile references are `{panelId, q, r}` with safe integer axial coordinates.
Global references use the canonical owner, **not necessarily the geometric
face**. A partial tile with its center outside a panel remains a valid anchor
if it has positive-area geometry. Local references use `panelId: "local"`.

All universal coordinates, origins, and label offsets are `[east, north]` in
**miles**, including local-family maps. Regional center spacings are
S/M/L/XL = 1/6/36/216 miles; local spacings are 1/10/100/600 yards, divided by
1760 for universal coordinates. No implicit scale-family conversion occurs.

Local width/height count columns and staggered rows, not a clipping rectangle.
The outline follows full hexes. The origin is the center of the northwest
`(q=0, r=0)` tile. Offset rows advance south:

```text
column = q
row = -r - floor(q / 2)
r = -row - floor(column / 2)
east = originEast + sqrt(3)/2 * spacing * q
north = originNorth + spacing * (r + q/2)
```

Thus odd columns sit half a spacing north of even columns. A local tile exists
when `0 <= column < width` and `0 <= row < height`. Local dimensions must have
a safe integer product; extents too large to retain sub-tile coordinate
precision are rejected.

- `hasTile(panelId, q, r)` distinguishes outside cells from actual tiles.
  Malformed coordinates or unknown panels throw, rather than returning false.
- `terrainAt(panelId, q, r)` returns the override or declared default;
  requesting an outside cell throws.
- `setTerrain(panelId, q, r, terrainId)` changes only terrain. Resetting to the
  default removes its override, and an empty chunk is removed.
- `tilePosition(tile)` returns `{panelId, east, north}` for the tile center.
- `terrainBlocks` returns sorted, detached `{panelId, column, row}` descriptors.
- `terrainEntries()` yields detached `{panelId, q, r, terrain}` overrides in
  sorted block/cell order, without enumerating default cells.

Terrain uses sparse 16-by-16 offset-coordinate chunks with sparse overrides
inside each chunk. Constructing a fine-resolution global map or a million-
by-million local map does not allocate its default tiles.

### Independent layers

`paths`, `landmarks`, and `labels` expose immutable records sorted by ASCII ID.
IDs are unique **within each layer**. `putPath`, `putLandmark`, and `putLabel`
insert or atomically replace an existing ID. `removePath`, `removeLandmark`,
and `removeLabel` require an existing ID. Invalid edits leave existing data
unchanged. Terrain edits never remove these layers.

Path input is `{id, type, points}`. `type` is `road`, `trail`, or `river`.
Each point is `{panelId, east, north}` in universal miles. There must be 2 to
100,000 points and at least one nonzero-length within-panel segment.
Consecutive points on the same panel must be distinct and reference positions
inside that geometric panel or local hex extent. Multiple paths may overlap.

To cross a global seam, append the seam position on the departing geometric
face, followed immediately by the **same physical point** expressed on the
adjacent arriving face, then continue on that face. This applies to cut and
hinged edges alike. Nonadjacent panels and mismatched seam positions are
rejected. Tile-owner coordinates must not be substituted for geometric-face
coordinates in paths.

The interactive path builder inserts these pairs automatically between
adjacent-face waypoints. This convenience does not relax file/model validation.

Landmark input is `{id, type, tile}`. The supported types are `village`,
`town`, `city`, `castle`, `fortress`, `tower`, `ruins`, `mine`, `temple`,
`cave`, and `dungeon`. A tile holds at most one landmark, regardless of type.
Moving a landmark by ID cannot overwrite another landmark.

Label input is `{id, text, tile, size, rotation, offset}`. Size is positive
typographic points; rotation is finite clockwise degrees. Offset is
`[east, north]` in miles, defaulting to `[0, 0]` in the API. Multiple labels
can share a tile. Text is preserved literally, including whitespace, Unicode,
newlines, quotes, and XML-sensitive characters; it is not markup.

The model adds a derived `{panelId, east, north}` `position` to landmark and
label records. Persistence includes both this universal position and the
exact tile reference. Import verifies their agreement, including for partial
tiles whose centers are outside their nominal faces.
The renderer uses an interior display anchor when such a center is outside
all valid fragments; the persisted center and canonical tile stay unchanged.
When editing through a session or the model API, omit derived `position`
from put inputs.

An optional local-map global anchor is:

```javascript
{
  mapId: "parent-world",
  projection: { id: "equilateral-chamfered-cube", version: 1, columns: 24 },
  panelId: "Hyz+-", east: 0, north: 0, rotation: 0
}
```

This identifies the local origin's global location and clockwise orientation
relative to panel north. Validation checks the projection, ID, and point on the
geometric face. Phase 6 implements the planar forward/inverse transform,
undoable anchor editing, and registration-preserving origin rebasing during
conversion. The parent file is never opened or fetched, and no seam folding
or parent-terrain extraction occurs. See `SCALE_AND_ANCHORS.md`.

## File grammar

Use the `.hexmap` extension. Canonical files are entirely ASCII, LF-delimited,
and end with a newline. Import also accepts CRLF and blank lines **between**
sections or JSON records, but never trims a terrain row.

```text
FANTASY-MAP 1
[metadata]
<one complete metadata JSON object>
<zero or more terrain sections>
[paths]
<zero or more path JSON objects, one per line>
[landmarks]
<zero or more landmark JSON objects, one per line>
[labels]
<zero or more label JSON objects, one per line>
[end]
```

All four named sections and `[end]` are required in that order. No trailing
records, unknown fields, duplicate JSON object keys, duplicate layer IDs, or
unsupported format/projection versions are accepted. IDs use
`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Map names have 1-256 UTF-16 code units;
label text has 1-10,000. Names and text cannot be whitespace-only.

Terrain section example:

```text
[terrain {"column":0,"height":16,"panelId":"local","row":0,"width":16}]
```

Exactly 16 rows of exactly 16 characters follow. `column` and `row` are signed
safe integers divisible by 16, and `width` and `height` must both be 16.
Rows advance south, using the offset-to-axial conversion above. Negative
origins support polar/square panel grids. Each panel/block origin can appear
only once; fully outside-map blocks are rejected.

Every position inside the map requires a terrain code, even when it is the
default. Every position outside the map requires `_`. This mask is checked
against the actual geometry, including partial tiles and equatorial
ownership. `_` is **never** an unset/default terrain cell.

Only blocks with nondefault terrain are emitted. Within those blocks,
unchanged real tiles emit the declared default code. Omitted blocks imply the
default for existing tiles, not outside/unknown terrain. Import can accept a
valid all-default block; the next canonical save omits it.

### Stable terrain codes

| ID | Character | Surface | Default color |
| --- | --- | --- | --- |
| `water` | `~` | water | `#dcebf4` |
| `islands` | `i` | mixed | `#b8d7c6` |
| `lakes` | `l` | water | `#a4cee2` |
| `firth` | `w` | water | `#a8c8d4` |
| `plain` | `.` | land | `#d6dfad` |
| `hills` | `h` | land | `#b2c58d` |
| `mountains` | `m` | land | `#aaa79a` |
| `mountain-peak` | `^` | land | `#d3d0c8` |
| `desert` | `d` | land | `#ecd49b` |
| `sand-dunes` | `s` | land | `#dfc187` |
| `forest` | `f` | land | `#769c67` |
| `marsh` | `r` | land | `#a5bba0` |
| `mangrove` | `g` | land | `#6e9483` |
| `tundra` | `t` | land | `#d0d5c3` |
| `canyon` | `c` | land | `#bf9070` |
| `badlands` | `b` | land | `#be9d84` |
| `farmland` | `a` | land | `#c1c47b` |

Surface flags distinguish water and generated island land. Colors are the
editor/export defaults; artwork and shorelines are documented in `SVG_EXPORT.md`.

### Determinism, escaping, and validation

Canonical JSON object keys sort by ASCII/UTF-16 code-unit order, recursively.
Terrain blocks sort by panel ID, then numeric row and column; layer records
sort by ID. Array order, including path points, is preserved. Numbers use
JavaScript's finite JSON representation; negative zero becomes zero.

All non-ASCII UTF-16 code units and DEL are written as `\uXXXX` escapes.
Non-BMP characters use their surrogate-pair escapes, so Greek text, emoji,
quotes, backslashes, and line breaks survive unchanged in ASCII files.
Canonical save/load/save bytes are stable regardless of edit insertion order
or input object property order.

`parse` constructs a new candidate document and returns it only after
metadata, masks, and all layers validate. Malformed files throw
`MapFormatError` with a 1-based `line` property and `Line N: ...` message.
Terrain-code errors also identify their 1-based row column. Syntax errors,
invalid coordinates, and broken tile references are never ignored.

Version 1 reader/writer limits files to 16 MiB. The DOM-independent core is
synchronous; the editor runs parsing/serialization in cancellable offline
workers. Import-time resource errors and cancellation never replace the current
document. See `RELEASE_HARDENING.md` for the worker deadline and internal snapshot
contract; snapshots are not another file format or an alternative importer.

The canonical `tests/fixtures/local.hexmap` and `global.hexmap` demonstrate
all terrain codes, Unicode labels, partial tiles, and a cross-panel river.
