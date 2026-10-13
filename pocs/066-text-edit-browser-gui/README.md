# PoC 066 — browser GUI on TextEdit 0.8.1

This experiment exercises rendering, viewport, pixel hit-testing, font metrics, scrolling, keyboard input and mouse/drag using the **existing TextEdit library**. It deliberately contains no alternate document or selection engine.

## Launch

The local checkout layout is `rumiai-os/src/rumiai-dev-PoCs`, not sibling repositories. Serve `rumiai-os` as the local web root:

```sh
cd /path/to/rumiai-os
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/src/rumiai-dev-PoCs/pocs/066-text-edit-browser-gui/`.

The script loads `/lib/sys/js/text-edit.lib.js` from the containing `rumiai-os` checkout through `../../../../lib/sys/js/text-edit.lib.js` and checks the real `TextEdit.VERSION === '0.8.1'`. No remote CDN, npm package or bundler is required to run the demo. A modern browser with `Intl.Segmenter` is needed.

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

## Deliberately excluded

History/undo, files, clipboard, remote collaboration and IME. Composition events are ignored rather than claimed supported. This is not an implementation of native browser text input or an accessibility-complete editor.

The grid policy is *experimental*: it tests measured font fallback, fractional pixel advances and logical-column matching. A font-family or mode switch changes representation metrics, not document characters or effective physical selection coordinates. It is not a final East Asian Width / emoji / bidirectional-text contract; unsupported layouts and text over the current per-row projection bound remain explicit limits.

The 100,000-line fixture intentionally includes the Unicode suffix `😀e\u0301` every 97 rows, including row 50,053 (1-based). The gutter stays inside each DOM row, not in an independently scrolling column.

The current experiment intentionally refuses ambiguous RTL/complex shaping, limits editable long-line prefixes to 1,024 UTF-16 units and uses a fixed 24 px row height and no wrapping. It is not a performance guarantee or MadEdit-Mod parity claim. Test these constraints before promotion into a product GUI contract.

Provisional PoC code and trial results stay here; permanently adopted behavior must be promoted into canonical contracts and tests in their respective repositories.
