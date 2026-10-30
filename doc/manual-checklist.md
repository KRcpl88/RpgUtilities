# Map Editor: Manual Browser Checklist

Use this checklist to test a release by hand in a current Chromium, Firefox or Safari. Unit tests (`node --test tests/`) cover the model, geometry, file format and SVG output. This list covers what only a person at a browser can see: drawing, input, dialogs and downloads.

## Setup

- [ ] Serve the repository with `python3 -m http.server 8000` and open `http://localhost:8000/map-editor/index.html`. Opening the file directly (`file://`) should also work.
- [ ] Open the developer console and keep it visible. **No errors or warnings may appear at any step.**
- [ ] If a **Restore** banner appears from an earlier session, click **Discard**.
- [ ] The status bar ends with `v1.0.0`.

## Start-up and navigation

- [ ] The demo world appears in the net view with 18 panel outlines and names. The minimap shows the whole net.
- [ ] Mouse wheel zooms about the cursor. The hex grid appears once hexes are about 8 px across, and the map is smooth at every zoom level.
- [ ] Pan with middle-drag, right-drag, Space+drag, the **Pan (H)** tool and the arrow keys (Shift pans faster). `+`/`=`/`-` zoom.
- [ ] **Home** / **Fit all** fits the net. Double-click a panel with the Pan tool, or press `P`: the focus view shows that panel outlined in yellow with its neighbours folded around it and dimmed. **Fit panel** / `F` fits it, and **Net view** / `N` returns.
- [ ] **Focus panel…** selects each of the 18 panels.
- [ ] Clicking the minimap recentres the net view, or refocuses on the clicked panel in the focus view.
- [ ] Hovering a tile shows, in the status bar: the universal coordinate (for example `Beta 1403.0W 0.0N`), `true` latitude/longitude, the true-north note, panel letter/column/row, terrain and tile number.
  - [ ] On an equatorial panel (Alpha–Zeta) the note reads `true N = panel N`, and the centre of Alpha is near `0°N 30°W`.
  - [ ] On Eta, the centre is near `54.7°N 0°`. Its upper-left and upper-right corners show matching bearings (about 37.7° east and west of panel north).
  - [ ] Moving the cursor east increases longitude in °E (or decreases in °W). Moving it north increases latitude.
- [ ] Equatorial seams: in the focus view of an equatorial panel, hover the small tip of a neighbouring panel's edge hex that pokes across the seam. The status bar names the **neighbouring** panel's tile.

## Terrain tools and undo

- [ ] Click each of the 17 terrains in the Properties legend. The active swatch in the tool panel follows.
- [ ] **Brush (B)**: a stroke paints continuously, even when the cursor moves quickly. `[` and `]` change the radius (0–5), and the outlined footprint matches. A stroke across a panel seam continues on the other side.
- [ ] **Fill (G)** fills a connected region, including across seams. Filling with the same terrain does nothing.
- [ ] **Pick (I)** and Alt+click with any tool select the tile's terrain.
- [ ] Ctrl+Z and **Undo** undo one whole stroke or fill; Ctrl+Y, Ctrl+Shift+Z and **Redo** redo. The buttons are disabled when nothing is left to undo or redo. The status message names each action and tile count.

## Features

- [ ] **Path (O)**: choose road, trail or river, click **New path**, and click distant tiles. Gaps fill with the shortest connected route, including across seams. Escape finishes.
- [ ] Select a path and test **Extend end**, **Insert after point**, **Remove point**, **Split at point** and **Join paths** (with another path of the same type). Edit its name and style. Each operation is one undo step.
- [ ] Rivers are blue, roads brown and trails dashed. Curves stay smooth across seams in both the net and focus views.
- [ ] **Landmark (K)**: place each of the 11 landmark types. Placing on an occupied tile replaces the landmark. Edit name and notes. Properties show the tile's universal and true coordinates.
- [ ] **Label (T)**: add labels of each category (region, location, city). Change size, rotation and offsets. Drag the white handle to move and the yellow handle to rotate; Escape during a drag cancels it. **New label** adds a second label on the same tile.
- [ ] **Select (V)**: on a tile with several features, choose each from **Features on this tile**. Delete/Backspace removes the selected feature.
- [ ] **Erase (E)**: each target layer erases only that layer. Terrain erase turns just the clicked tile to water.
- [ ] Hide a feature layer: its features disappear and cannot be selected or erased. Show it again.
- [ ] Toggle every layer (Terrain, Hex grid, Panel outlines, Panel names, Roads, Trails, Rivers, Landmarks, Labels, Equator and poles).
- [ ] Equator and poles: the red equator follows true latitude 0 across Alpha–Zeta in net and focus views. Crosshair circles labeled N/S mark the polar vertices on Eta/Theta/Iota and Kappa/Lambda/Mu. Hiding the layer removes all references without changing the map.

