# SVG export

Open `map-editor.html` directly from disk and choose **Export SVG...**.
Local maps export their entire hex extent. Global maps export one owning panel;
the selector initially follows the active panel, but exporting another panel
does not navigate the editor. Zoom, pan, and editor visibility do not affect
the export.

Choose layers, then **Download SVG**. The browser controls the download location.
Files are named `map-<name>.svg` or `map-<name>-<panel-name>.svg`, using sanitized
names. SVG contains vector artwork, not the editable document. Continue using
**Save a copy** and **Confirm file saved** for `.hexmap` files.

Export never edits terrain, layers, anchors, undo history, retained sources,
dirty state, or a pending ASCII save confirmation. Finish or cancel active
strokes/path drafts first. The modal blocks editor keyboard shortcuts; Cancel
or Escape closes it before rendering. Errors appear in the dialog and leave
the map intact.

## Independent layers

| Choice | Contents | Default |
| --- | --- | --- |
| Terrain colors | Catalog fills and island land silhouettes | On |
| Terrain embellishments | Region-wide patterns, large peaks, forest trunks, island marks | On |
| Shorelines | Joined land/water boundaries and internal island outlines | On |
| Roads / Trails / Rivers | Three separately selectable path layers | On |
| Landmarks | Native vector symbols for all 11 landmark types | On |
| Labels | Literal Unicode text, multiline layout, size, offset, and rotation | On |
| Hex grid | Tile edges without artificial internal fragment seams | Off |
| Panel / extent guide | Dashed nominal global panel or local hex-map outline | Off |

Unchecked layers contribute no visible content. Colors and embellishments are
independent: patterns can be exported on a transparent background. Turning
everything off produces a valid transparent SVG with its original bounds.
Pattern clips have no outline of their own.

## Geometry, regions, and coasts

Global export includes every fragment owned by the selected panel, including
equatorial protrusions beyond its nominal polygon. These fragments determine
the viewBox; selecting a panel guide can additionally extend the bounds.
Neighbor-owned terrain is context for coastline decisions, not extra exported
terrain.

The exporter splits collinear edges at shared endpoints, including T-junctions,
then traces joined terrain rings. Adjacent equal-terrain cells have no internal
region edges. Even-odd fill and clip rules retain holes and disconnected regions.
Coordinates are normalized to one center spacing, with north upward and SVG
y downward. Local origins are subtracted before export. Intrinsic dimensions
use 32 pixels per center spacing, matching the editor's 100% text/symbol scale;
vector artwork can be resized without changing the map's authored resolution.

Water, lakes, and firth are aquatic. Marsh and mangrove are land/wetlands.
Islands have a water base and two deterministic, disjoint land silhouettes
inside each tile's largest fragment. Their internal coastlines are actual
silhouette boundaries, not outlines around water tiles.

A coast exists where land meets water, not merely where terrain names differ.
Global cut boundaries query neighboring canonical terrain; physical seams use
exact opposite-face intervals, including one-to-many contacts and periodic
ownership. Land continuing onto another panel has no false coastline.
Outside a local extent is unknown, not assumed water, so no artificial
coastline is added around a local export cut.

## Artwork

Patterns use panel-coordinate repeating units, not per-tile phase resets.
Motifs crossing a repeat boundary wrap into the next repeat; terrain-region
clipping stops artwork at terrain changes. Local patterns preserve their
coordinate phase after subtracting the extent origin. Equatorial panel width
is an integer multiple of the horizontal repeat period.

| Terrain | Embellishment |
| --- | --- |
| Plain / Water | None |
| Hills | Overlapping rounded hill curves |
| Mountains | Groups of angular peaks |
| Mountain peak | One large peak per tile, clipped to peak terrain |
| Desert | Dots and dashes |
| Sand dunes | Straight left slopes with curved right slopes |
| Forest | Overlapping crowns, with short trunks at exposed southern edges |
| Marsh | Water dashes and three-stroke grass clusters |
| Tundra | Dots and short dashes |
| Islands | Small marks on generated land silhouettes |
| Lakes / Firth | Short ripples / longer undulating water lines |
| Mangrove | Canopy, stems, and branching roots |
| Canyon | Irregular parallel bands with hatching |
| Badlands | Jagged ridge groups |
| Farmland | Repeated furrow patches |

Forest trunks are restricted to boundary segments facing panel-relative south
with known nonforest terrain beyond them. They do not appear at internal joins,
across export cuts where forest continues, or along unknown local exterior.
Trunks are clipped inside forest terrain.

Canvas editing remains a flat-color working view with its existing landmark
codes. Finished terrain artwork and vector landmark glyphs belong to SVG export.

## Paths, labels, and portability

Paths retain their exact geometric-face segments and paired seam positions.
Per-face clips restrict layers to the selected owner's exported footprint.
Landmarks use the same canonical display anchors as the editor. Labels use
the shared adjacent-face offset resolution, including its rotated frame.
Symbols/text near a geometric face or map boundary can be clipped; adjust
their size/offset to fit, as in the editor.

Text uses system sans-serif fonts with a white halo, centered multiline
layout, and preserved whitespace. Fonts are not embedded, so exact glyph
metrics depend on the viewer. Labels retain typographic point sizes at 100%;
newlines become separate text spans. XML-sensitive characters are escaped,
not interpreted as markup. XML 1.0-invalid control characters and unpaired
surrogates cause an explicit error instead of being silently removed.

The UTF-8 SVG is standalone: no scripts, event handlers, external fonts,
images, stylesheets, or other assets. Reuse references point only to generated
internal motif IDs. Labels remain selectable text rather than outlined glyphs.

## Limits and API

Exports allow at most 25,000 owned tiles, 500,000 counted processing operations,
and 16 MiB of UTF-8 output. Tile count alone does not guarantee success:
complex layers can exhaust processing/output budgets. Very fine global panels
are rejected by a candidate-grid preflight before whole-panel enumeration.
Near-degenerate geometry that cannot be traced reliably fails explicitly
rather than dropping fragments.

Included labels exceeding 4096 pixels at 100% must be resized or omitted.
Omitting labels does not validate or emit their text. The map title and
metadata still must be representable in XML.

Use a smaller extent, fewer export layers, or a coarser independently derived
map when a limit is exceeded. The editor runs rendering in a native offline
worker. **Cancel operation** or Escape terminates computation without requesting
a download, changing the map/history, or consuming an ASCII save confirmation.
The export-options dialog stays open for adjustment/retry after cancellation
or failure. Workers also have a two-minute deadline; see `RELEASE_HARDENING.md`.
The limits bound work, but do not promise a fixed completion time.

```javascript
const source = MapSvgExport.render(document, {
  panelId: "Hyz+-", // Global owner; omit for a local map.
  colors: true,
  embellishments: true,
  shorelines: true,
  roads: true,
  trails: true,
  rivers: true,
  landmarks: true,
  labels: true,
  grid: false,
  guides: false
});
```

The direct synchronous `render` API returns a deterministic complete SVG string
and never mutates the document. `defaults`, `MAX_TILES`, `MAX_WORK`, and
`MAX_BYTES` expose the policy.
Unknown options and nonboolean layer values are rejected. The version-1
`.hexmap` format is unchanged.
