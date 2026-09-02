import type {
  WorkspaceData,
  WorkspaceSettings,
  Section,
  Page,
  TextOptions,
  ShapeOptions,
} from '../types/data';
import { generateId } from './ids';
import { APP_VERSION } from '../version';

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  backgroundMode: 'pages',
  bgColor: '#ffffff',
};

export function createPage(title = 'Untitled Page'): Page {
  return {
    id: generateId(),
    title,
    nodes: [],
    // Untitled so no header is drawn until someone names it, but present from
    // birth so an agent always has a scroll id to append to.
    scrolls: [{ id: generateId(), title: '', column: 0 }],
  };
}

export function createSection(title = 'New Section'): Section {
  return {
    id: generateId(),
    title,
    pages: [createPage('Page 1')],
  };
}

export function createWorkspace(): WorkspaceData {
  return {
    version: '0.2.0',
    filename: 'Untitled Notebook',
    sections: [createSection('Section 1')],
    editorVersion: APP_VERSION,
    saveRevision: 0,
    settings: { ...DEFAULT_WORKSPACE_SETTINGS },
  };
}

export const defaultTextOptions: TextOptions = {
  fontSize: 16,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontStyle: 'normal',
  fill: '#1a1a1a',
};

export const defaultShapeOptions: ShapeOptions = {
  shapeType: 'rect',
  fill: 'transparent',
  stroke: '#1a1a1a',
  strokeWidth: 2,
  strokeDash: [],
  opacity: 1,
};
