# Local map editor

Open `map-editor.html` directly from disk. Everything runs offline in the single
HTML file, without a server, build step, runtime package, or external asset.
The **Map editor** workspace is the default; the other workspace retains
the read-only global geometry reference.

## Create and edit

The starter map is 24 columns by 16 staggered rows, local S resolution, plain
default terrain, and origin `[0, 0]`. Its untouched state is marked Unchanged.

**New local map** accepts a name, positive integer column/row counts, scale
family, resolution, default terrain, and origin. Origins and displayed east/
north coordinates are always miles, including local-family maps. New maps
start with unsaved changes. Invalid input does not replace the current map.

| Scale family | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Local | 1 yard | 10 yards | 100 yards | 600 yards |
| Regional | 1 mile | 6 miles | 36 miles | 216 miles |

Width and height count staggered tile columns/rows, not a rectangular clipping
polygon. Every existing tile retains its full hex outline. Go to tile uses
zero-based columns/rows; the inspector also shows axial `(q, r)` coordinates.
The origin is the center of tile `(0, 0)`.

| Tool/control | Behavior |
| --- | --- |
| Brush | Drag to paint the selected terrain; interpolate between pointer events to avoid gaps |
| Brush radius | 0-4 hex steps, clipped to the map; radius 0 paints one tile |
| Erase to default | Paint the map's declared default terrain, not necessarily plain |
| Flood fill | Replace the connected region matching the clicked tile's terrain |
| Inspect | Select a tile without modifying terrain |
| Selected tile terrain | Change just the selected tile in one undo operation |
| Undo / Redo | Undo or restore one complete terrain or layer edit |
| Hex grid | Toggle grid lines without changing the document |

The inspector shows map metadata, selected terrain, universal coordinates, and
layer counts. All 17 terrains are selectable. Current rendering uses
flat catalog colors; **Export SVG...** adds finished artwork and shorelines.
Paths, landmarks, labels, and visibility controls are documented in
`LAYER_EDITOR.md`.

## Navigation and keyboard

Wheel zoom is anchored to the pointer. The +/- buttons zoom about the canvas
center. Choose Pan, middle-drag, or Alt-drag to move the viewport. Fit / center
map centers the full extent, but keeps very large maps at a readable zoom rather
than drawing their entire grids. Go to tile centers the specified cell.

Zoom and pan never change the map's resolution, origin, extent, or saved terrain.

With the canvas focused:

| Key | Action |
| --- | --- |
| B / E / F / I / H | Brush / erase / fill / inspect / pan |
| P / K / L | Path points / landmark / label anchor |
| Arrow keys | Move selection by offset column/row; in Pan mode move the viewport |
| Enter / Space | Apply the current editing tool to the selected tile |
| + / - | Zoom in/out |
| Escape | Cancel an active stroke or path draft without changing committed data |

Outside text fields, selects, and the New/Export dialogs, Ctrl/Cmd+Z undoes;
Shift+Ctrl/Cmd+Z or Ctrl+Y redoes; Ctrl/Cmd+S downloads; Ctrl/Cmd+O opens a file.
Native text-field shortcuts remain native. Go to tile and the selected-terrain
control also support editing without a pointer.

Pointer cancellation, lost capture, window focus loss, and workspace changes
cancel unfinished strokes rather than leaving partial edits. Brush controls are
disabled until a stroke finishes. Moving outside the canvas/map breaks the
interpolated segment, so re-entry does not paint an unseen connecting line.

## Open and save

**Open...** reads a local or global `.hexmap` file using the native file chooser.
Parsing validates the entire file before asking to discard dirty work and replacing
the document. Invalid files or a cancelled discard leave both the existing map
and its undo history intact. Successful Open starts a fresh undo history and
marks the loaded map Unchanged. Global files switch to global panel controls;
see `GLOBAL_EDITOR.md`.

**Save a copy** downloads canonical version-1 ASCII with a sanitized
`map-<name>.hexmap` filename. It does not directly overwrite an opened file.
The browser controls where the download goes and whether it is completed.

