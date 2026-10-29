# Paths, landmarks, and labels

The local and global editors share independent layer tools below the map.
Terrain edits never replace these layers. Layer edits participate in the same
undo/redo sequence and save checkpoints as terrain, without changing the
version-1 `.hexmap` format. Everything remains in the single offline HTML file.

## Roads, trails, and rivers

Choose a **Path type**, then **New path**, or select **Path points (P)** and
click the map. Each click appends a physical point to a draft. Paths are not
restricted to tile centers, and multiple paths can cross the same tile.
Roads have a brown casing/light center, trails are dashed, and rivers are blue.
Selected paths and drafts have a gold highlight.

**Finish path** commits the complete path as one undo command. **Cancel path**
or Escape while in the editor discards the draft, leaving committed layers
unchanged. A path needs at least two distinct positions and a nonzero segment.
Consecutive duplicate same-face points are removed when building the path.

To edit, choose an **Existing path**, which locates its first point, then
**Edit path**. The original remains in the document until Finish replaces it.
Change its type, choose a draft waypoint, and use the controls:

| Control | Behavior |
| --- | --- |
| Update waypoint | Replace its geometric panel and east/north coordinates |
| Append selected point | Append the current map selection |
| Insert selected point after waypoint | Insert after the selected draft waypoint |
| Remove waypoint | Remove that draft waypoint |
| Delete path | Delete the selected committed path, with undo |

Coordinates are always miles. Local keyboard insertion uses the selected tile
center. Global insertion uses the selected physical location, including an
exact point reached with Coordinate lookup. Go to tile, Enter/Space with the
Path tool, and the waypoint controls permit editing without a pointer.
Selecting a draft waypoint loads its coordinates and centers the view there.
Invalid changes report an error and retain the previous valid draft.

### Crossing global seams

Path coordinates name **geometric faces**, not tile owners or net coordinates.
Choose points on neighboring faces by clicking unfolded context or navigating
between panels. The editor unfolds the two faces, intersects the connecting
line with their shared physical edge, and inserts the paired seam coordinates
required by persistence. This works at periodic, cut, and hinged seams.

Longer routes need explicit intermediate panels. A jump between nonadjacent
faces, or a segment missing their shared edge, is rejected rather than routed
arbitrarily. Reopening an existing path exposes its stored seam points as
editable waypoints; unchanged seam pairs retain their exact coordinates.
Move both sides coherently, or remove/recreate the crossing from interior
waypoints. Only same-face segments are drawn in each face's coordinate frame.

### Draft protection

Drafts show **Unsaved path draft**, mark the title, and trigger the browser's
page-exit warning. Save, SVG export, confirmation, Open, New, undo/redo, and competing layer
or terrain edits are disabled until Finish or Cancel. Draft points are not
silently omitted from a download.

Navigation remains available: wheel/button zoom, middle/Alt-drag pan,
coordinates, Go to tile, neighboring tiles, panel selection, and overview.
With the canvas focused, H and I switch to pan/inspect; P resumes adding points.
Switching to the geometry workspace retains the draft for return to the editor.
Drafts have no crash recovery; finish and save regularly.

## Landmarks

Choose a type and **Place / replace landmark**, or use **Landmark (K)** and
click a tile. The supported types are village, town, city, castle, fortress,
tower, ruins, mine, temple, cave, and dungeon.

A tile holds exactly zero or one landmark. Replacement retains the landmark ID
and changes its type; **Remove landmark** affects only that layer. Placement,
replacement, and deletion are individual undo commands. The inspector reports
the selected tile's landmark. Current symbols are native circles with distinct
two-letter codes; SVG export uses native vector glyphs for each type.

## Labels

Select an anchor tile, choose **New label**, enter text and properties, then
**Apply to selected tile**. Multiple labels can share the same tile. **Label
anchor (L)** selects a tile and focuses the text field; the form commits only
when Apply is used.

Choosing an existing label locates its anchor and loads its properties.
Apply updates that same ID at the **currently selected tile**; navigating to
another tile before Apply moves the label. Choose New label to create a
separate label instead. Delete label and every applied edit support undo.
Unapplied form values are not document edits or saved label drafts.

Text is literal, including Unicode, XML-sensitive characters, and newlines;
it is never interpreted as HTML. Whitespace-only text is rejected. Size is
typographic points, rotation is clockwise degrees relative to the anchor
face's east/north frame, and east/north offsets are miles in that frame.
Multiline text is centered with a white halo. At 100% viewport zoom, one
typographic point renders as 4/3 CSS pixels; zoom scales text and symbols.
Unfolded neighbor labels rotate with their face.

