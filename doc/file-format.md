# Map file format (`.map.txt`, version 1)

Maps are saved as human-readable ASCII text (prompt.md: "one ASCII character per
tile, other layers appended in universal coordinates"). The editor writes files in a
canonical form: parsing a file it wrote and writing it again yields identical bytes.
Example files: [`tests/fixtures/sample-global.map.txt`](../tests/fixtures/sample-global.map.txt)
and [`tests/fixtures/sample-local.map.txt`](../tests/fixtures/sample-local.map.txt).
Reader and writer: the `FileFormat` module in `map-editor/index.html`.

## Lexical rules

* The first non-blank line must be exactly `# RPGMAP 1`.
* Line endings may be `\n` or `\r\n`. Leading and trailing spaces are ignored.
* Blank lines and lines whose first non-blank character is `#` are ignored.
  Comments only cover whole lines, because `#` can appear inside quoted strings.
* Sections start with a `[name]` or `[panel <Name>]` header line. Section names
  are case-sensitive. Unknown or duplicate sections are errors.
* Quoted strings use `"…"`. Inside them, `\"` is a quote, `\\` is a backslash, and
  `\uXXXX` is a UTF-16 code unit. The writer escapes every character outside
  printable ASCII (0x20–0x7E), so written files are pure ASCII. Any other escape
  is an error.
* Every error names its line: `Line 12: Row is 5 characters wide, expected 4`.
  Errors that concern the whole file (such as a missing panel) have no line number.

## Sections, in written order

### `[map]` (required, must come first)

`key = value` lines. Each key may appear only once; unknown keys are errors. The
editor always writes every key that applies.

| Key | Global | Local | Value |
|---|---|---|---|
| `kind` | ✔ | ✔ | `global`, `panel` (single panel), or `local` |
| `name` | optional | optional | quoted string (default `""`) |
| `panelHexes` | optional | optional | even integer *n*, panel size in XL hexes regardless of tile scale (default 24) |
| `tileScale` | optional | – | `L` (the tile is the hex) or `XL` (a 3-hex-wide super-tile); default `XL` |
| `width`, `height` | – | ✔ | local map size in hexes |
| `system` | – | ✔ | `regional` (S/M/L/XL) or `local` (yard scales) |
| `size` | – | ✔ | hex-size name for that system, as in prompt.md |
| `anchor` | – | ✔ | universal location of tile (0, 0), e.g. `Eta 187.1W 324.0N` |

Single-panel maps (`kind = panel`) use the same `name`, `panelHexes` and
`tileScale` keys as global maps, plus a required `panel` key containing the
panel's Greek name (case-insensitive). Their tile scale may be `M` (6 mi),
`L` (36 mi) or `XL` (216 mi); it defaults to `XL`.
They contain exactly one `[panel <Name>]` section, matching `panel`.
The whole panel polygon is tiled, including independently clipped edge tiles.
No tiles, adjacency or feature locations wrap into neighbouring panels.
The equator/poles reference layer is computed from projection geometry and is
not stored in map files.

### `[legend]` (optional)

One `<char> <terrainKey>` line per terrain. Every terrain must appear exactly once
and every character must be unique. If the section is missing, the default
characters are used (the ones the editor writes). A legend may remap characters;
the remapping only applies to that file. The characters space, `#`, `[`, `]`, `"`
and `\` are not allowed, and neither is `_`, which marks "no tile".

Terrain keys are `water islands lakes firth plain hills mountains mountainPeak desert
sandDunes forest marsh mangrove tundra canyon badlands farmland`.

### `[panel <Name>]` (global maps: one for every panel)

`<Name>` is the panel's Greek name (case-insensitive). The editor writes panels in
Greek-alphabet order. Every panel is required for a global world; only the chosen
panel is required (or permitted) for a single-panel map. The header keys are:

```
columns = 4        # grid width (lattice columns spanned by the panel's tiles)
rows = 5           # grid height
latticeColumn = 0  # lattice column of the first character in each row
latticeRow = 2     # lattice row of the first grid line
```

The four values must equal the values the editor derives from `panelHexes` and
`tileScale`. They are written so a person reading the file can locate tiles in
the panel's hex lattice. They are followed by exactly `rows` grid lines, each
exactly `columns` characters wide. Column *c* of grid line *r* is lattice cell
(`latticeColumn + c`, `latticeRow − r`), so north is up. Lattice cells in odd columns
sit half a hex north of cells in even columns ("odd-q up"). A cell that is not a
tile of this panel is `_`. Seams resolve tile ownership as defined in prompt.md:
partial edge hexes belong to exactly one panel, and the other panel has `_` there.
A `_` on a tile, or a terrain character on a non-tile, is an error.
Single-panel equatorial maps include all lattice cells intersecting their
polygon, including edge cells whose centres lie beyond the panel boundary;
unlike global-world seams, these cells belong to this panel and are clipped to it.

### `[local]` (local maps only)

`columns = width` and `rows = height`, followed by `height` grid lines of `width`
characters. Grid line *y* is local row *y* (row 0 is the northernmost), and character
*x* is local column *x*. Odd columns sit half a hex north of even columns, measured
from the anchor's lattice parity.

Regional anchors snap to the same-scale lattice of their named panel, using
`panelHexes` for alignment. Yard-scale anchors remain free. Local grids continue
flat in that panel's frame, even beyond its boundary; their coordinates never
switch to an adjacent panel.

When writing a yard-scale map, the anchor is rounded to the file's coordinate
precision (see below). Feature locations are computed from that rounded anchor,
without changing the document in memory. This keeps write → parse → write
byte-identical even when the entered free anchor has additional decimal places.

### `[landmarks]` (optional)

```
<location> <type> "<name>" [notes="<text>"]
```

`<type>` is one of `village town city castle fortress tower ruins mine temple cave
dungeon`. The name may be omitted (`""`). There is at most one landmark per tile.

### `[labels]` (optional)

```
<location> <category> [id=<id>] [size=<units>] [rot=<deg>] [dx=<units>] [dy=<units>] "<text>"
```

`<category>` is `region`, `location` or `city`. Size defaults to the category's
default size. Rotation and offsets default to 0. A missing `id` is assigned
automatically (`label1`, `label2`, …). Labels keep their file order.

For display, 48 size/offset units equal one hex height (centre-to-centre distance).
Positive `dx` is panel-east/right, positive `dy` is panel-south/down, and rotation
is clockwise relative to the panel. Text and offsets scale together with zoom.
These display units do not change the stored universal tile location. Partial
tiles use an anchor inside their largest visible piece for drawing, while retaining
their original tile-centre location in the file.

### `[overlays]` (optional)

```
<type> <id> [style=<style>] "<name>" : <location>; <location>; …
```

`<type>` is `river`, `road` or `trail`. The points are the tile path in order.
Consecutive tiles must be adjacent, including across panel seams. After the first
point, a point may leave out the panel name, which then means "same panel as the
previous point". The writer always leaves it out when the panel doesn't change.
`style` is optional metadata (letters, digits, `_`, `-`); the current canvas uses
the overlay type for its appearance: blue rivers, brown roads, dashed trails.

## Locations

A location is a universal coordinate `<Panel> <dist>E|W <dist>N|S` in miles from the
panel centre (prompt.md). The writer prints tile centres with
`max(1, ceil(−log10(hexMiles / 10)))` decimals: 0.1 mi for all global maps and
regional local maps, and finer for yard-scale local maps. When reading, a location
must lie within 0.25 hex of a tile centre; on a local map, that tile must also be
inside the map. Otherwise the line is rejected (`No tile within 0.25 hex of …`).

## Example (local map)

```
# RPGMAP 1

[map]
kind = local
name = "Riverlands"
width = 12
height = 8
system = regional
size = M
anchor = Eta 187.1W 324.0N
panelHexes = 24

[local]
columns = 12
rows = 8
~~~~~f...hhh
~~~~..f..hhh
~~~....f.hhh
~~.f....fhhh
~...f....hhh
f....f...hhh
.f....f..hhh
..f....f.hhh

[landmarks]
Eta 155.9W 300.0N village "Millford"

[labels]
Eta 140.3W 315.0N location id=label1 size=14 rot=0 dx=0 dy=0 "Grey Hills"

[overlays]
road road1 "Mill Road" : Eta 176.7W 282.0N; 171.5W 285.0N; 166.3W 288.0N; 161.1W 291.0N; 155.9W 294.0N; 150.7W 297.0N; 145.5W 300.0N
```

(The `[legend]` section is left out here; when it is missing, the default characters
are used.)
