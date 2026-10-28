/**
 * A small notebook with one of everything search has to find (REQ-SEARCH-014):
 * text with formatting and links, a shape label, an image caption, a draw.io
 * diagram, a scroll title, a second page, and a board with a live and an
 * archived card. Loaded through the stores, the way a file open does.
 */
import type { Page } from '@playwright/test';
import { waitForCanvasReady } from '../helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const text = (id: string, x: number, y: number, body: string) => ({
  id, type: 'text', x, y, width: 400, height: 40, layer: 3,
  data: { text: body, fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
});

const card = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: `card-${n}`, number: n, title, description: '', column: 'todo', order: n,
  labels: [], checklist: [], notes: [], createdBy: 'owner', createdAt: 1, updatedAt: 1,
  ...extra,
});

export const NOTEBOOK = {
  id: 'search-fixture',
  version: '1.0',
  filename: 'search.html',
  settings: { backgroundMode: 'scroll', bgColor: '#ffffff' },
  sections: [
    {
      id: 's1', title: 'Research',
      pages: [
        {
          id: 'p1', title: 'Lab notes',
          scrolls: [{ id: 'sc1', title: 'Harbour column', column: 0 }],
          nodes: [
            text('t1', 100, 120, 'Plain words about the **harbour** plan'),
            text('t2', 100, 3200, 'Final review of the [budget](https://example.com/zebra) in detail'),
            text('t3', 100, 220, 'A very **bold** move'),
            text('t4', 100, 320, 'École normale'),
            text('t5', 100, 420, 'tide after tide'),
            {
              id: 'sh1', type: 'shape', x: 520, y: 120, width: 160, height: 80, layer: 3,
              data: { shapeType: 'rect', fill: 'transparent', stroke: '#14181A', strokeWidth: 2, strokeDash: [], label: { text: 'Pump station' } },
            },
            {
              id: 'im1', type: 'image', x: 520, y: 260, width: 60, height: 60, layer: 3,
              data: { src: PNG, alt: 'harbour map', naturalWidth: 1, naturalHeight: 1, note: 'Caption: quay depths' },
            },
            {
              id: 'dg1', type: 'diagram', x: 520, y: 400, width: 200, height: 120, layer: 3,
              data: {
                title: 'Flow',
                source: '<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="Valve &amp; control" vertex="1"/></root></mxGraphModel>',
              },
            },
          ],
        },
        {
          id: 'p2', title: 'Harbour diary',
          nodes: [text('t6', 100, 120, 'Second page with a needle')],
        },
      ],
    },
    {
      id: 's2', title: 'Projects',
      pages: [
        {
          id: 'p3', title: 'Tasks', kind: 'board', nodes: [],
          board: {
            nextNumber: 3, nextSeq: 1, events: [],
            cards: [
              card(1, 'Fix the harbour crane', {
                description: 'Needs a **spare** part',
                checklist: [{ id: 'c1', text: 'Order gasket', done: false }],
                notes: [{ id: 'n1', author: 'owner', at: 1, text: 'Called the yard' }],
              }),
              card(2, 'Old harbour task', { archivedAt: 2 }),
            ],
          },
        },
      ],
    },
  ],
};

/** Open the app with the fixture notebook on the given page. */
export async function openFixture(page: Page, sectionId = 's1', pageId = 'p1', notebook: unknown = NOTEBOOK) {
  await page.goto('/');
  await waitForCanvasReady(page);
  await page.evaluate(({ nb, sectionId, pageId }) => {
    const S = (window as any).__POWERNOTE_STORES__;
    const data = JSON.parse(JSON.stringify(nb));
    S.workspace.setState({ workspace: data, activeSectionId: sectionId, activePageId: pageId });
    const target = data.sections.find((s: any) => s.id === sectionId).pages.find((p: any) => p.id === pageId);
    S.canvas.getState().loadPageNodes(target.nodes);
    S.canvas.getState().setViewport({ x: 0, y: 0, scale: 1 });
  }, { nb: notebook, sectionId, pageId });
}

export async function activePage(page: Page): Promise<{ sectionId: string; pageId: string }> {
  return page.evaluate(() => {
    const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
    return { sectionId: ws.activeSectionId, pageId: ws.activePageId };
  });
}
