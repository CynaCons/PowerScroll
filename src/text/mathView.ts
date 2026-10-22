/**
 * A formula in the editor (REQ-TEXT-067, REQ-MATH-006): drawn by KaTeX like
 * the finished block; a click opens its LaTeX source in place. Enter or
 * leaving the source applies it, Escape restores it, an empty source removes
 * the formula.
 */
import { TextSelection, NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { renderMath } from './schema';

/** Event the editor fires on a formula's element to open its source (a key typed on a selected formula). */
export const EDIT_MATH_EVENT = 'powernote:edit-math';

export class MathView implements NodeView {
  dom: HTMLSpanElement;
  private input: HTMLInputElement | null = null;
  private node: PMNode;

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement('span');
    this.render();
    this.dom.addEventListener('mousedown', (event) => {
      if (this.input) return;
      event.preventDefault();
      this.open();
    });
    this.dom.addEventListener(EDIT_MATH_EVENT, () => this.open());
  }

  private render() {
    // Forget the input before removing it: Chrome fires blur on a removed
    // focused element, and that blur must not apply the source.
    this.input = null;
    const { src, display } = this.node.attrs;
    this.dom.className = display ? 'powernote-math powernote-math--display' : 'powernote-math';
    this.dom.setAttribute('data-src', src);
    if (display) this.dom.setAttribute('data-display', 'true');
    this.dom.innerHTML = renderMath(src, display);
  }

  /** Show the LaTeX source in place of the rendering. */
  open() {
    if (this.input) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.node.attrs.src;
    input.setAttribute('data-testid', 'math-source');
    input.setAttribute('aria-label', 'Formula source (LaTeX)');
    input.className = 'powernote-math-source';
    input.size = Math.max(6, input.value.length + 2);
    input.addEventListener('input', () => {
      input.size = Math.max(6, input.value.length + 2);
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this.apply(input.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      }
    });
    input.addEventListener('blur', () => {
      if (this.input === input) this.apply(input.value);
    });
    this.dom.innerHTML = '';
    this.dom.appendChild(input);
    this.dom.classList.add('powernote-math--editing');
    this.input = input;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  private cancel() {
    this.render();
    this.focusAfter();
  }

  private apply(value: string) {
    const src = value.trim();
    const pos = this.getPos();
    this.input = null;
    if (pos === undefined) {
      this.render();
      return;
    }
    if (!src) {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
      this.view.focus();
      return;
    }
    if (src !== this.node.attrs.src) {
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, src }));
    } else {
      this.render();
    }
    this.focusAfter();
  }

  private focusAfter() {
    const pos = this.getPos();
    if (pos !== undefined) {
      const after = Math.min(pos + this.node.nodeSize, this.view.state.doc.content.size);
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, after)));
    }
    this.view.focus();
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.input) this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(event: Event) {
    return !!this.input && this.dom.contains(event.target as Node);
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.input = null;
  }
}
