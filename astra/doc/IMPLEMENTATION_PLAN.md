# Global Map Editor: implementation plan and status

## Status

Updated: October 29, 2026.

Work branch: `dev/global-map-editor`. Commit completed work to this branch;
do not merge it into `main`.

| Phase | Status | Deliverable |
| --- | --- | --- |
| 1. Geometry foundation | Complete | Reference solid/net, panel frames, hex grids, clipping, seam ownership, and geometry tests |
| 2. Core model and persistence | Complete | Terrain catalog, document schema, ASCII reader/writer |
| 3. Local editor | Complete | Native controls, navigation, terrain editing, undo/redo, Open/Save |
| 4. Global editor | Complete | All 18 panels, navigation overview, seam-aware terrain tools, coordinate lookup |
| 5. Additional layers | Complete | Editable paths, unique landmarks, persistent label properties, visibility, and shared undo/redo |
| 6. Scale and local anchors | Complete | Deterministic derived resolutions, retained sources, and undoable local/global registration |
| 7. SVG export | Complete | Standalone panel/local export, joined shorelines, terrain artwork, independent layer controls |
| 8. Release hardening | Complete | Cancellable offline workers, bounded rendering, cached/paged layers, and failure recovery |

This is the implementation record for the agreed plan. Phases 1-7 establish
geometry, document models, ASCII persistence, and interactive local/global
terrain/layer editors with derived resolutions, local anchor registration,
and finished layered SVG export. Phase 8 adds cancellable background work and
large-map interaction safeguards without changing the file format or adding dependencies.

### Completed phase-one work

- `map-editor.html`: offline, read-only net and individual-panel previews with
  tile-owner inspection. The inline `MapGeometry` API is DOM-independent.
- `tools/generate_map_projection.py`: the supplied reference generator,
  preserved verbatim from the specification.
- `doc/equilateral-chamfered-cube.json` and `.svg`: reproducible, labeled
  reference exports with Git-pinned LF line endings. The application does not
  fetch these files.
- `tests/geometry.test.cjs`: 17 automated cases covering reference agreement,
  frames, scale grids, clipping, coverage at 2/4/24 columns, all 48 seams,
  periodic and irregular neighbors, spherical conversions, and invalid input.
- `tests/browser-smoke.cjs`: real headless-browser checks for direct disk
  loading, all 18 panel views, seam hit testing, input errors, recovery, drawing,
  and absence of external page requests.

Both automated checks and reference reproducibility passed on October 29,
2026. The reference SVG is not the finished terrain SVG exporter.

### Completed phase-two work

- `map-editor.html`: the DOM-independent `MapDocuments` API adds global/local
  documents, explicit scale families, local origins and optional global
  anchors, and the complete 17-terrain catalog with stable ASCII codes.
- Terrain overrides are sparse within 16-by-16 chunks. Defaults do not
  allocate a globe; partial tiles and equatorial protrusions retain their
  canonical owner.
- Paths, unique-per-tile landmarks, and labels are independent, validated
  layers. Cross-panel paths require paired positions on the physical seam;
  labels preserve Unicode text, size, rotation, and offsets.
- Version-1 `.hexmap` persistence provides fixed-width terrain rows, checked
  outside masks, deterministic ASCII-escaped JSON, strict whole-document
  parsing, and line-specific errors. Failed import never replaces a document.
- `doc/ASCII_FORMAT.md` documents the exact schema, API, coordinates, stable
  terrain codes, grammar, validation rules, and current resource limits.
- `tests/documents.test.cjs` adds 12 cases covering lossless round-trips,
  sparse defaults, all scale families/resolutions, partial and seam-owned
  tiles, all 48 path seams, layer invariants, anchors, malformed input, and
  atomic failure.
- `tests/fixtures/local.hexmap` and `global.hexmap` are canonical ASCII
  round-trip fixtures with LF-pinned bytes. The browser check now also
  exercises native `File`/`Blob` round-trips and rejected imports.

The phase-two baseline passed all 29 Node test cases, reference reproducibility,
and the real Edge headless check on October 29, 2026. The synchronous parsing
core has a documented 16 MiB file limit;
phase 8 below moves the editor's file operations into cancellable workers.

