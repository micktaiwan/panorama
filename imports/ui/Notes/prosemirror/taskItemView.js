/**
 * NodeView for list_item that renders a checkbox when checked !== null.
 * Normal items (checked === null) get standard <li> rendering.
 * Task items get <li class="task-item"> with <input type="checkbox">.
 */
export class TaskItemView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('li');
    this.checkbox = null;

    if (node.attrs.checked !== null) {
      this._buildTaskItem(node.attrs.checked);
    } else {
      this.contentDOM = this.dom;
    }
  }

  _buildTaskItem(checked) {
    this.dom.className = `task-item${checked ? ' task-item-checked' : ''}`;
    this.dom.dataset.checked = checked ? 'true' : 'false';

    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    this.checkbox.checked = checked;
    this.checkbox.contentEditable = 'false';
    this.checkbox.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos === null || pos === undefined) return;
      const { state } = this.view;
      this.view.dispatch(
        state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, checked: this.checkbox.checked }),
      );
    });

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'task-item-content';

    this.dom.appendChild(this.checkbox);
    this.dom.appendChild(this.contentDOM);
  }

  update(node) {
    if (node.type !== this.node.type) return false;

    const wasTask = this.node.attrs.checked !== null;
    const isTask = node.attrs.checked !== null;

    // Transition between normal ↔ task requires full rebuild
    if (wasTask !== isTask) return false;

    this.node = node;

    if (isTask) {
      const checked = node.attrs.checked;
      this.checkbox.checked = checked;
      this.dom.className = `task-item${checked ? ' task-item-checked' : ''}`;
      this.dom.dataset.checked = checked ? 'true' : 'false';
    }

    return true;
  }

  stopEvent(event) {
    return this.checkbox && (event.target === this.checkbox || this.checkbox.contains(event.target));
  }
}
