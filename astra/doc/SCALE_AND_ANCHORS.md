# Derived resolutions and global anchors

Phase 6 adds deterministic resolution conversion and local/global coordinate
registration to the offline editor. Open `map-editor.html` directly; no server,
build, runtime dependencies, or parent-file access is needed.

## Create a derived map

In **Derived map**, enter a new name, select a target resolution, and choose
**Create derived map**. Conversion creates a new document with a new ID and
empty undo history; the source document, edits, history, and save checkpoint
remain intact. Save and confirm the new file separately.

Map kind, scale family, default terrain, and global world size cannot change.
All four resolutions are available within the source family:

| Family | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Regional | 1 mile | 6 miles | 36 miles | 216 miles |
| Local | 1 yard | 10 yards | 100 yards | 600 yards |

These are center spacings, not polygon side lengths. Universal coordinates
always use miles, including local-family maps (1 mile = 1760 yards). Integer
spacing ratios do not imply that coarse hex outlines contain exact sets of
fine hexes. Viewport zoom remains independent of authored resolution.

**Return to source map** restores the latest source's original editing session
and save checkpoint, with navigation reset to its initial view. Returning
discards the derived session after prompting for any unsaved changes; save it
first to keep it. Derivations can be nested, retaining up to eight sources.
The source-status message also warns about unsaved retained sources, even when
the current child has been saved. New/Open and page-exit protection include
those unsaved sources. New/Open clears the retained chain only after validation
and any required discard confirmation.

Retained sessions are memory-only, not a document relationship or crash-recovery
mechanism. Save each map you need. Reopening a derived file does not reload its
source, and a source file does not contain its children.

## Conversion policies

- **Same resolution:** an independent exact copy of terrain, layers, extent,
  and anchor, apart from the new map ID/name.
- **Refinement:** sample source terrain at the target center. A global partial
  tile whose center is outside its fragments uses an interior point of its
  largest fragment, matching the display-anchor convention. Samples outside
  the old local outline use the declared default terrain.
- **Coarsening:** choose the terrain with greatest clipped overlap area within
  each target tile. Count every geometric fragment of seam-owned tiles, and
  include uncovered/default terrain in the comparison. Ties within
  `1e-10 * targetArea` use the stable terrain catalog order in `ASCII_FORMAT.md`.
  Small patches may disappear; this is aggregation, not a lossless inverse.
- **Local extent:** enclose the entire old hex outline in a new rectangular
  column/row grid, rebased by whole target axial steps with default-terrain
  padding. The target lattice keeps its phase relative to the old origin.
  Dimensions and origin change, tile indices may shift, and repeated
  different-resolution conversions can expand the extent.
- **Global extent:** preserve the projection and regional-XL column count.
  Canonical seam ownership and partial tiles come from the target grid.
- **Paths:** retain exact universal coordinates, IDs, types, and seam pairs.
- **Landmarks:** map each source display anchor to its containing target tile.
  Types/IDs are retained. If two landmarks would share a target tile, reject
  the whole conversion and name both records; move/remove one before retrying.
- **Labels:** reanchor to target tiles while retaining text, size, ID, and the
  physical text-center location. Recompute offsets and, when needed, rotate
  them into the target display frame. An offset landing on an adjacent global
  face is rendered there, so a change of tile owner does not hide the label.
  Normal face/outline clipping and viewport-dependent text sizing still apply.

Conversion publishes only a fully validated candidate. Errors leave the source
and its editing history unchanged. No nearest-valid-cell fallback or automatic
landmark deletion is used.

Terrain conversion visits sparse source overrides and nearby target candidates,
not every default cell on a globe. It permits at most 100,000 unique candidate
cells and 500,000 counted work operations (source overrides, candidate visits,
layer records, and path vertices). A conservative per-fragment candidate
estimate can reject oversized refinements before enumeration. For example, a
painted local XL cell cannot be expanded directly to S within the candidate
budget. Use a closer resolution or reduce authored data; a large multi-step
conversion may still exceed the budget.