### Completed phase-three work

- `map-editor.html` now opens in the local editor: native map-creation dialog,
  terrain palette, selected-tile inspector, coordinate display, and file controls.
  Local maps support either scale family and every resolution, with explicit
  dimensions, origin, and default terrain.
- The DOM-independent `MapLocalEditor` core provides local bounds, hit testing,
  lazy viewport iteration, interpolated radius brushes, erase, flood fill, and
  atomic editing sessions. A complete stroke/fill is one undo operation;
  cancelled or rejected edits restore all affected terrain.
- Canvas navigation includes wheel/button zoom, pointer/keyboard pan, tile
  selection, and Go to tile. Viewport zoom never changes authored resolution.
  Rendering culls to the viewport and coalesces redraws by animation frame.
- Open validates a complete local document before replacing the current map.
  At this phase, invalid files, unsupported global files, and cancelled discard
  confirmations leave the current document/history intact.
- Save downloads canonical ASCII through native Blob/file controls. Because the
  page cannot observe download completion, **Confirm file saved** explicitly
  marks the downloaded revision saved; subsequent edits remain dirty.
  New/Open and page-exit prompts protect unconfirmed changes.
- Paths, landmarks, labels, and anchors survive terrain edits and file
  round-trips, but their drawing/editing remains deferred. The global geometry
  reference is still available in a separate read-only workspace.
- `tests/local-editor.test.cjs` adds eight cases for editing, history, atomic
  failure, scale-family hit testing, bounded fills, and trillion-tile viewport
  iteration. `tests/browser-local-editor.cjs` extends the existing real-browser
  harness with creation, pointer/keyboard tools, capture cancellation, navigation,
  actual downloads/reopening, discard/unload protection, and layer preservation.
- `doc/LOCAL_EDITOR.md` documents controls, save confirmation, command API, and
  current resource limits.

All 37 Node cases, the expanded Edge headless workflow, and independent
reference reproducibility passed on October 29, 2026. The create/edit/save/
reopen/continue-editing acceptance gate is complete. No new tools or dependencies
were needed. Global-file support is added in phase 4 below.

### Completed phase-four work

- The shared **Map editor** workspace creates and opens global documents at
  every regional resolution, with an even XL-column world-width setting.
  All 18 panels can be selected; physically adjacent faces unfold beside the
  active panel, independent of where the reference net places them.
- A labeled world overview navigates between panels without drawing or editing
  terrain. Panel views retain viewport culling and readable zoom at fine scales;
  zoom never changes authored resolution.
- The DOM-independent `MapGlobalEditor` core provides ownership-aware viewport
  iteration, hit testing, partial-cell locations, neighbor navigation, and
  global edit sessions. Local and global sessions share panel-qualified
  transactions, undo/redo, bounded history, and save checkpoints.
- Brushes and erase cross physical seams, including the periodic equatorial
  wrap. Radius counts edge-sharing neighbor steps, not a fixed cell count.
  Stroke traversal partitions at panel and hex-edge crossings, so narrow
  positive-area fragments are not skipped between pointer events. Flood fill
  follows connected terrain across all panels.
- Fine-scale adjacency queries inspect only the seam interval touched by a
  tile, rather than enumerating an entire world edge. A regression exercises
  regional S at 24,000 XL columns without allocating the globe.
- Navigation accepts an owner panel and signed axial coordinates, edge-sharing
  neighbors, geometric-panel east/north, or latitude/longitude. The inspector
  distinguishes canonical owner from geometric face and reports true-north
  heading; longitude and heading are explicitly undefined at the poles.
- Local/global Open, Save, confirmation, and dirty-state protection use the
  same workflow and unchanged version-1 ASCII format. Existing paths, landmarks,
  and labels survive terrain editing and file round-trips without being drawn
  or edited.
- `tests/global-editor.test.cjs` adds seven cases covering all regional scales,
  all 48 seams, partial cells, narrow-fragment strokes, global fill, bounded
  queries, spherical ownership, and transactional rollback/history.
  `tests/browser-global-editor.cjs` adds native global creation, all panels,
  seam brushes, fill/undo, overview clicks, coordinate/pole lookup, actual
  downloads/reopening, fine-scale seam editing, and local/global switching.
