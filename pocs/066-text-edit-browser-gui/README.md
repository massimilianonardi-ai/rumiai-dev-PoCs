# PoC 066 — browser GUI on TextEdit 0.8.2

This experiment exercises rendering, viewport, pixel hit-testing, font metrics, scrolling, keyboard input and mouse/drag using the **existing TextEdit library**. It deliberately contains no alternate document or selection engine.

## Launch

The local checkout layout is `rumiai-os/src/rumiai-dev-PoCs`, not sibling repositories. Serve `rumiai-os` as the local web root:

```sh
cd /path/to/rumiai-os
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/`.

The script loads `/lib/sys/js/text-edit.lib.js` from the containing `rumiai-os` checkout through `../../../../lib/sys/js/text-edit.lib.js` and checks the real `TextEdit.VERSION === '0.8.2'`. No remote CDN, npm package or bundler is required to run the demo. A modern browser with `Intl.Segmenter` is needed.

## In scope

- DOM rows bounded to the visible viewport, line numbers, vertical/horizontal scroll, fixed line height and bounded line-prefix reading
- Grapheme-boundary pixel hit-testing measured through browser DOM Range, with explicit rejection when the measured shape is ambiguous
- Carets and selected-range overlays over the actual view
- Click and drag selections; Alt+drag rectangle through `TextEditAdvancedSelections`; edge drag auto-scroll
- Arrow keys, Shift+Arrow, Home/End, PageUp/Down, Ctrl/Cmd+A, Backspace/Delete, Enter, Tab and ordinary direct key text through `TextEdit.replace()`
- Monospaced/proportional font switch for actual browser font-geometry testing; text and selections remain unchanged
- Two-way `Larghezza naturale` versus `Griglia a celle` PoC: native browser advances versus measured one/two-or-more-cell grapheme spans on the SAME source document
- Grid cell width comes from measured ASCII zero advance in the selected font; CJK/emoji start with two logical cells while glyphs too wide for the current font fallback reserve additional integer cells; decomposed accents remain one grapheme, tabs go to the next logical four-cell stop. The GUI feeds this candidate policy to the existing `TextEditRepresentation.setColumnMetrics({tabSize,widthOf})`
- Pixel hit testing and drawn selections map directly to grapheme source boundaries in either mode; grid DOM spans are disposable view fragments, not source mutation
- If a rectangular drag intersects a partial wide grapheme/tab and `TextEditAdvancedSelections` rejects it, the GUI retains the previous valid selection and warns; it does not silently split text or invent another selection owner
- Native scrollbar dragging must not create or extend text selections
- A 100,000-line fixture and an observable `window.__guiProbe.snapshot()`