Landmarks and labels retain canonical tile references. If a global tile's
center lies outside all its valid fragments, display uses an interior point
of its largest fragment. This does not change the stored tile or persisted
center position. Label offsets apply to this display anchor. Global layers
are clipped to their geometric face; local layers are clipped to the actual
hex-map outline. Text or symbols near a boundary may therefore be clipped;
adjust size/offset to fit.

Phase 6 resolves a label offset landing on an adjacent global face into that
face's frame for rendering, preserving text position/orientation when a
conversion changes the tile owner. Offsets beyond adjacent faces are not
automatically routed around the globe and retain normal clipping.
See `SCALE_AND_ANCHORS.md` for path preservation, label reanchoring, and atomic
landmark-collision rejection during resolution conversion.

## Visibility, files, and limits

**Visible layers** independently toggles terrain, roads, trails, rivers,
landmarks, and labels. These controls and the separate grid toggle change
view state only, not saved bytes or dirty state. Starting a path draft or
selecting a terrain, landmark, or label tool reveals its layer. The world
overview is navigation-only and omits all authored layers.

Save/Open uses the workflow in `LOCAL_EDITOR.md`: download, check the file,
then **Confirm file saved**. Imported paths, landmark identity, label text,
size, rotation, and offsets remain editable.

**Export SVG...** independently selects roads, trails, rivers, landmarks, and
labels, regardless of editor visibility. It preserves physical path segments
and label properties, clips to the exported footprint, and leaves save
checkpoints unchanged. See `SVG_EXPORT.md` for finished artwork and export limits.

- Interactive path editing permits 10,000 waypoints. The model/file permits
  100,000 positions including seam pairs; larger imported paths remain
  visible, savable, and deletable, but cannot enter the interactive draft.
- Text permits 10,000 UTF-16 code units. The UI accepts sizes of at least
  0.1 point. Rendered fonts above 4096 pixels report an explicit error:
  reduce size or zoom out. The model's valid positive size is not rewritten.
- History retains at most 100 commands and 100,000 weighted units across all
  layers: one per changed terrain tile, path vertex, or landmark, and one
  plus `ceil(text.length / 64)` per label. Replacements use the greater
  before/after weight. Old undo commands are evicted as needed; no-op edits
  preserve redo.
- Layer selectors show 200 sorted records at a time; **Previous paths/labels**
  and **Next paths/labels** reach every record. New/edited records remain
  selected on the appropriate page. Terrain-only edits do not rebuild lists.
- Terrain remains viewport-culled. Cached path batches skip offscreen geometry;
  cached anchors and text bounds avoid repeated geometric/layout work.
  Dense views fail explicitly at per-frame drawing limits without deleting
  records. Hide costly layers, simplify them, or zoom in to recover.
- File import/export retains the 16 MiB limit. Open, Save, undo/redo, and other
  long operations are cancellable background jobs. Interactive path drafting
  remains bounded synchronous work. See `RELEASE_HARDENING.md` for exact
  rendering budgets, cancellation, and runtime limits.

## Layer editing API

Local/global sessions inherit these complete single-command transactions:

```javascript
const session = MapLocalEditor.createSession(document, { saved: true });
const points = MapLayerEditor.pathPoints(document, [
  document.tilePosition({ panelId: "local", q: 0, r: 0 }),
  document.tilePosition({ panelId: "local", q: 1, r: 0 })
]);
session.putPath({ id: "route", type: "road", points });
session.putLandmark({ id: "town", type: "town", tile: { panelId: "local", q: 0, r: 0 } });
session.putLabel({
  id: "name", text: "Harbor", tile: { panelId: "local", q: 0, r: 0 },
  size: 12, rotation: 0, offset: [0, 0]
});
session.removePath("route");
session.undo();
```

`putPath`, `putLandmark`, `putLabel`, `removePath`, `removeLandmark`, and
`removeLabel` must not run inside a terrain stroke. Inputs follow
`ASCII_FORMAT.md`; omit the derived `position` from landmark/label inputs.
Use session methods rather than direct model mutations to retain history and
dirty-state tracking.

The DOM-independent `MapLayerEditor.pathPoints(document, waypoints)` validates
and expands adjacent-face crossings without mutating the document. Zero/one
point is allowed for a draft, but not a committed path. `anchor(document,
tile)` resolves the display anchor without changing stored positions;
`segments(path, faceId)` returns only that face's drawable line segments.
`labelPosition(document, label)` returns the resolved text-center panel,
east/north, and clockwise rotation without changing the stored label.
