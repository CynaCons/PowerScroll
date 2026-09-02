/**
 * Test 153: Adversarial stress pass over v0.46–v0.52
 *
 * Hostile corpus + pathological geometry + input races. This file is the
 * regression harness for whatever the pass finds — keep each case at the
 * smallest iteration count that still exposes the issue.
 *
 * Drive transpileDrawio / buildDiagram / fit / ceiling / export in-page.
 * Drive input via PointerEvent / TouchEvent dispatch (same path as T135/T136).
 */
import { test, expect } from '@playwright/test';
import { disableFSA, waitForCanvasReady } from '../helpers';

const NODE_BUDGET = 4000;
const DIAGNOSTIC_BUDGET = 200;
const FIT_FLOOR = 0.45;
const HANG_MS = 10_000;

interface Transpiled {
  nodes: any[];
  diagnostics: { line: number; severity: string; message: string }[];
  threw?: string;
  ms?: number;
}

interface Built {
  nodes: any[];
  diagnostics: { line: number; severity: string; message: string }[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  elementCount: number;
  threw?: string;
  ms?: number;
}

function messages(r: { diagnostics: { message: string }[] }) {
  return r.diagnostics.map((d) => d.message).join('\n');
}

function assertFiniteCoords(nodes: any[], label: string) {
  for (const n of nodes) {
    const fields = [n.x, n.y, n.width, n.height];
    for (const v of fields) {
      expect(Number.isFinite(v), `${label} ${n.id ?? '?'} coord ${v}`).toBe(true);
    }
    if (n.data?.rotation != null) {
      expect(Number.isFinite(n.data.rotation), `${label} rotation`).toBe(true);
    }
  }
}

async function transpile(
  page: import('@playwright/test').Page,
  source: string,
  origin = { x: 40, y: 80 },
): Promise<Transpiled> {
  return page.evaluate(
    async ({ source, origin }) => {
      const t0 = performance.now();
      try {
        const mod = await import('/src/diagram/drawio.ts');
        const result = mod.transpileDrawio(source, {
          groupId: 'stress-group',
          origin,
          measureText: (text: string, fontSize: number) => text.length * fontSize * 0.5,
        });
        return { ...result, threw: undefined, ms: performance.now() - t0 };
      } catch (err) {
        return {
          nodes: [],
          diagnostics: [],
          threw: err instanceof Error ? err.message : String(err),
          ms: performance.now() - t0,
        };
      }
    },
    { source, origin },
  );
}

async function buildDrawio(
  page: import('@playwright/test').Page,
  source: string,
  origin = { x: 40, y: 80 },
): Promise<Built> {
  return page.evaluate(
    async ({ source, origin }) => {
      const t0 = performance.now();
      try {
        const mod = await import('/src/diagram/index.ts');
        const result = mod.buildDiagram(source, {
          groupId: 'stress-group',
          origin,
          format: 'drawio',
          measureText: (text: string, fontSize: number) => text.length * fontSize * 0.5,
        });
        return { ...result, threw: undefined, ms: performance.now() - t0 };
      } catch (err) {
        return {
          nodes: [],
          diagnostics: [],
          bounds: null,
          elementCount: 0,
          threw: err instanceof Error ? err.message : String(err),
          ms: performance.now() - t0,
        };
      }
    },
    { source, origin },
  );
}

type Pt = { x: number; y: number };

async function pointerEvent(
  page: import('@playwright/test').Page,
  type: string,
  pos: Pt,
  o: { pointerType?: string; pointerId?: number; pressure?: number; buttons?: number } = {},
) {
  await page.evaluate(
    ({ type, pos, o }) => {
      const canvas = document.querySelector(
        '[data-testid="canvas-container"] canvas',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: o.pointerId ?? 200,
          pointerType: o.pointerType ?? 'touch',
          isPrimary: (o.pointerId ?? 200) === 200,
          clientX: rect.left + pos.x,
          clientY: rect.top + pos.y,
          pressure: o.pressure ?? 0.5,
          buttons: o.buttons ?? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1),
        }),
      );
    },
    { type, pos, o },
  );
}

async function touchEvent(
  page: import('@playwright/test').Page,
  type: 'touchstart' | 'touchmove' | 'touchend',
  points: Pt[],
  lifted: Pt[] = [],
) {
  await page.evaluate(
    ({ type, points, lifted }) => {
      const canvas = document.querySelector(
        '[data-testid="canvas-container"] canvas',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mk = (p: { x: number; y: number }, i: number) =>
        new Touch({
          identifier: i + 1,
          target: canvas,
          clientX: rect.left + p.x,
          clientY: rect.top + p.y,
        });
      const touches = points.map(mk);
      const changed = (lifted.length > 0 ? lifted : points).map(mk);
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          targetTouches: touches,
          changedTouches: changed,
        }),
      );
    },
    { type, points, lifted },
  );
}