- `doc/GLOBAL_EDITOR.md` documents the global workflow, API, and limits.
  Local and persistence documentation now describe both supported map kinds.

All 44 Node cases, the expanded Edge headless workflows, and independent
reference reproducibility passed on October 29, 2026. Cross-panel editing and
coordinate lookup satisfy the phase-four acceptance gate. No new tools or
dependencies were needed. Layer tools are added in phase 5 below.

### Completed phase-five work

- Local and global maps now draw and edit roads, trails, rivers, all 11 landmark
  types, and independent labels. Native layer controls support keyboard access,
  path waypoint insertion/update/removal, landmark replacement/deletion, and
  label text, size, rotation, offsets, and anchor changes.
- Path drafts leave committed data untouched until Finish creates one undo
  command. Cancel/Escape discards the draft. Draft status and page-exit protection
  prevent silent loss; Save/Open/New and competing edits are blocked while
  navigation remains available.
- The DOM-independent `MapLayerEditor` validates physical points and inserts
  paired seam coordinates between adjacent faces. Nonadjacent jumps and lines
  missing the shared edge fail explicitly. Existing seam pairs survive editing
  without floating-point rewriting.
- Canonical tile references enforce one landmark per tile while allowing
  multiple labels and overlapping paths. Partial tiles use a valid display
  anchor without changing persisted positions. Label text remains literal,
  including Unicode, newlines, and XML-sensitive characters.
- Canvas rendering clips layers to geometric faces/local hex outlines and
  rotates labels with unfolded neighbor faces. Independent visibility toggles
  are view state only. Native landmark glyphs remain provisional.
- Shared history now includes atomic layer edits and weighted limits covering
  path vertices and text as well as terrain. No-op edits retain redo.
  Version-1 ASCII round-trips and save-confirmation behavior are unchanged.
- `tests/layers.test.cjs` adds six cases covering mixed-layer transactions,
  validation/uniqueness, all 48 seams in both directions, waypoint changes,
  partial anchors, and history budgets. `tests/browser-layers.cjs` exercises
  native local/global layer editing, draft cancellation/unload protection,
  pixel-level visibility changes, periodic/irregular seam paths, partial-tile
  landmarks, actual downloads/reopening, and continued editing.
- `doc/LAYER_EDITOR.md` documents the workflow, API, and resource limits;
  local/global and persistence documentation now describe editable layers.

All 50 Node cases, the expanded Edge headless workflows, and independent
reference reproducibility passed on October 29, 2026. Connected paths, unique
landmarks, and persistent label properties satisfy the phase-five acceptance
gate. No new tools or dependencies were needed. Scale conversion and local
anchor transforms are added in phase 6 below.

### Completed phase-six work

- `MapScaleEditor` derives independent maps at all four resolutions within
  either supported family, without changing map kind or global world size.
  Refinement uses registered center sampling; coarsening uses clipped terrain
  overlap area with deterministic catalog-order ties.
- Local target grids preserve lattice phase, cover the old outline with
  default-terrain padding, and rebase their origin. Global conversions honor
  partial cells and canonical ownership across geometric fragments. Sparse
  iteration avoids enumerating an unpainted fine-resolution globe.
- Paths retain exact physical coordinates and seam pairs. Landmarks map to
  target tiles; collisions reject the whole conversion rather than deleting
  data. Labels retain physical text positions through new tile offsets and
  frame rotations, including rendering on an adjacent geometric face when
  conversion changes the owning panel.
- Native conversion controls retain up to eight source editing sessions,
  including undo history and pending save confirmations. Return restores a
  source; New/Open and unload warnings account for unsaved retained maps.
  Derived maps have independent IDs, files, edits, and history.
- Local anchors can be created from a selected global point, applied/removed
  through undoable forms, and used for forward/inverse coordinate navigation.
  Explicit clockwise planar transforms preserve nonzero origins and do not
  fold across seams. Outside-face positions are reported as planar references.
  Conversion rebases anchors without changing registration, or rejects an
  out-of-face origin atomically.
