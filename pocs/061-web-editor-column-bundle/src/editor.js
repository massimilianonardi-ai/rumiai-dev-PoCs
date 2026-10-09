import { EditorState } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

// Experimental browser-only adapter. No Node or Electron dependency is exposed.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-scroller': { overflow: 'auto' }
});

export function createEditor(parent, options = {}) {
  if (!parent || typeof parent.appendChild !== 'function') {
    throw new TypeError('createEditor requires a DOM parent element');
  }

  let columnMode = Boolean(options.columnMode);
  const state = EditorState.create({
    doc: String(options.value ?? ''),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      // Alt+drag always works; enabling column mode also allows plain drag.
      rectangularSelection({ eventFilter: (event) => columnMode || event.altKey }),
      crosshairCursor(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      theme
    ]
  });
  const view = new EditorView({ state, parent });

  return {
    setColumnMode(value) { columnMode = Boolean(value); },
    isColumnMode() { return columnMode; },
    getValue() { return view.state.doc.toString(); },
    setValue(value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: String(value) }
      });
    },
    getSelections() {
      return view.state.selection.ranges.map(({ from, to }) => ({ from, to }));
    },
    focus() { view.focus(); },
    destroy() { view.destroy(); }
  };
}