Conversion runs in an offline worker while edits are disabled. Choose
**Cancel operation** or press Escape to terminate it; no derived document or
retained-source entry is published until successful completion. Model precision
checks, safe dimension limits, and the 16 MiB file limit still apply.
See `RELEASE_HARDENING.md` for the two-minute worker deadline and failure handling.

## Register a local map

There are two entry points:

1. While viewing a global map, locate a geometric point and choose **New local
   map**. Enable **Anchor the local origin to the selected global point**.
   The dialog displays the captured parent ID, geometric panel, and miles.
   Creation copies that registration with zero rotation, not parent terrain.
2. On any local map, fill in **Local global anchor**: parent map ID, parent
   width in regional XL columns, geometric panel, east/north miles, and
   clockwise rotation. Choose **Apply global anchor**. Use **Remove global
   anchor** to detach the registration.

The local extent origin maps to the specified global point. Rotation is
clockwise relative to the geometric panel's north/east frame, not spherical
true north. The anchor must lie inside its named face, have a valid projection,
and refer to a different map ID. The parent file is never opened, fetched,
resampled, or modified. Matching its ID and world width is the user's
responsibility.

Apply/remove are ordinary undoable edits and persist in the existing version-1
ASCII format. They do not move local terrain, paths, or labels. Unapplied form
values are not document edits; unrelated edits preserve them until the anchor
record changes. Finish/cancel an active path draft or terrain stroke before
changing registration or deriving another map.

**Registered coordinates** reports the selected local tile center in the
anchor's geometric panel, with latitude/longitude when inside that face.
**Find in local map** applies the inverse transform to east/north coordinates
in that same panel; an outside-local-extent lookup reports an error.

The registration is planar. Local positions extending beyond the named face
remain planar references, explicitly marked outside; latitude/longitude are
unavailable there. No seam folding or automatic reanchoring occurs.

When conversion rebases a local origin, it also adjusts the anchor's east/north
so existing physical positions retain their registration. If the new origin
would lie outside the named global face, conversion fails atomically. Adjust
or remove the registration explicitly before retrying.

## Core API

The DOM-independent `MapScaleEditor` uses the existing document, geometry, and
editing services:

```javascript
const derived = MapScaleEditor.derive(source, {
  id: "independent-map", name: "Harbor detail", scale: "S"
});
const session = MapLocalEditor.createSession(localDocument, { saved: true });
session.setAnchor({
  mapId: "world",
  projection: { id: "equilateral-chamfered-cube", version: 1, columns: 24 },
  panelId: "Hyz+-", east: 20, north: 30, rotation: 90
});
const globalPoint = MapScaleEditor.toGlobal(localDocument, [12, -4]);
const localPoint = MapScaleEditor.fromGlobal(localDocument, globalPoint);
const location = MapScaleEditor.anchorLocation(localDocument, localPoint);
session.setAnchor(null);
session.undo();
```

`derive` accepts only `id`, optional `name`, and `scale`; the ID must differ
from the source. `spacing(document)` returns center spacing in miles.
`toGlobal` returns `{panelId, east, north}`; `fromGlobal` returns `[east, north]`
and rejects a different panel. `anchorLocation` adds `inside`, `latitude`, and
`longitude` (both coordinates null outside the face; longitude null at a pole).

For local origin `O`, anchor position `A`, and clockwise angle `t`, registration
uses `global = A + [cos(t)*dx + sin(t)*dy, -sin(t)*dx + cos(t)*dy]`, where
`[dx, dy] = local - O`. The inverse uses the opposite rotation.

Direct `document.setAnchor(anchorOrNull)` validates atomically and replaces the
deeply frozen metadata snapshot. Use the session method while editing to keep
history and dirty-state tracking. `document.terrainEntries()` yields sorted,
detached sparse overrides without enumerating default cells.