- `tests/scales.test.cjs` adds 11 cases for all resolution pairs, area-based
  aggregation, independent global area references, seams/partial cells, layer
  transfer, collision/resource rejection, and anchor/history invariants.
  `tests/browser-scales.cjs` exercises native conversion, retained-source
  protection and limits, anchor creation/editing/navigation, real downloads,
  reopening, continued editing, and reanchored-label visibility.
- `doc/SCALE_AND_ANCHORS.md` documents the exact policies, workflow, API, and
  resource limits. The ASCII format remains version 1. Conversion is bounded
  and synchronous at the core API; phase 8 adds cancellable worker execution.

All 61 Node cases, the expanded Edge headless workflows, and independent
reference reproducibility passed on October 29, 2026. Registered derived maps
and source preservation satisfy the phase-six acceptance gate. No new tools
or dependencies were needed.

### Completed phase-seven work

- The DOM-independent `MapSvgExport` core generates deterministic, standalone
  UTF-8 SVG for one global owning panel or a complete local extent.
  Normalized bounds retain every owned equatorial protrusion.
- Shared-edge splitting and ring tracing join terrain regions, preserve holes,
  and remove internal equal-terrain edges. Coastlines query canonical neighbor
  terrain across all seam types rather than treating panel cuts as water.
  Water/lakes/firth are aquatic; marsh/mangrove are wetlands; islands contain
  deterministic disjoint land silhouettes with internal shorelines.
- Panel-phased patterns wrap at their repeat boundaries and clip to complete
  terrain regions. All 17 terrain styles are supported, including individual
  large peaks and trunks only along exposed southern forest boundaries.
  Pattern fills do not acquire unintended region outlines.
- Roads, trails, rivers, vector landmarks, and literal multiline labels use
  geometric-face clips and the shared canonical/adjacent-face anchors.
  Output escapes XML and contains no executable content or external assets.
- The native export dialog offers ten independent layer controls and a global
  panel selector, starting from the active panel. Downloads preserve editing
  state, undo/redo, retained sources, and pending ASCII save confirmations.
  Active strokes/drafts disable export; modal shortcuts cannot edit behind it.
- `tests/svg-export.test.cjs` adds 12 cases covering deterministic regions and
  holes, every panel at 2/4/24 columns, irregular seam coasts, forest boundaries,
  disjoint island silhouettes, all layers/styles, XML text, scale families,
  insertion order, and tile/work/output limits.
  `tests/browser-svg.cjs` verifies native dialogs and real downloads, XML
  parsing, offline SVG rasterization, owned protrusion pixels, literal labels,
  independent layer output, pattern-outline regression, and save/history
  preservation through successful and rejected exports.
- `doc/SVG_EXPORT.md` documents the workflow, artwork, shoreline rules, API,
  and explicit limits: 25,000 tiles, 500,000 counted operations, and 16 MiB.
  The rendering core is bounded and synchronous; phase 8 runs it in a worker.

All 73 Node cases, the expanded Edge headless workflows, and independent
reference reproducibility passed on October 29, 2026. The exported terrain
atlas was visually reviewed. No additional tools or dependencies were needed.
Phase-eight release hardening follows below.

### Completed phase-eight release hardening

- The standalone HTML builds native Blob workers from its own inline cores.
  Open/validation, Save/serialization, fill, conversion, SVG export, and
  undo/redo run off the UI thread, with no server, fetched scripts, or dependencies.
- A shared modal operation lifecycle provides indeterminate progress,
  **Cancel operation**, and Escape cancellation. Cancellation terminates the
  worker; late results cannot apply. Success, cancellation, timeout, startup,
  transfer, and execution failures all release worker/Blob resources.
- Strict file validation stays in `MapDocuments.parse`. Internal validated
  snapshots transfer sparse chunks and immutable layers without repeating
  geometric validation on the page. Prepared edits check revision/history
  identity before atomically applying only the affected state.
- Cancelled/failed work preserves the document, history, retained sources, and
  pending save confirmation. No partial import, fill, conversion, or download
  is published. A two-minute worker deadline reports an explicit failure.
  There is no blocking synchronous fallback when workers are unavailable.
- Immutable layer lists are cached independently of terrain changes.
  Path batches and label/landmark positions are cached; offscreen segments,
  symbols, and text are culled. Path/label selectors expose all records in
  200-record pages and preserve selection through edits and history.
