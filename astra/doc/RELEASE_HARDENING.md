# Release hardening

Open `map-editor.html` directly from disk. The application remains a single
offline file: no server, package installation, build, external fonts, assets,
or worker-script downloads. The version-1 `.hexmap` format is unchanged.

## Background operations and cancellation

Open, Save a copy, flood fill, resolution conversion, SVG export, undo, and
redo use disposable native workers assembled from the HTML's inline cores.
The progress dialog is indeterminate: it does not claim an estimated percentage.
Editing and competing commands are disabled until the operation finishes.

Choose **Cancel operation** or press Escape to terminate work. Cancellation
also works during startup, before a worker has received the request.
The current document, undo/redo history, saved revision, pending download
confirmation, and retained source maps are unchanged. Cancelled Open does not
reach the discard prompt; cancelled conversion does not retain another source.
Cancelled SVG leaves its options dialog open.

Only a completed result is published. Fill is still one undo command; history
restores the original revision/checkpoint. Open validates the entire file before
asking whether to discard unsaved work. Save and SVG request a download only
after producing complete output. **Confirm file saved** still requires the
user to check the downloaded ASCII file; background completion does not mark
the map saved. Cancellation cannot recall a download already requested after
successful completion.

Startup, cloning/transfer, worker execution, malformed responses, unreadable
messages, and operation-specific validation/resource failures are reported
explicitly. A worker exceeding two minutes is terminated with an error.
Every completion path releases the worker and its Blob URL; stale messages
cannot publish results or interfere with a later job. Retrying creates a new
worker. There is no synchronous fallback if worker startup is unavailable or
blocked: use a browser/environment that supports the required APIs.

Leaving the page while busy prompts even when the map was previously saved.
Save copies before closing; there is no server-side or automatic backup.

## Large maps and rendering

Sparse terrain allocation and viewport tile enumeration are unchanged.
Navigation does not allocate or render a whole globe or local extent.
Readable minimum zoom remains in effect; **Fit / center map** is not an
unlimited whole-map preview.

Immutable layer lists are cached until that layer changes. Terrain edits do
not rebuild path/label selectors. Selectors contain up to 200 records plus
their empty choice; Previous/Next controls reach all records. Selection follows
new/edited records to their page and survives history updates.

Path geometry is cached in bounded batches with panel-coordinate bounding
boxes; invisible batches and segments are skipped. Landmark anchors and
label positions/layout are cached by immutable record and map identity.
Offscreen symbols/text are culled with conservative bounds; labels near a
viewport boundary are not discarded merely because their anchor is outside.
Unchanged layer records retain their caches across terrain fill and undo/redo.

One canvas frame permits:

| Work | Maximum |
| --- | ---: |
| Visible path segments | 100,000 |
| Visible landmarks, labels, and draft-point markers combined | 5,000 |
| Visible label text, in UTF-16 code units | 200,000 |
| Newly laid-out label text, in UTF-16 code units | 1,000,000 |
| Rendered label font size | 4,096 pixels |

Exceeding a rendering budget reports an error, not success with silently
discarded data. The canvas may be incomplete for that frame; stored records
are unchanged and can still be saved/exported under those operations' own
limits. Hide a costly layer, simplify it, or zoom in. A successful redraw
clears the rendering error without clearing unrelated operation errors.

These are processing safeguards, not fixed frame-time guarantees. Rendering,
snapshot cloning/adoption, bounded brush strokes, and interactive waypoint
updates still execute on the page. Interactive drafts retain the existing
10,000-waypoint limit; imported paths permit 100,000 positions. Dense or very
large documents may require hiding layers or smaller operations.

Other established limits remain: 16 MiB ASCII files, 25,000 changed tiles per
stroke/fill, 100 history commands/100,000 weighted history units, eight retained
source sessions, conversion's 100,000 candidates/500,000 work units, and SVG's
25,000 tiles/500,000 work units/16 MiB output. Valid model coordinates do not
guarantee every whole-map conversion or export fits these budgets.

## Internal transport contract

`MapOperations.execute(request)` is the shared DOM-independent dispatcher.
`MapTaskRunner.Runner` owns startup, one active job, cancellation, timeout,
error reporting, and cleanup. Workers run the same geometry, persistence,
editing, conversion, and SVG cores as the existing direct synchronous APIs.

`MapDocument.snapshot()` carries metadata, sparse chunk entries, and sorted
immutable layer records through structured cloning.
`MapDocuments.restoreValidated(snapshot)` is **internal trusted transport**,
not an importer or a replacement for validation. It may consume only snapshots
of existing validated models or completed embedded-worker results. Never pass
file JSON or other untrusted objects to it: external files always go through
the strict `MapDocuments.parse` path. Restoration freezes layer records and
constructs private storage without repeating expensive geometric validation
on the UI thread.

Prepared fill/history results are accepted only for the expected revision and
history command. Candidate map identity/metadata must match. Adoption replaces
only the affected state, detaches mutable terrain/landmark indexes, preserves
document identity and unaffected immutable records, and advances history only
after success. Failed or cancelled operations never adopt candidate storage.

## Verification and prerequisites

The local release workflow uses Node's built-in test runner and worker threads,
Python for the independent projection reference, and native Edge headless/CDP.
No npm packages or Playwright are needed. Missing tools must be supplied before
running their checks; no dependency installer is part of the application.

Native browser acceptance covers disk loading with networking disabled,
real Blob workers, cancellation during a real SVG computation while timer/input
events remain responsive, native-file/fill cancellation, startup/transfer failure
recovery, retry/downloads, unchanged dirty/history/pending-save state, a
90,000-position path on a trillion-tile local extent, paged layer editing, and
recovery from an explicitly rejected dense-label view.

Only the installed Windows Edge browser was exercised for this release.
Other browsers are not certified by these checks. Runtime requirements include
Canvas 2D, native dialogs, File/Blob, structured cloning, and Blob-backed workers.
See `IMPLEMENTATION_PLAN.md` for verification commands and completion status.
