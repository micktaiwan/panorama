/**
 * ProseMirror NodeView for toggle_block nodes.
 * Uses a div with CSS display toggle. State (expanded/collapsed) is stored
 * as a node attribute and persisted in markdown (???+ open, ??? closed).
 */
export class ToggleBlockView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Outer container
    this.dom = document.createElement('div');
    this.dom.className = 'toggle-block';

    // Header row: arrow + summary text
    this.header = document.createElement('div');
    this.header.className = 'toggle-block-header';
    this.header.setAttribute('contenteditable', 'false');

    this.arrow = document.createElement('span');
    this.arrow.className = 'toggle-block-arrow';
    this.arrow.textContent = '\u25B6';

    this.summarySpan = document.createElement('span');
    this.summarySpan.className = 'toggle-block-summary';
    this.summarySpan.textContent = node.attrs.summary;

    this.header.appendChild(this.arrow);
    this.header.appendChild(this.summarySpan);
    this.dom.appendChild(this.header);

    // Click on header → toggle
    this.header.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._toggle();
    });

    // Double-click on summary text → edit
    this.summarySpan.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._editSummary();
    });

    // Editable content area
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'toggle-block-content';
    this.dom.appendChild(this.contentDOM);

    // Apply initial state from node attrs
    this._applyExpanded(node.attrs.expanded);
  }

  _applyExpanded(expanded) {
    this.contentDOM.style.display = expanded ? '' : 'none';
    this.dom.classList.toggle('toggle-block-collapsed', !expanded);
  }

  _toggle() {
    const pos = this.getPos();
    if (pos === null || pos === undefined) return;
    const newExpanded = !this.node.attrs.expanded;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, expanded: newExpanded }),
    );
  }

  _editSummary() {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'toggle-block-summary-input';
    input.value = this.node.attrs.summary;

    const commit = () => {
      const value = input.value.trim() || 'Toggle';
      const pos = this.getPos();
      if (pos === null || pos === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, summary: value }),
      );
      this.view.focus();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.summarySpan.textContent = this.node.attrs.summary;
        this.view.focus();
      }
    });
    input.addEventListener('blur', commit);

    this.summarySpan.textContent = '';
    this.summarySpan.appendChild(input);
    input.focus();
    input.select();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.summarySpan.querySelector('input')) {
      this.summarySpan.textContent = node.attrs.summary;
    }
    this._applyExpanded(node.attrs.expanded);
    return true;
  }

  stopEvent(event) {
    return this.header.contains(event.target);
  }

  ignoreMutation() {
    return true;
  }
}