- Dense views have explicit per-frame segment/symbol/text/layout budgets.
  Errors do not alter map data; hiding a costly layer allows recovery and
  saving. Sparse local extents and fine global worlds remain viewport-bounded.
- `tests/operations.test.cjs` and `tests/task-runner.test.cjs` add 13 cases:
  snapshots and ownership, core/worker parity, strict import errors, atomic
  local/global fill, history/checkpoints, stale-result rejection, actual Node
  worker cloning, culling, cancellation, resource cleanup, timeout, and retry.
- `tests/browser-release.cjs` exercises real Edge workers while offline:
  responsive cancellation of a real SVG workload, fill and native-file
  cancellation, unchanged save/history state, failure injection/retry,
  a 90,000-position path on a trillion-tile local extent, layer paging/editing,
  and recovery from an explicitly rejected 5,001-label view.
- `doc/RELEASE_HARDENING.md` records operational policies, browser coverage,
  internal transport boundaries, limits, and remaining bounded synchronous work.

All 86 Node cases, the complete native Edge acceptance workflow, independent
projection reproducibility, and whitespace checks passed on October 29, 2026.
All eight planned acceptance gates are complete. No additional tools or
dependencies were installed; work remains on `dev/global-map-editor`.

### Running the editor

Open `map-editor.html` directly in a browser; no server or build is required.
See `doc/LOCAL_EDITOR.md`, `doc/GLOBAL_EDITOR.md`, `doc/LAYER_EDITOR.md`, and
`doc/SCALE_AND_ANCHORS.md` for editing, navigation, conversion, and save/open
instructions. Finished export is documented in `doc/SVG_EXPORT.md`; cancellation,
large-map behavior, and runtime limits are in `doc/RELEASE_HARDENING.md`.

The read-only geometry workspace uses regional XL spacing, defaults to 24
columns, and limits interactive previews to 96 columns to avoid blocking the
UI. This preview limit is separate from the editor's global world width and
local-map extent.

From the repository root:

```powershell
node --test tests\geometry.test.cjs tests\documents.test.cjs tests\local-editor.test.cjs tests\global-editor.test.cjs tests\layers.test.cjs tests\scales.test.cjs tests\svg-export.test.cjs tests\operations.test.cjs tests\task-runner.test.cjs
python tools\generate_map_projection.py --labels --check
node tests\browser-smoke.cjs
```

The browser check uses a Node.js runtime with built-in `WebSocket` support and
defaults to Microsoft Edge on Windows. Set `BROWSER_PATH` to an installed
Chromium-based browser executable to override it. No npm dependencies are needed.
Pass an optional image filename to the browser check to capture an SVG terrain
atlas for visual review. The harness waits for browser download completion
events and uses unique download IDs before retaining and parsing actual files.

### Geometry API conventions

Panel coordinates are `[east, north]` in miles. Solid and net coordinates use
the reference construction's unit edge length. `panelToSolid` and `panelToNet`
are affine coordinate transforms, not terrain-ownership queries.

Use `locateTile(world, geometricFaceId, point)` to resolve the canonical terrain
owner. `tileGeometry` returns one owned tile and its positive-area fragments.
Each fragment carries a geometric face ID and an offset: subtract the offset
from its polygon coordinates to express them in that geometric face.
A grid cell with no map intersection has an empty fragment list.

`tiles` is a lazy iterator with an optional panel-coordinate viewport.
`neighbors` returns reciprocal edge-sharing neighbors, including periodic
equatorial neighbors and one-to-many neighbors across clipped panel edges.
Point-only corner contacts are not neighbors. Longitude and true north heading
are explicitly `null` at a pole.

## Constraints and decisions

- Ship a single offline `map-editor.html` with native controls, inline JavaScript
  and CSS, and no external runtime dependencies, assets, server, or build step.
- Node.js is permitted only for development tests in external `.cjs` files.
- Preserve the supplied exact-radical chamfered cube, fixed hinge tree, face IDs,
  sector names, vertex correspondence, and paired cut seams.
- Panel-plane coordinates and distances are authoritative. No spherical
  projection can simultaneously preserve all areas, distances, and angles.