**Saving is a two-step process:** request the download, check the downloaded
file, then select **Confirm file saved**. The page cannot detect a cancelled
download, so requesting one alone never clears unsaved changes. Confirmation
marks only that downloaded revision as saved: edits made after the request
remain dirty. Undoing back to the confirmed revision returns to Unchanged.
If several downloads are requested, confirmation refers to the latest request.

New/Open prompts before discarding dirty work. Page exit/reload requests the
browser's unsaved-changes warning. There is no autosave or crash recovery; save
copies regularly. Undo history and viewport state are not stored in `.hexmap`.

Paths, landmarks, labels (including Unicode text), and optional global anchors
are preserved unchanged when terrain is edited/saved. Paths, landmarks, and
labels have their own editable layers; finish or cancel a path draft before
saving or replacing the document. Phase 6 adds independent derived resolutions,
retained source sessions, and undoable local/global anchor registration; see
`SCALE_AND_ANCHORS.md`. New/Open and page-exit warnings also protect unsaved
retained sources. The file contract is in `ASCII_FORMAT.md`.

**Export SVG...** downloads the entire local extent with independently
selectable terrain colors, embellishments, shorelines, paths, landmarks,
labels, grid, and guides. It does not mark the editable map saved or change
pending save confirmations. See `SVG_EXPORT.md` for artwork, clipping, and
whole-map export limits.

## Current limits

- Terrain is sparse and only visible tiles are enumerated/drawn. Very large
  extents can be navigated with Go to tile without allocating every cell.
- One stroke may change at most 25,000 tiles. Fill rejects connected regions
  larger than 25,000 tiles before modifying anything. Excessively long drag
  segments also fail explicitly. A rejected edit rolls back the whole stroke.
- Undo/redo retains at most 100 commands and 100,000 weighted history units,
  evicting the oldest undo commands as necessary. Terrain uses one unit per
  changed tile; see `LAYER_EDITOR.md` for path/text weights. A new nonempty
  edit clears redo; no-op edits do not.
- File import/export is limited to 16 MiB. Open, Save, fill, conversion, SVG,
  and undo/redo use cancellable offline workers. Choose **Cancel operation** or
  press Escape while progress is shown; cancellation/failure leaves map,
  history, and pending save confirmation intact. See `RELEASE_HARDENING.md`
  for deadlines, rendering limits, and failure recovery.
- Dimensions/coordinates must satisfy the document model's safe-integer and
  floating-point precision checks. Viewport zoom has readable lower and upper
  bounds; it is not an unlimited whole-map overview.

## Editing core

The DOM-independent `MapLocalEditor` API is a separate inline script in the
HTML, backed by the shared `MapEditing` transaction/history core.
Direct core calls below remain synchronous; the UI dispatches long operations
through `MapOperations` and `MapTaskRunner`.
`grid(document)` returns the local grid in miles; `bounds(document)`
includes full edge hexes; `tiles(document, viewport)` lazily yields visible
tile references; `hitTest(document, [east, north])` selects an existing tile or
returns null outside the map.

```javascript
const session = MapLocalEditor.createSession(document, { saved: true });
session.beginStroke("Paint");
session.paintLine([0, 0], [0, -3], "forest", 0);
session.commitStroke(); // One undo command for all four cells.
session.undo();
session.redo();
session.fill(0, 0, "water");
session.cancelStroke(); // Restores a currently active stroke, if any.
```

Use `beginStroke`, one or more `paintLine` calls, and `commitStroke` for brush
transactions; `fill` is already a complete transaction. `paintLine` cancels its
whole active stroke on validation/size failure. Erase uses the document's
`metadata.defaultTerrain` as the brush terrain. Terrain edits leave every
other document layer unchanged.

Session getters expose `document`, `revision`, `active`, `dirty`, `canUndo`,
`canRedo`, `undoLabel`, and `redoLabel`. `markSaved(revision)` records an
explicitly confirmed revision and defaults to the current revision; capture
the revision alongside serialized bytes to support delayed confirmation.
New sessions default to unsaved unless `{ saved: true }` is specified.

While editing, mutate terrain and layers through the session rather than
directly through the document; direct model changes bypass revision and undo
tracking. Layer transaction methods are documented in `LAYER_EDITOR.md`.