## New map dialog

- [ ] **New** opens a dialog. While it is open, editor shortcuts (B, Ctrl+Z, arrows…) do nothing. Cancel leaves the map unchanged.
- [ ] Global: try invalid panel hexes (odd, 0, blank) and see the validation messages. Create n = 8 XL; if the current map has unsaved changes, confirm the discard prompt. Rejecting the prompt keeps the old map.
- [ ] The panel-size label explicitly says XL hexes regardless of tile scale; switching L/XL changes tile density, not the physical panel size.
- [ ] Single panel: choose an equatorial, polar or square panel and create it at M, L and XL. Only the complete selected panel appears; edge hexes have no gaps, and brush/fill/paths stop at its boundary. Net/focus controls are disabled; Fit all, Fit panel, minimap, undo and all feature tools work.
- [ ] Switching from single-panel M to global world removes the M option. Cancel preserves the previous map. Save/reopen and autosave/restore preserve the single-panel kind, selected panel, scale and edits.
- [ ] Local: create a map at each of the eight scales (regional S/M/L/XL, local S/M/L/XL). Regional anchors preview their snapped position; yard anchors stay free. Net/focus controls and panel names are disabled for local maps, and all tools work.
- [ ] Global n = 24 with L tiles: "Building map…" appears and the buttons are disabled for about a second; then a 218,088-tile map appears.

## Save, open and autosave

- [ ] **Save** / Ctrl+S downloads `<name>.map.txt` and clears the `*` from the status bar.
- [ ] **Open…** / Ctrl+O: open the saved file. The map, features and name are restored, and history is cleared.
- [ ] Open `map-editor/samples/sample-world.map.txt` and `sample-valley.map.txt`. Both show all 17 terrains; the valley shows every landmark type, label category and overlay type, and the world's routes cross panel seams.
- [ ] Opening a non-map text file shows an error and keeps the current map.
- [ ] Edit, wait 3 seconds, and reload the page: a **Restore** banner appears. **Restore** brings back the edits (either map kind); reloading again and choosing **Discard** removes it.

## SVG export

- [ ] **Export SVG** opens a dialog. The scope defaults to the focused, selected or centre panel (or **Whole local map**). Width validation rejects 0 and non-integers.
- [ ] Layer checkboxes start from the canvas visibility, with shorelines and terrain embellishments on and landmark names off. Changing them does not change the canvas.
- [ ] A single-panel map exports only its chosen panel (scope cannot change). Equator and poles follow their checkbox in global, single-panel and local exports.
- [ ] **Download SVG** downloads `<name>-<Panel>.svg` (or `<name>.svg` locally). The map stays unsaved (`*`) and undo history is unchanged. The status bar reports the size and time.
- [ ] Open the SVG in the browser: the panel is north-up and clipped, outside areas are transparent, and the content matches the editor:
  - [ ] terrain colours, terrain patterns (hills, peaks, trees with trunks on southern forest edges, dunes, fields…) clipped to their regions;
  - [ ] smoothed shorelines only between land and water;
  - [ ] roads, trails, tapered rivers, landmark symbols (and names if enabled), labels with halos;
  - [ ] an equatorial panel export includes the neighbour's edge-hex tips with their own terrain.
- [ ] With terrain colours off, the background is transparent and filled motifs are white.
- [ ] On an n = 24 L map, the export dialog for a forested or mixed panel shows the **Large export** warning. Download shows "Exporting…" with disabled buttons, then finishes within a few seconds. With embellishments off, the warning disappears.

## Finish

- [ ] The console shows no errors or warnings.
- [ ] Clear `localStorage['rpgmap.autosave']` (or click **Discard** on the next load) so that testing leaves nothing behind.