test.describe('153 - stress pass v0.46–v0.52', () => {
  test.beforeEach(async ({ page }) => {
    await disableFSA(page);
    await page.goto('/');
    await waitForCanvasReady(page);
  });

  // ── 1. draw.io hostile corpus ──────────────────────────────

  test('1000-vertex + 1500-edge file respects budgets and does not hang', async ({ page }) => {
    test.setTimeout(25_000);
    const result = await page.evaluate(
      async ({ nodeBudget }) => {
        const verts: string[] = [];
        for (let i = 0; i < 1000; i += 1) {
          const x = (i % 50) * 80;
          const y = Math.floor(i / 50) * 60;
          verts.push(
            `<mxCell id="v${i}" value="" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">` +
              `<mxGeometry x="${x}" y="${y}" width="60" height="40" as="geometry"/>` +
              `</mxCell>`,
          );
        }
        const edges: string[] = [];
        for (let i = 0; i < 1500; i += 1) {
          const a = i % 1000;
          const b = (i + 17) % 1000;
          // Two waypoints → 3 segments. 1000 verts + 1500×3 segs = 5500 > 4000.
          edges.push(
            `<mxCell id="e${i}" style="edgeStyle=orthogonalEdgeStyle;endArrow=classic;html=1;" edge="1" parent="1" source="v${a}" target="v${b}">` +
              `<mxGeometry relative="1" as="geometry">` +
              `<Array as="points"><mxPoint x="${(a % 50) * 80 + 30}" y="${Math.floor(a / 50) * 60 + 80}"/><mxPoint x="${(b % 50) * 80 + 30}" y="${Math.floor(a / 50) * 60 + 80}"/></Array>` +
              `</mxGeometry></mxCell>`,
          );
        }
        const source =
          `<mxfile host="app.diagrams.net"><diagram name="Huge" id="p1"><mxGraphModel><root>` +
          `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
          verts.join('') +
          edges.join('') +
          `</root></mxGraphModel></diagram></mxfile>`;

        const t0 = performance.now();
        let threw: string | undefined;
        let nodes: any[] = [];
        let diagnostics: { message: string }[] = [];
        try {
          const { transpileDrawio } = await import('/src/diagram/drawio.ts');
          const { buildDiagram } = await import('/src/diagram/index.ts');
          const t = transpileDrawio(source, {
            groupId: 'huge',
            origin: { x: 0, y: 0 },
            measureText: (text: string, fontSize: number) => text.length * fontSize * 0.5,
          });
          nodes = t.nodes;
          diagnostics = t.diagnostics;
          const built = buildDiagram(source, {
            groupId: 'huge-b',
            origin: { x: 0, y: 0 },
            format: 'drawio',
            measureText: (text: string, fontSize: number) => text.length * fontSize * 0.5,
          });
          if (built.nodes.length > nodeBudget) {
            throw new Error(`buildDiagram emitted ${built.nodes.length} > budget`);
          }
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        return {
          ms: performance.now() - t0,
          nodeCount: nodes.length,
          diagCount: diagnostics.length,
          budgetHit: diagnostics.some((d) => /4000/.test(d.message)),
          threw,
          sourceChars: source.length,
        };
      },
      { nodeBudget: NODE_BUDGET },
    );

    expect(result.threw, result.threw).toBeUndefined();
    expect(result.ms, `transpile hung: ${result.ms}ms`).toBeLessThan(HANG_MS);
    expect(result.nodeCount).toBeLessThanOrEqual(NODE_BUDGET);
    expect(result.diagCount).toBeLessThanOrEqual(DIAGNOSTIC_BUDGET);
    expect(result.budgetHit).toBe(true);
    expect(result.nodeCount).toBe(NODE_BUDGET);
  });

  test('malformed XML never throws; diagnostics name the problem', async ({ page }) => {
    const cases: { name: string; source: string; mustMatch: RegExp }[] = [
      { name: 'truncated-mid-tag', source: '<mxfile><diagram><mxGraphModel><root><mxCell id="', mustMatch: /not well-formed|not well formed|xml/i },
      {
        name: 'unclosed-cells',
        source:
          '<mxfile><diagram><mxGraphModel><root><mxCell id="0"><mxCell id="1" parent="0" vertex="1"></root></mxGraphModel></diagram></mxfile>',
        mustMatch: /not well-formed|not well formed|xml/i,
      },
      { name: 'garbage-bytes', source: '<mxfile>\u0000\u0001\u00FF not xml at all', mustMatch: /not well-formed|not well formed|xml|mxGraphModel/i },
      { name: 'empty-mxfile', source: '<mxfile></mxfile>', mustMatch: /mxGraphModel|empty/i },
      { name: 'empty-string', source: '   ', mustMatch: /empty/i },
    ];

    for (const c of cases) {
      const viaTranspile = await transpile(page, c.source);
      expect(viaTranspile.threw, `${c.name} transpile threw: ${viaTranspile.threw}`).toBeUndefined();
      expect(viaTranspile.nodes, c.name).toEqual([]);
      expect(viaTranspile.diagnostics.length, `${c.name} silent`).toBeGreaterThan(0);
      expect(messages(viaTranspile), c.name).toMatch(c.mustMatch);

      const viaBuild = await buildDrawio(page, c.source);
      expect(viaBuild.threw, `${c.name} build threw: ${viaBuild.threw}`).toBeUndefined();
      expect(viaBuild.nodes, c.name).toEqual([]);
      expect(viaBuild.diagnostics.length, `${c.name} build silent`).toBeGreaterThan(0);
    }
  });

  test('invalid-deflate diagram payload is an error, not a crash', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const payload = btoa('%%%%this-is-not-deflate%%%%');
      const source = `<mxfile host="x"><diagram name="Broken" id="d1">${payload}</diagram></mxfile>`;
      const drawio = await import('/src/diagram/drawio.ts');
      const index = await import('/src/diagram/index.ts');
      let threw: string | undefined;
      let normalized = '';
      let t: { nodes: any[]; diagnostics: { message: string }[] } = { nodes: [], diagnostics: [] };
      let b: { nodes: any[]; diagnostics: { message: string }[] } = { nodes: [], diagnostics: [] };
      try {
        normalized = await drawio.normalizeDrawioSource(source);
        t = drawio.transpileDrawio(normalized, {
          groupId: 'g',
          origin: { x: 0, y: 0 },
          measureText: (s: string, f: number) => s.length * f * 0.5,
        });
        b = index.buildDiagram(normalized, {
          groupId: 'g',
          origin: { x: 0, y: 0 },
          format: 'drawio',
        });
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      return {
        threw,
        tMsg: t.diagnostics.map((d) => d.message).join('\n'),
        bMsg: b.diagnostics.map((d) => d.message).join('\n'),
        tNodes: t.nodes.length,
        stillLooksEncoded: /[A-Za-z0-9+/=]{16,}/.test(normalized) && !/<mxGraphModel/i.test(normalized),
      };
    });

    expect(out.threw, out.threw).toBeUndefined();
    expect(out.tNodes).toBe(0);
    expect(out.tMsg.length).toBeGreaterThan(0);
    // Must name the problem — "still compressed" alone is a lie if inflate failed.
    expect(out.tMsg).toMatch(/compress|deflate|not valid|not readable|mxGraphModel|payload/i);
    expect(out.bMsg.length).toBeGreaterThan(0);
  });

  test('deflate succeeds but content is not mxGraph → error, not crash', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const compress = async (plain: string) => {
        const encoded = encodeURIComponent(plain);
        const stream = new Blob([encoded]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = await new Response(stream).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin);
      };

      const drawio = await import('/src/diagram/drawio.ts');
      const run = async (inner: string) => {
        const source = `<mxfile host="x"><diagram name="Fake" id="d1">${await compress(inner)}</diagram></mxfile>`;
        let threw: string | undefined;
        let nodes = 0;
        let msg = '';
        try {
          const normalized = await drawio.normalizeDrawioSource(source);
          const t = drawio.transpileDrawio(normalized, {
            groupId: 'g',
            origin: { x: 0, y: 0 },
            measureText: (s: string, f: number) => s.length * f * 0.5,
          });
          nodes = t.nodes.length;
          msg = t.diagnostics.map((d) => d.message).join('\n');
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        return { threw, nodes, msg };
      };

      return {
        plain: await run('HELLO THIS IS NOT A GRAPH'),
        html: await run('<html><body>definitely not mxGraph</body></html>'),
        svg: await run('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'),
      };
    });

    for (const [name, r] of Object.entries(out)) {
      expect(r.threw, `${name} threw: ${r.threw}`).toBeUndefined();
      expect(r.nodes, name).toBe(0);
      expect(r.msg, name).toMatch(/mxGraphModel|not a drawing|not mxGraph|not readable/i);
      // Inflated non-graph must not be reported as "still compressed".
      expect(r.msg, `${name} blamed compression after a successful inflate`).not.toMatch(
        /still compressed/i,
      );
    }
  });

  test('30-level nested containers with relative geometry emit finite coordinates', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const cells: string[] = [];
      cells.push(
        `<mxCell id="c0" value="rootbox" style="rounded=0;" vertex="1" parent="1">` +
          `<mxGeometry x="20" y="30" width="400" height="300" as="geometry"/></mxCell>`,
      );
      for (let i = 1; i < 30; i += 1) {
        cells.push(
          `<mxCell id="c${i}" value="n${i}" style="rounded=0;" vertex="1" parent="c${i - 1}">` +
            `<mxGeometry x="0.15" y="0.2" width="80" height="50" relative="1" as="geometry"/></mxCell>`,
        );
      }
      const source =
        `<mxfile><diagram name="Deep"><mxGraphModel><root>` +
        `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}` +
        `</root></mxGraphModel></diagram></mxfile>`;
      const { transpileDrawio } = await import('/src/diagram/drawio.ts');
      return transpileDrawio(source, {
        groupId: 'deep',
        origin: { x: 10, y: 10 },
        measureText: (t: string, f: number) => t.length * f * 0.5,
      });
    });

    expect(result.nodes.length).toBeGreaterThanOrEqual(30);
    assertFiniteCoords(result.nodes, 'nested');
    for (const n of result.nodes) {
      expect(n.x + n.width).not.toBe(Infinity);
      expect(n.y + n.height).not.toBe(Infinity);
    }
  });

  test('stencil-heavy styles refuse by name; accepted subset still emits', async ({ page }) => {
    const source = `<mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="aws" value="Lambda" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#D05C17;gradientColor=#F78E04;fontStyle=1;spacingLeft=4;spacingRight=4;perimeter=ellipsePerimeter;" vertex="1" parent="1">
        <mxGeometry x="0" y="0" width="80" height="80" as="geometry"/>
      </mxCell>
      <mxCell id="azure" value="Gateway" style="shape=mxgraph.mscae.enterprise.gateway;pointerEvents=1;html=1;fillColor=#0078D7;verticalLabelPosition=bottom;outlineConnect=0;fontStyle=3;spacingTop=2;perimeter=rectanglePerimeter;" vertex="1" parent="1">
        <mxGeometry x="100" y="0" width="80" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="ok" value="Plain" style="rounded=1;whiteSpace=wrap;html=1;fontStyle=1;spacingLeft=8;spacingRight=8;perimeter=rectanglePerimeter;fillColor=#aabbcc;" vertex="1" parent="1">
        <mxGeometry x="200" y="0" width="100" height="50" as="geometry"/>
      </mxCell>
      <mxCell id="ok2" value="" style="ellipse;fontStyle=2;spacingBottom=4;" vertex="1" parent="1">
        <mxGeometry x="320" y="0" width="40" height="40" as="geometry"/>
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;

    const r = await transpile(page, source);
    expect(r.threw).toBeUndefined();
    const msg = messages(r);
    expect(msg).toMatch(/mxgraph\.aws4\.resourceIcon/);
    expect(msg).toMatch(/mxgraph\.mscae\.enterprise\.gateway/);
    expect(msg).toMatch(/stencil/i);

    const shapes = r.nodes.filter((n) => n.type === 'shape');
    expect(shapes.some((n) => n.data.shapeType === 'rect' && n.data.fill === '#aabbcc')).toBe(true);
    expect(shapes.some((n) => n.data.shapeType === 'circle')).toBe(true);
    expect(r.nodes.some((n) => n.type === 'text' && /Plain/.test(n.data?.text))).toBe(true);
    // Two stencils refused, two accepted vertices (+ labels).
    expect(shapes.length).toBe(2);
  });

  test('diagnostic flood is capped at DIAGNOSTIC_BUDGET', async ({ page }) => {
    const result = await page.evaluate(async ({ cap }) => {
      const cells: string[] = [];
      for (let i = 0; i < cap + 50; i += 1) {
        cells.push(
          `<mxCell id="s${i}" style="shape=mxgraph.aws4.lambda;html=1;" vertex="1" parent="1">` +
            `<mxGeometry x="${i * 10}" y="0" width="20" height="20" as="geometry"/></mxCell>`,
        );
      }
      const source =
        `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
        cells.join('') +
        `</root></mxGraphModel></diagram></mxfile>`;
      const { transpileDrawio } = await import('/src/diagram/drawio.ts');
      const t = transpileDrawio(source, {
        groupId: 'flood',
        origin: { x: 0, y: 0 },
        measureText: (s: string, f: number) => s.length * f * 0.5,
      });
      return { n: t.diagnostics.length, nodes: t.nodes.length };
    }, { cap: DIAGNOSTIC_BUDGET });

    expect(result.n).toBeLessThanOrEqual(DIAGNOSTIC_BUDGET);
    expect(result.n).toBe(DIAGNOSTIC_BUDGET);
    expect(result.nodes).toBe(0);
  });

  // ── 2. Fit-to-scroll abuse ─────────────────────────────────

  test('4000px diagram into a 200px band hits the floor and warns', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const pageRec = ws.getActivePage();
      const scrolls = (pageRec.scrolls ?? []).map((s: any, i: number) =>
        i === 0 ? { ...s, title: 'Skinny', width: 200 } : s,
      );
      ws.replacePageScrolls(ws.activePageId, scrolls);

      const { columnLeft } = await import('/src/utils/pageLayout.ts');
      const { rebuildDiagram, applyDiagramScrollFit } = await import('/src/diagram/canvasOps.ts');
      const source =
        `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="a" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell>` +
        `<mxCell id="b" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="3960" y="0" width="40" height="20" as="geometry"/></mxCell>` +
        `</root></mxGraphModel></diagram></mxfile>`;
      const x = columnLeft(0, scrolls);
      const frame = {
        id: 'fit-wide',
        type: 'diagram' as const,
        x,
        y: 80,
        width: 260,
        height: 120,
        layer: 2,
        groupId: 'fit-wide',
        data: { source, title: 'Wide' },
      };
      const raw = rebuildDiagram(frame, source, 'drawio');
      const fitted = applyDiagramScrollFit(frame, raw);
      return {
        rawW: raw.frame.width,
        fitW: fitted.frame.width,
        scale: fitted.scale,
        warning: fitted.warning ?? null,
        memberCount: fitted.contents.length,
      };
    });

    expect(out.rawW).toBeGreaterThan(3900);
    expect(out.scale).toBeCloseTo(FIT_FLOOR, 5);
    expect(out.fitW).toBeCloseTo(out.rawW * FIT_FLOOR, 0);
    expect(out.warning).toMatch(/0\.45/);
    expect(out.warning).toMatch(/Skinny/);
    expect(out.warning).toMatch(/requested width/i);
    expect(out.memberCount).toBeGreaterThan(0);
  });

  test('band narrower than the floor can absorb still floors and warns (or names the band)', async ({
    page,
  }) => {
    const out = await page.evaluate(async () => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const pageRec = ws.getActivePage();
      // 10px < FIT_SCROLL_PAD (16): available is negative.
      const scrolls = (pageRec.scrolls ?? []).map((s: any, i: number) =>
        i === 0 ? { ...s, title: 'Hairline', width: 10 } : s,
      );
      ws.replacePageScrolls(ws.activePageId, scrolls);
      const { columnLeft } = await import('/src/utils/pageLayout.ts');
      const { rebuildDiagram, applyDiagramScrollFit } = await import('/src/diagram/canvasOps.ts');
      const source =
        `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="a" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="40" as="geometry"/></mxCell>` +
        `</root></mxGraphModel></diagram></mxfile>`;
      const x = columnLeft(0, scrolls);
      const frame = {
        id: 'fit-hair',
        type: 'diagram' as const,
        x,
        y: 80,
        width: 260,
        height: 120,
        layer: 2,
        groupId: 'fit-hair',
        data: { source, title: 'Hair' },
      };
      const raw = rebuildDiagram(frame, source, 'drawio');
      const fitted = applyDiagramScrollFit(frame, raw);
      return {
        rawW: raw.frame.width,
        fitW: fitted.frame.width,
        scale: fitted.scale ?? 1,
        warning: fitted.warning ?? null,
      };
    });

    // A 10px band cannot absorb even the floor. Silent identity is a finding.
    expect(out.warning, 'narrower-than-pad band must not stay silent').not.toBeNull();
    expect(out.warning).toMatch(/Hairline|narrow|0\.45|fit/i);
  });

  test('rebuild 20× is idempotent after the first fit (no geometry drift)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const ws = (window as any).__POWERNOTE_STORES__.workspace.getState();
      const pageRec = ws.getActivePage();
      const scrolls = (pageRec.scrolls ?? []).map((s: any, i: number) =>
        i === 0 ? { ...s, title: 'Backend', width: 200 } : s,
      );
      ws.replacePageScrolls(ws.activePageId, scrolls);
      const { columnLeft } = await import('/src/utils/pageLayout.ts');
      const { rebuildDiagram, applyDiagramScrollFit } = await import('/src/diagram/canvasOps.ts');
      const source =
        `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="a" style="rounded=0;fillColor=#111111;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell>` +
        `<mxCell id="b" style="rounded=0;fillColor=#222222;" vertex="1" parent="1"><mxGeometry x="2000" y="40" width="40" height="20" as="geometry"/></mxCell>` +
        `</root></mxGraphModel></diagram></mxfile>`;
      const x = columnLeft(0, scrolls);
      const frame = {
        id: 'fit-loop',
        type: 'diagram' as const,
        x,
        y: 80,
        width: 260,
        height: 120,
        layer: 2,
        groupId: 'fit-loop',
        data: { source, title: 'Loop' },
      };

      const snap = (built: { frame: { width: number; height: number }; contents: any[]; scale?: number }) => ({
        w: built.frame.width,
        h: built.frame.height,
        scale: built.scale ?? 1,
        marks: built.contents
          .map((n: any) =>
            [n.type, n.data?.shapeType ?? '', n.x, n.y, n.width, n.height, n.data?.fill ?? ''].join(':'),
          )
          .sort(),
      });

      const first = snap(applyDiagramScrollFit(frame, rebuildDiagram(frame, source, 'drawio')));
      const rounds: { same: boolean; w: number }[] = [];
      for (let i = 0; i < 19; i += 1) {
        const next = snap(applyDiagramScrollFit(frame, rebuildDiagram(frame, source, 'drawio')));
        rounds.push({
          same:
            next.w === first.w &&
            next.h === first.h &&
            next.scale === first.scale &&
            next.marks.length === first.marks.length &&
            next.marks.every((m, j) => m === first.marks[j]),
          w: next.w,
        });
      }

      // Also probe fit-on-already-fitted (not the public rebuild path).
      const { fitDiagramToScroll } = await import('/src/diagram/fitToScroll.ts');
      let acc = applyDiagramScrollFit(frame, rebuildDiagram(frame, source, 'drawio'));
      const widths = [acc.frame.width];
      for (let i = 0; i < 5; i += 1) {
        const again = fitDiagramToScroll(
          { x: frame.x, y: frame.y, width: acc.frame.width, height: acc.frame.height },
          acc.contents,
          scrolls,
        );
        acc = { ...acc, contents: again.members, frame: again.frame, scale: again.scale };
        widths.push(again.frame.width);
      }

      return { first, rounds, refitWidths: widths };
    });

    expect(out.first.w).toBeGreaterThan(0);
    expect(out.rounds.every((r) => r.same), JSON.stringify(out.rounds)).toBe(true);
    // Record-only probe: fit-on-fitted is not the public path. Exposed so a
    // later design can decide whether fit should be a projection.
    expect(out.refitWidths[0]).toBeGreaterThan(0);
  });

  // ── 3. Ceiling under load ──────────────────────────────────

  test('pageCeiling on 3000 strokes stays under 16ms/call', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const strokes = [];
      for (let i = 0; i < 3000; i += 1) {
        const y = 40 + (i % 200);
        strokes.push({
          id: `sk${i}`,
          points: [10, y, 40, y + 4, 80, y - 2, 120, y + 1],
          color: '#14181A',
          strokeWidth: 2,
        });
      }
      const nodes = [
        { y: 80 },
        { y: 120 },
        { y: -20 },
      ];
      const scrolls = [{ title: 'Main' }];
      const { pageCeiling } = await import('/src/utils/scrollCeiling.ts');
      // Warm the function, then time a handful of calls (header-render budget).
      pageCeiling(nodes, strokes, scrolls);
      const samples: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const t0 = performance.now();
        pageCeiling(nodes, strokes, scrolls);
        samples.push(performance.now() - t0);
      }
      const ceiling = pageCeiling(nodes, strokes, scrolls);
      return { samples, ceiling, worst: Math.max(...samples), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
    });

    expect(out.ceiling).not.toBeNull();
    expect(out.ceiling!).toBeLessThanOrEqual(-20);
    // Finding threshold: >16ms/call, since ScrollHeaders runs this per render.
    expect(out.worst, `pageCeiling worst ${out.worst.toFixed(2)}ms mean ${out.mean.toFixed(2)}ms`).toBeLessThanOrEqual(16);
  });

  test('ceiling clamp holds at scale 0.1 and 5.0 with legacy content at y=-10000', async ({
    page,
  }) => {
    const out = await page.evaluate(async () => {
      const S = (window as any).__POWERNOTE_STORES__;
      const ws = S.workspace.getState();
      ws.renameScroll(ws.activePageId, ws.getActivePage().scrolls[0].id, 'Main');
      S.canvas.getState().addNode({
        id: 'legacy-abyss',
        type: 'text',
        x: 80,
        y: -10000,
        width: 120,
        height: 30,
        layer: 4,
        data: { text: 'abyss', fontSize: 16, fontFamily: 'Inter', fontStyle: 'normal', fill: '#1a1a1a' },
      });
      const { pageCeiling, clampStageY, CEILING_PAD, CEILING_HEADROOM } = await import(
        '/src/utils/scrollCeiling.ts'
      );
      const ceiling = pageCeiling(
        S.canvas.getState().nodes,
        S.draw.getState().strokes,
        S.workspace.getState().getActivePage()?.scrolls,
      );

      const trySet = (scale: number, y: number) => {
        S.canvas.getState().setViewport({ x: 0, y, scale });
        return { ...S.canvas.getState().viewport };
      };

      const maxAt = (scale: number) =>
        clampStageY({ y: () => 1e9, scaleX: () => scale }, ceiling);

      return {
        ceiling,
        pad: CEILING_PAD,
        headroom: CEILING_HEADROOM,
        at01: trySet(0.1, 1e9),
        at50: trySet(5.0, 1e9),
        max01: maxAt(0.1),
        max50: maxAt(5.0),
        // Below the legal max must survive.
        kept01: trySet(0.1, 100),
        kept50: trySet(5.0, 100),
      };
    });

    expect(out.ceiling).toBe(-10000 - out.pad);
    expect(out.max01).toBeCloseTo((out.headroom - out.ceiling!) * 0.1, 5);
    expect(out.max50).toBeCloseTo((out.headroom - out.ceiling!) * 5.0, 5);
    expect(out.at01.y).toBeLessThanOrEqual(out.max01 + 0.01);
    expect(out.at50.y).toBeLessThanOrEqual(out.max50 + 0.01);
    expect(out.at01.scale).toBeCloseTo(0.1, 5);
    expect(out.at50.scale).toBeCloseTo(5.0, 5);
    expect(out.kept01.y).toBeCloseTo(100, 5);
    expect(out.kept50.y).toBeCloseTo(100, 5);
  });

  // ── 4. Export closure after heavy edits ────────────────────

  test('import 200 cells, edit 50, export→reimport closure holds', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const cells: string[] = [];
      for (let i = 0; i < 200; i += 1) {
        const x = (i % 20) * 50;
        const y = Math.floor(i / 20) * 40;
        cells.push(
          `<mxCell id="c${i}" value="" style="rounded=0;fillColor=#${(0x101010 + i).toString(16).slice(0, 6)};" vertex="1" parent="1">` +
            `<mxGeometry x="${x}" y="${y}" width="36" height="24" as="geometry"/></mxCell>`,
        );
      }
      const source =
        `<mxfile host="app.diagrams.net"><diagram name="Grid"><mxGraphModel><root>` +
        `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}` +
        `</root></mxGraphModel></diagram></mxfile>`;

      const { placeDiagramOnCanvas } = await import('/src/diagram/canvasOps.ts');
      const { exportDrawio } = await import('/src/diagram/drawioExport.ts');
      const { transpileDrawio } = await import('/src/diagram/drawio.ts');
      const placed = placeDiagramOnCanvas({
        x: 2000,
        y: 80,
        source,
        title: 'Grid200',
        format: 'drawio',
      });
      const canvas = (window as any).__POWERNOTE_STORES__.canvas;
      const members = () =>
        canvas.getState().nodes.filter((n: any) => n.groupId === placed.frameId && n.id !== placed.frameId);
      const before = members();
      for (let i = 0; i < 50; i += 1) {
        const n = before[i];
        canvas.getState().updateNode(n.id, {
          x: n.x + 12,
          y: n.y + 8,
          data: { ...n.data, fill: '#ff00aa', strokeWidth: 3 },
        });
      }
      const after = members();
      const exported = exportDrawio(placed.frameId, canvas.getState().nodes);
      let parseOk = false;
      try {
        const doc = new DOMParser().parseFromString(exported.xml, 'application/xml');
        parseOk = doc.getElementsByTagName('parsererror').length === 0;
      } catch {
        parseOk = false;
      }
      const re = transpileDrawio(exported.xml, {
        groupId: 're',
        origin: { x: 0, y: 0 },
        measureText: (t: string, f: number) => t.length * f * 0.5,
      });

      const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
      const kind = (n: any) => (n.type === 'text' ? 'text' : n.data?.shapeType);
      const translate = (nodes: any[]) => {
        let minX = Infinity;
        let minY = Infinity;
        for (const n of nodes) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
        }
        return nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY }));
      };
      const want = translate(after);
      const got = translate(re.nodes);
      const used = new Array(want.length).fill(false);
      let matched = 0;
      const misses: string[] = [];
      for (const left of got) {
        const idx = want.findIndex((right, i) => {
          if (used[i]) return false;
          if (kind(left) !== kind(right)) return false;
          if (!near(left.x, right.x) || !near(left.y, right.y)) return false;
          if (!near(left.width, right.width) || !near(left.height, right.height)) return false;
          if ((left.data?.fill ?? '').toLowerCase() !== (right.data?.fill ?? '').toLowerCase()) return false;
          return true;
        });
        if (idx < 0) {
          misses.push(`${kind(left)}@${left.x},${left.y} fill=${left.data?.fill}`);
          continue;
        }
        used[idx] = true;
        matched += 1;
      }
      return {
        placed: placed.placed,
        memberCount: after.length,
        exportedLen: exported.xml.length,
        parseOk,
        reCount: re.nodes.length,
        matched,
        misses: misses.slice(0, 8),
        verbatim: exported.xml === source,
        report: exported.report,
      };
    });

    expect(out.placed).toBe(true);
    expect(out.memberCount).toBe(200);
    expect(out.parseOk).toBe(true);
    expect(out.verbatim).toBe(false);
    expect(out.reCount).toBe(200);
    expect(out.matched, `closure misses: ${out.misses.join(' | ')}`).toBe(200);
  });

  test('group of every ShapeType including arc: report names arc, XML parses', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const gid = 'grp_all_shapes';
      const add = (window as any).__POWERNOTE_STORES__.canvas.getState().addNode;
      const kinds: { id: string; shapeType: string; x: number; y: number; w: number; h: number }[] = [
        { id: 's-rect', shapeType: 'rect', x: 40, y: 40, w: 40, h: 30 },
        { id: 's-circle', shapeType: 'circle', x: 100, y: 40, w: 36, h: 36 },
        { id: 's-tri', shapeType: 'triangle', x: 160, y: 40, w: 40, h: 36 },
        { id: 's-diamond', shapeType: 'diamond', x: 180, y: 96, w: 40, h: 36 },
        { id: 's-arrow', shapeType: 'arrow', x: 220, y: 50, w: 50, h: 0 },
        { id: 's-line', shapeType: 'line', x: 40, y: 100, w: 60, h: 10 },
        { id: 's-arc', shapeType: 'arc', x: 120, y: 96, w: 24, h: 24 },
      ];
      for (const k of kinds) {
        add({
          id: k.id,
          type: 'shape',
          x: k.x,
          y: k.y,
          width: k.w,
          height: k.h,
          layer: 3,
          groupId: gid,
          data: {
            shapeType: k.shapeType,
            fill: k.shapeType === 'arc' || k.shapeType === 'line' || k.shapeType === 'arrow' ? 'transparent' : '#eef1f0',
            stroke: '#14181a',
            strokeWidth: 1.6,
            strokeDash: [],
            ...(k.shapeType === 'arc' ? { rotation: 90 } : {}),
          },
        });
      }
      const { exportDrawio } = await import('/src/diagram/drawioExport.ts');
      const exported = exportDrawio(gid, (window as any).__POWERNOTE_STORES__.canvas.getState().nodes);
      let parseOk = false;
      let hasMxfile = false;
      try {
        const doc = new DOMParser().parseFromString(exported.xml, 'application/xml');
        parseOk = doc.getElementsByTagName('parsererror').length === 0;
        hasMxfile = doc.getElementsByTagName('mxfile').length > 0;
      } catch {
        parseOk = false;
      }
      return {
        report: exported.report,
        xml: exported.xml,
        parseOk,
        hasMxfile,
        namesArc: exported.report.some((m: string) => /arc/i.test(m)),
        writesShapeArc: /shape=arc/.test(exported.xml),
      };
    });

    expect(out.parseOk).toBe(true);
    expect(out.hasMxfile).toBe(true);
    expect(out.namesArc).toBe(true);
    expect(out.writesShapeArc).toBe(false);
    expect(out.xml).toMatch(/ellipse/);
  });

  // ── 5. Input races ─────────────────────────────────────────

  test('second stylus pointerdown mid-stroke is ignored; first stroke commits', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });

    await pointerEvent(page, 'pointerdown', { x: 300, y: 300 }, { pointerType: 'pen', pointerId: 11 });
    await pointerEvent(page, 'pointermove', { x: 330, y: 300 }, { pointerType: 'pen', pointerId: 11 });
    // Second stylus arrives. Must not steal or fork the stroke.
    await pointerEvent(page, 'pointerdown', { x: 400, y: 360 }, { pointerType: 'pen', pointerId: 12 });
    await pointerEvent(page, 'pointermove', { x: 430, y: 360 }, { pointerType: 'pen', pointerId: 12 });
    await pointerEvent(page, 'pointerup', { x: 430, y: 360 }, { pointerType: 'pen', pointerId: 12, buttons: 0 });
    await pointerEvent(page, 'pointermove', { x: 380, y: 300 }, { pointerType: 'pen', pointerId: 11 });
    await pointerEvent(page, 'pointerup', { x: 380, y: 300 }, { pointerType: 'pen', pointerId: 11, buttons: 0 });

    const result = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      return { count: strokes.length, pts: strokes[0]?.points?.length ?? 0 };
    });
    expect(result.count).toBe(1);
    expect(result.pts).toBeGreaterThanOrEqual(4);
  });

  test('second stylus pointercancel must not wipe the first stroke', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });

    await pointerEvent(page, 'pointerdown', { x: 280, y: 280 }, { pointerType: 'pen', pointerId: 21 });
    await pointerEvent(page, 'pointermove', { x: 310, y: 280 }, { pointerType: 'pen', pointerId: 21 });
    await pointerEvent(page, 'pointerdown', { x: 500, y: 400 }, { pointerType: 'pen', pointerId: 22 });
    // Hostile: the ignored stylus cancels. The owner must keep writing.
    await pointerEvent(page, 'pointercancel', { x: 500, y: 400 }, { pointerType: 'pen', pointerId: 22, buttons: 0 });
    await pointerEvent(page, 'pointermove', { x: 360, y: 280 }, { pointerType: 'pen', pointerId: 21 });
    await pointerEvent(page, 'pointerup', { x: 360, y: 280 }, { pointerType: 'pen', pointerId: 21, buttons: 0 });

    const result = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      return { count: strokes.length };
    });
    expect(result.count).toBe(1);
  });

  test('pinch during finger-pan handover ×10 leaves input usable', async ({ page }) => {
    await page.evaluate(() => {
      const tool = (window as any).__POWERNOTE_STORES__.tool.getState();
      tool.setTool('draw');
      tool.setDrawOptions({ touchDraw: 'never' });
    });

    for (let i = 0; i < 10; i += 1) {
      await pointerEvent(page, 'pointerdown', { x: 360, y: 300 }, { pointerId: 300 + i });
      await pointerEvent(page, 'pointermove', { x: 380, y: 300 }, { pointerId: 300 + i });
      await touchEvent(page, 'touchstart', [
        { x: 300, y: 300 },
        { x: 500, y: 300 },
      ]);
      await touchEvent(page, 'touchmove', [
        { x: 290, y: 300 },
        { x: 510, y: 300 },
      ]);
      await touchEvent(page, 'touchend', [], [
        { x: 290, y: 300 },
        { x: 510, y: 300 },
      ]);
      await pointerEvent(page, 'pointerup', { x: 380, y: 300 }, { pointerId: 300 + i, buttons: 0 });
    }

    const midway = await page.evaluate(() => {
      const strokes = (window as any).__POWERNOTE_STORES__.draw.getState().strokes;
      const vp = (window as any).__POWERNOTE_STORES__.canvas.getState().viewport;
      return { strokes: strokes.length, scale: vp.scale };
    });
    expect(midway.strokes).toBe(0);

    // Next stroke must still work (no stuck activePointer).
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setDrawOptions({ touchDraw: 'always' });
    });
    await pointerEvent(page, 'pointerdown', { x: 300, y: 340 }, { pointerId: 401 });
    await pointerEvent(page, 'pointermove', { x: 340, y: 340 }, { pointerId: 401 });
    await pointerEvent(page, 'pointermove', { x: 380, y: 340 }, { pointerId: 401 });
    await pointerEvent(page, 'pointerup', { x: 380, y: 340 }, { pointerId: 401, buttons: 0 });

    const after = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    expect(after).toBe(1);
  });

  test('pointercancel mid-stroke commits nothing and the next stroke works', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__POWERNOTE_STORES__.tool.getState().setTool('draw');
    });

    await pointerEvent(page, 'pointerdown', { x: 300, y: 300 }, { pointerType: 'pen', pointerId: 31 });
    await pointerEvent(page, 'pointermove', { x: 340, y: 310 }, { pointerType: 'pen', pointerId: 31 });
    await pointerEvent(page, 'pointercancel', { x: 340, y: 310 }, { pointerType: 'pen', pointerId: 31, buttons: 0 });

    const mid = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    expect(mid).toBe(0);

    await pointerEvent(page, 'pointerdown', { x: 300, y: 360 }, { pointerType: 'pen', pointerId: 32 });
    await pointerEvent(page, 'pointermove', { x: 360, y: 360 }, { pointerType: 'pen', pointerId: 32 });
    await pointerEvent(page, 'pointerup', { x: 360, y: 360 }, { pointerType: 'pen', pointerId: 32, buttons: 0 });

    const after = await page.evaluate(
      () => (window as any).__POWERNOTE_STORES__.draw.getState().strokes.length,
    );
    expect(after).toBe(1);
  });
});