- Use radial sphere/polyhedron projection for optional true coordinates.
  Spherical coordinates must not change the panel-plane editing geometry.
- Integer scale ratios provide commensurate spacing, not exact containment of
  whole small regular hexagons in a large regular hexagon. Store lattice origins
  explicitly and define deterministic cross-scale sampling.
- Keep viewport zoom separate from authored resolution. Derived maps do not
  silently overwrite their sources.
- Keep local and regional scale families separate. A local map can reference a
  global location without promising tile-for-tile alignment across families.

## Architecture

Keep the following components logically separate inside the HTML:

| Component | Responsibility |
| --- | --- |
| Projection | Solid/net geometry, panel frames, seam transforms, spherical conversions |
| Hex grid | Integer tile identity, polygons, clipping, neighbors, scale transforms |
| Map model | Terrain, paths, landmarks, labels, document metadata |
| Commands | Atomic edits and undo/redo |
| View | Canvas drawing, pan, zoom, selection, hit testing |
| Persistence | Versioned ASCII serialization, parsing, validation |
| SVG export | Regions, shorelines, artwork, layer selection |
| UI | Native controls, dialogs, keyboard handling, error messages |

Geometry and other core operations must be DOM-independent. Tests load the
actual inline core rather than maintaining a second implementation.

## Phase 1: geometry foundation

### Reference and coordinate frames

Retain the supplied Python generator as an independent development reference.
Generate reproducible JSON and SVG fixtures from its exact construction.
The browser must construct its own geometry without fetching those files.

Required invariants:

- Solid: 32 vertices, 48 edges, 18 faces; 12 hexagons and 6 squares.
- Net: 62 vertices, 79 edges, 17 hinges, and 31 paired cut seams.
- Unit edges, specified face angles, outward face winding, and no face overlap.
- Every solid face appears exactly once in the net.
- Seam endpoints match by solid vertex ID, not nearest displayed position.
- Preserve all Greek-sector assignments and the specified prime meridian.

Each panel has its own north/east frame, a transform to the unfolded net, and
a transform to the 3D solid. North follows the polar-vertex axis projected into
the face plane. Do not confuse the orientation of a panel in the net with its
own north direction.

### Grids and scale

Use integer axial `(q, r)` coordinates with center spacing `d`:

```text
east  = originEast  + sqrt(3)/2 * d * q
north = originNorth + d * (r + q/2)
```

Non-equatorial panels have a primary column at east zero. Equatorial panels
have an even number of columns with their centerline between columns.

The global size setting `N` is a positive even integer, default 24:

```text
diagonal span = N * 216 miles
panel width   = diagonal span * sqrt(3)/2
```

At the default, panel width is approximately 4,489.48 miles and the planar
equatorial circumference is approximately 26,936.85 miles.

| Scale family | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Local | 1 yard | 10 yards | 100 yards | 600 yards |
| Regional | 1 mile | 6 miles | 36 miles | 216 miles |

### Ownership and boundaries

Use one geometry service for rendering, hit testing, later painting, storage,
and export:

- Treat the equatorial strip as one periodic lattice. Assign whole seam hexes
  to one panel by column, including the wraparound.
- Distinguish the geometric face containing a point from the tile-owning panel.
- Clip other boundaries to the nominal faces. Include every positive-area
  fragment, even if its hex center is outside its panel.
- At equatorial seam endpoints, clip owned tiles to the union of the adjoining
  equatorial faces, not extended individual edge half-planes. This avoids
  stealing terrain from the adjoining polar/square panel at a corner.
- Represent a tile crossing an equatorial seam with geometric face fragments
  but one canonical tile ID. Fragment splits are not extra terrain cells.
- Match shared seam intervals for adjacency; partial tiles can have more than
  one neighbor across a seam.
- Use deterministic tie-breaking for exact edges and vertices.

Phase 1 includes a read-only geometry preview, not editing controls. Completion
requires reference agreement and focused automated coverage of transforms,
ownership, partial coverage, seam neighbors, and equatorial wraparound.

## Phases 2-6: model and editor

Documents record map identity, extent type, scale family, resolution, panel
size, projection version, and optional global anchor/orientation.

