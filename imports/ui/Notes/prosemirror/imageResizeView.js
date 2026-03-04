/**
 * ProseMirror NodeView for image nodes with resize handles.
 * Drag left/right handles to resize; aspect ratio is preserved via height:auto.
 * Width is persisted as a node attribute and serialized to markdown.
 */
export class ImageResizeView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Wrapper
    this.dom = document.createElement('div');
    this.dom.className = 'image-resize-wrapper';

    // Image
    this.img = document.createElement('img');
    this.img.src = node.attrs.src;
    if (node.attrs.alt) this.img.alt = node.attrs.alt;
    if (node.attrs.title) this.img.title = node.attrs.title;
    if (node.attrs.width) this.img.style.width = `${node.attrs.width}px`;
    this.dom.appendChild(this.img);

    // Handles
    this.handleLeft = document.createElement('span');
    this.handleLeft.className = 'resize-handle left';
    this.dom.appendChild(this.handleLeft);

    this.handleRight = document.createElement('span');
    this.handleRight.className = 'resize-handle right';
    this.dom.appendChild(this.handleRight);

    // Bind drag
    this.handleLeft.addEventListener('mousedown', (e) => this._onMouseDown(e, 'left'));
    this.handleRight.addEventListener('mousedown', (e) => this._onMouseDown(e, 'right'));
  }

  _onMouseDown(e, side) {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = this.img.getBoundingClientRect().width;
    const containerWidth = this.dom.parentElement?.offsetWidth || 800;
    const handle = side === 'left' ? this.handleLeft : this.handleRight;
    handle.classList.add('active');

    const onMouseMove = (e) => {
      const deltaX = e.clientX - startX;
      const newWidth = side === 'right'
        ? startWidth + deltaX
        : startWidth - deltaX;
      const clamped = Math.max(50, Math.min(newWidth, containerWidth));
      this.img.style.width = `${Math.round(clamped)}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      handle.classList.remove('active');

      const finalWidth = Math.round(this.img.getBoundingClientRect().width);
      const pos = this.getPos();
      if (pos === null || pos === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, width: finalWidth }),
      );
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.img.src = node.attrs.src;
    if (node.attrs.alt) this.img.alt = node.attrs.alt;
    if (node.attrs.title) this.img.title = node.attrs.title;
    this.img.style.width = node.attrs.width ? `${node.attrs.width}px` : '';
    return true;
  }

  stopEvent(event) {
    return this.handleLeft.contains(event.target) || this.handleRight.contains(event.target);
  }

  ignoreMutation() {
    return true;
  }
}
