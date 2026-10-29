# Global map editor

Open `map-editor.html` directly from disk and choose **New global map** in the
default **Map editor** workspace. Everything runs offline in the single HTML
file. The separate geometry workspace is a read-only reference, not the editor.

## Create and navigate

Global maps use the regional scale family: S/M/L/XL center spacings are
1/6/36/216 miles. Creation accepts a name, resolution, default terrain, and
a positive even number of XL columns, defaulting to 24.
The world-width setting is independent of authored resolution:

```text
panel width in miles = XL columns * 216 * sqrt(3)/2
equatorial columns at the chosen resolution = XL columns * 216 / spacing
```

Changing the view or zoom never resamples terrain. New maps start unsaved.

**Active panel** selects any of the 18 named panels. The active panel has a red
outline; directly adjacent faces are unfolded across their physical seams and
drawn more faintly. This context is editable and is not constrained by cuts in
the reference net. Where unfolded context overlaps, the active panel takes
priority, followed by a fixed neighbor order for both drawing and hit testing.

**World overview** shows the labeled net for navigation only, not authored layers.
Click a panel or use Active panel to open it. **Return to panel** leaves the
overview. No painting occurs while clicking the overview.

Wheel/button zoom, Pan, middle-drag, Alt-drag, and Fit / center map work as in
the local editor. Fine-resolution maps retain a readable zoom rather than
trying to draw an entire globe. Fit centers the active panel, with a context
margin; pan or use coordinate navigation to reach distant areas.

## Terrain tools and history

All 17 terrain types are available. Brush and erase interpolate through panel
and hex-edge crossings, including narrow partial cells and the periodic
equatorial wrap. Erase restores the map's declared default terrain.

Radius 0 paints one tile; radii 1-4 count physical edge-sharing neighbor steps.
Clipped seams can have one-to-many neighbors, so global brushes need not contain
the same number of cells as a regular hex-grid brush. Point-only contacts are
not neighbors.

Flood fill replaces the connected region matching the starting tile's terrain,
including connections across all panels. It is not limited to the viewport
or active panel. Inspector terrain changes affect only the selected tile.
Each stroke, fill, or inspector change is one undo operation, even when it
touches multiple panels. Cancellation or an error rolls back the whole stroke.

The local editor's tool shortcuts, undo/redo, save/open shortcuts, pointer
cancellation, and dirty-state protection also apply. With the global canvas
focused, arrow keys always pan; Enter/Space applies the selected tool to the
selected tile. Use the native navigation controls to select tiles by keyboard.

## Coordinates and ownership

**Go to tile** takes the owning panel and signed axial `(q, r)` coordinates,
not the local editor's offset columns/rows. Negative coordinates are valid on
many panels. Partial tiles remain selectable even when their full hex center
lies outside the nominal face. **Edge-sharing neighbors** lists physically
adjacent tiles, including neighbors owned by other panels.

The inspector distinguishes the canonical owner from the geometric face
containing the selected point. An equatorial tile may protrude onto another
face while retaining one terrain value and one identity. Navigation by tile
uses an interior representative point of a fragment, not necessarily its full
hex center.

**Coordinate lookup** accepts a geometric panel plus east/north in miles,
or latitude/longitude in degrees. Successful lookup preserves the requested
physical point and selects its canonical tile. Invalid input leaves the
current selection and terrain unchanged.

Inspector east/north, latitude/longitude, and true-north heading refer to that
selected physical point. Heading is measured from panel-relative north toward
east. Longitude and heading are undefined at either pole. The pointer status
uses the active panel's unfolded display coordinates; for adjacent faces,
these differ from that face's own coordinates shown in the inspector.
Spherical lookup uses the agreed radial projection; it does not change the
authoritative planar editing geometry.

## Files and current limits

Open accepts both local and global version-1 `.hexmap` files and switches
controls accordingly. Validation finishes before replacement. Saving uses
the same explicit workflow as local maps: **Save a copy**, check the downloaded
file, then **Confirm file saved**. A download request alone does not clear
unsaved changes; confirmation marks only the downloaded revision. See
`LOCAL_EDITOR.md` for full save, discard, and recovery limitations, and
`ASCII_FORMAT.md` for the unchanged file contract.

Paths, landmarks, and labels are drawn and edited independently of terrain;
see `LAYER_EDITOR.md` for automatic paired path crossings, canonical partial-tile
anchors, visibility, and draft protection. Phase 6 adds independent derived
resolutions and creation of local maps anchored to selected geometric points;
see `SCALE_AND_ANCHORS.md` for policies and retained-source protection.
**Export SVG...** exports one selected owning panel, including its equatorial
protrusions. Terrain colors, artwork, shorelines, authored layers, grid, and
guides are independently selectable. Neighbor terrain informs coastlines so
panel cuts do not become false coasts. Export leaves the editable map and save
checkpoint unchanged; see `SVG_EXPORT.md` for policies and limits.

Terrain storage is sparse. Rendering enumerates only visible fragments, and
adjacency examines bounded seam intervals rather than enumerating whole edges.
The global editor shares the local editor's 25,000-changed-tile stroke limit,
25,000-tile fill limit, and history limits of 100 commands and 100,000 weighted
units across terrain and other layers. Oversized edits fail explicitly without
partial changes.
Excessively long drag segments also fail explicitly.

Import/export retains the 16 MiB limit. Open, Save, fill, conversion, SVG, and
undo/redo run in cancellable offline workers. Cancel or Escape discards the
candidate without changing owners, history, sources, or pending save state.
See `RELEASE_HARDENING.md` for runtime/rendering limits and recovery.
World sizes must satisfy the model's precision/safe-integer checks.

## Editing core

`MapGlobalEditor` is DOM-independent and shares `MapEditing` transactions with
the local editor. These direct core calls are synchronous; the UI uses
background operations:

```javascript
const document = MapDocuments.create({ id: "my-world" });
const session = MapGlobalEditor.createSession(document);
const hit = MapGlobalEditor.locate(document, "Hyz+-", [0, 0]);
session.beginStroke("Paint");
session.paintTile(hit.tile, "forest", 1);
session.commitStroke();
session.undo();
session.redo();
session.fill(hit.tile.panelId, hit.tile.q, hit.tile.r, "plain");
```

`paintLine(displayFaceId, from, to, terrain, radius)` uses east/north points
in the active panel's unfolded view, not axial coordinates. Both endpoints must
be on displayed faces. `paintTile(tile, terrain, radius)` accepts a canonical
`{panelId, q, r}` reference. Both require an active stroke; `fill` is already
a complete transaction.

`world(document)` returns cached geometry; `bounds(document, faceId)` returns
the active nominal panel bounds with a context margin. `domains` supplies
adjacent-face transforms; `tiles(document, faceId, viewport)` lazily yields
visible fragments with canonical references. `hitTest` resolves a display point
or returns null outside displayed faces. `locate` validates a point on one
geometric face. `location` returns a valid interior fragment point even for
partial tiles, and `neighbors` returns physical edge-sharing references.
`faceTiles(document, faceId, viewport)` yields only one geometric face's
fragments, including neighboring-owner protrusions, for area-based conversion.

Session state, save checkpoints, undo/redo, commit, and cancellation follow
the local API. Mutate terrain and layers through sessions while editing;
direct model mutations bypass history and dirty-state tracking.