- Terrain: one of the 17 requested values per owned tile.
- Roads, trails, rivers: ordered, panel-qualified coordinate sequences; multiple
  paths can cross a tile. Paired seam points preserve cross-panel continuity.
- Landmarks: one of the 11 requested types, at most one per tile.
- Labels: independent tile-anchored text, size, rotation, and optional offset.
- Local maps: explicit rectangular width/height and lattice origin.

Use a tool palette, central canvas, property inspector, and coordinate/status
bar. Add terrain brushes, fill/erase, path/vertex editing, landmark replacement,
label editing, layer visibility, navigation, and keyboard access. A brush
stroke or complete path edit is one undo operation. Terrain edits leave other
layers intact.

Implemented cross-resolution conversion uses center sampling for refinement
and greatest covered area for aggregation, with stable ties. Source maps remain
independent. An anchored local map stays planar even when its anchor refers to
a global panel; see `doc/SCALE_AND_ANCHORS.md` for exact policies and limits.

Use chunked terrain storage, declared default terrain, viewport culling, cached
geometry, and incremental redraw. Regional S has 46,656 times the approximate
cell density of XL. Do not eagerly allocate a fine-resolution globe.

### ASCII format

The implemented version-1 contract is documented in `doc/ASCII_FORMAT.md`.
The following requirements guided that implementation:

Define a versioned metadata header and fixed-width terrain sections. Each
section records its origin and dimensions. Each terrain has a stable printable
ASCII character; reserve a different marker for outside-panel positions.
Omitted chunks mean declared default terrain, not missing or outside terrain.

Append structured paths, landmarks, and labels as ASCII-escaped JSON records.
Unicode text, including Greek characters, uses JSON escapes without information
loss. Use deterministic ordering and numeric formatting.

Validate an entire imported document before replacing the current map. Report
bad rows, unknown codes/versions, invalid coordinates, duplicate landmarks, and
broken references; do not silently discard them.

## Phase 7: SVG export

Export one global panel at a time, or a local-map extent. A native dialog
selects colors, embellishments, shorelines, paths, landmarks, labels, grid, and
panel guides independently.

Reuse owned tile fragments. Trace connected terrain regions by splitting
boundary segments, removing interior edges, and assembling outer rings/holes.
Query neighbors across panel seams so a cut edge does not become a false coast.

Implemented water semantics: water/lakes/firth are
aquatic; mangrove is a wetland; islands have generated land polygons in water.
Island shorelines require those internal polygons.

Place deterministic artwork in panel coordinates and clip it to full terrain
regions, not separately phased tiles. Implement the requested hill curves,
mountain peaks, desert marks, dunes, forest canopy, marsh, and tundra marks.
Forest trunks belong only along exposed southern forest boundaries.

Implemented additional styles are island silhouettes, differentiated lake/firth
water, mangrove roots/canopy, canyon hatching, badlands ridges, and farmland
furrows. Plain and open water have no embellishments.

SVG must be self-contained, correctly escape text, and contain no executable
content or external assets. Bounds must preserve owned equatorial protrusions.

## Phase 8 and acceptance gates

Phase 8 implements shared cancellable worker execution and atomic result
adoption, followed by viewport/cache/list hardening and native browser failure
and responsiveness checks. Verification retains every earlier acceptance gate;
no dependency installation, file-format migration, or main-branch merge is needed.

| Phase | Acceptance gate |
| --- | --- |
| 1 | Correct closed solid, coordinate transforms, coverage, ownership, and seam topology |
| 2 | Lossless ASCII round-trips, including partial tiles and Unicode labels |
| 3 | Create, edit, save, reopen, and continue editing a local map |
| 4 | Cross-panel editing and coordinate lookup agree |
| 5 | Connected paths, unique landmarks, and persistent label properties |
| 6 | Deterministic registration and conversion without silent scale mixing |
| 7 | No false coastlines, pattern breaks, missing fragments, or unintended layers |
| 8 | Usable large maps, offline operation, cancellation, and explicit failures |

Tests should cover negative coordinates, coordinate round-trips, scale offsets,
all seam types, corners, undo/redo, malformed imports, ASCII-only serialization,
deterministic SVG, and XML-sensitive labels. Browser checks cover disk loading,
downloads, dialogs, pointer interaction, and keyboard access.