## Separate 2D representation-element experiment

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/regions.html` (also linked from the main editor). This **separate browser page** explores a deliberately minimal axis-aligned rectangle model over the same stable TextEdit 0.8.2 library; it does **not** replace the working GUI or introduce new product exports.

- A tab spans three cells at tab stop four and maps to a single real source `\t`.
- A folded region spans six display cells on one projected visual row while mapping to three hidden physical source lines, using a real `TextEditRepresentation.setReplacements` overlay.
- A source-less annotation occupies four cells across two visual rows and is anchored using real `TextEditRepresentation.setAnnotations`.
- Each region can be configured as unselectable (`none`), selected on any overlap (`touch`), or selected only upon complete coverage (`full`). Ordinary ASCII/grapheme cells use the same experimental overlap rule. Configurable rules are proof-of-concept only, not new TextEdit APIs.
- A requested grid rectangle is **not** itself rendered as an effective selection. Only resolved, selected whole regions receive highlighting. Real source-backed regions are translated to physical source ranges, merged and given to the existing `TextEditSelections` owner; no overlapping physical target is duplicated. Visual-only regions can be selected for highlighting but provide **no physical edit target**.
- The replace action uses only the actual `TextEdit.replace()` facade. Selecting never modifies source content. A selected fold may replace a multi-line source interval; its overlay is invalidated normally on committed edits. Test reset restores the original fixture.
- A genuine Chromium regression explicitly compares selection past EOL with `TextEditAdvancedSelections` in `clipped` mode, proving the same *requested geometry versus effective selection* distinction already exists in the stabilized engine. It does not claim to implement a generalized source/view-row mapping or reuse the advanced selector to resolve the new region policies.

The geometry resolver is intentionally local to this PoC. Current TextEditRepresentation has source-mapped **linear** overlays/annotations and source-row metrics, but lacks generalized multi-row view layout and region selection rules; current TextEditAdvancedSelections retains its existing selection-policy contract. This experiment does not answer overlapping-region precedence, caret/navigation inside fold placeholders, editing visual-only regions, arbitrary shapes, viewport virtualization for thousands of projected regions, or semantics of user-configurable presets. The 2D page handles a tiny deterministic fixture only. Do not promote it to a product API or claim full browser editor integration based solely on these tests.

## Configurable oriented-selection input and cursor behavior

Both browser pages expose an **opt-in** reverse-grapheme input checkbox, initially off. A selected payload is reversed **per physical selection** whenever that selection's explicit `forward` is false. The operation does not inspect whether the selections originated from a rectangle, an ordinary linear mouse drag or other constructors. `Intl.Segmenter` reverses complete Unicode grapheme clusters independently within each line; existing LF, CR and CRLF separators keep their positions. Disabling the checkbox leaves the payload's characters unchanged, but does not rewrite the selection's orientation.

- All selection APIs produce one ordinary ordered `{start,end,forward}` collection owned by `TextEditSelections`. There is no saved selection-kind flag or persistent rectangle identity. A rectangle constructor assigns entries in the requested vertical row traversal order and `forward` from the horizontal direction. `lineSelection()` creates a single forward selection regardless of endpoint order. `virtual` and `clipped` remain separate high-level **selection construction** policies, not input policies.
- The production TextEdit 0.8.2 selector atomically replaces all selected ranges, retaining each selection's index and `forward` while collapsing it to a caret. **Forward** caret results appear after their inserted text; **reverse** caret results are placed at its beginning (after any virtual padding). Consecutive single-grapheme key input therefore inserts successive characters to the *left* of a reverse caret without special reverse-typing mode. For bulk reverse insertion, enable the checkbox to reverse the full grapheme sequence as well.
- The GUI's one-value-per-selection array accepts entries in current selection order, not document row order: a bottom-up selection receives the first array entry at the bottom. The PoC commands require array count to equal the number of physical targets and show immediate validation errors/success feedback; the underlying TextEdit selector has its own documented normalization rules.
- In the 2D regions page a visual-only annotation has no source selection and cannot be edited. After a successful edit of source-backed regions, their highlights clear, but the physical selected carets remain and can be used for subsequent replacements. Input direction depends only on those physical carets.
- Reversing **each multi-grapheme payload** remains PoC-local input-adapter behavior: the TextEdit engine does not permute input content, record a gesture's origin, or implement clipboard/IME. Direction-aware caret positioning and always-forward line selection are the stable TextEdit 0.8.2 engine behaviors protected by permanent tests.

## Operator-visible replacement feedback (2026-10-14)

The browser GUI now shows the current physical selection count and the current newline-delimited array-entry count **next to the replacement buttons**, with visible inline errors and success confirmations. The main GUI begins with one valid insertion caret but the sample array contains three entries; the array action therefore rejects this mismatch **without modifying the document** until the operator provides exactly one entry per physical selection. Both pages include a versioned script URL to avoid confusing a newly updated HTML view with an older cached GUI script.

The 2D region page deliberately begins with no editable source target, so both replacement buttons are disabled with a nearby explanation until a source-backed region is selected. Selecting a visual-only annotation does not authorize source replacement. After a successful edit, the highlighted 2D region selection clears, but the underlying oriented physical carets remain valid and the replacement buttons stay available so that consecutive editing works without reconstructing the original gesture.

New real Chromium tests click both button types, confirm the initial mismatch is reported within the viewport, exercise successful replacements, verify initial disabled/no-source conditions and enabled post-edit carets, and protect all previous editor interactions. The 2D geometry is still experimental and the new TextEdit 0.8.2 caret contract is exercised.

## Deliberately excluded

History/undo, files, clipboard, remote collaboration and IME. Composition events are ignored rather than claimed supported. This is not an implementation of native browser text input or an accessibility-complete editor.

The grid policy is *experimental*: it tests measured font fallback, fractional pixel advances and logical-column matching. A font-family or mode switch changes representation metrics, not document characters or effective physical selection coordinates. It is not a final East Asian Width / emoji / bidirectional-text contract; unsupported layouts and text over the current per-row projection bound remain explicit limits.

The 100,000-line fixture intentionally includes the Unicode suffix `😀e\u0301` every 97 rows, including row 50,053 (1-based). The gutter stays inside each DOM row, not in an independently scrolling column.

The current experiment intentionally refuses ambiguous RTL/complex shaping, limits editable long-line prefixes to 1,024 UTF-16 units and uses a fixed 24 px row height and no wrapping. It is not a performance guarantee or MadEdit-Mod parity claim. Test these constraints before promotion into a product GUI contract.

Provisional PoC code and trial results stay here; permanently adopted behavior must be promoted into canonical contracts and tests in their respective repositories.
