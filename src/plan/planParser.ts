/**
 * A tolerant reader for PLAN.md, matching powerplan's parser (powerplan/plan_parser.py):
 *
 * - `## vX.Y - Title` opens a major; unversioned `##` headers close it and are prose.
 * - `### vX.Y.Z - Title (STATUS)` is an iteration, inside the open major or on its own.
 * - `- [ ]` / `- [x]` lines (not indented) inside an iteration are its tasks.
 * - `**Goal:**` is the iteration's goal; `## Backlog` / `## Future (Backlog)` collects bullets.
 * - The current iteration is resolved the way powerplan's `current_iteration()` does it.
 *
 * Read-only: PowerScroll never writes PLAN.md, powerplan stays its single writer (REQ-PLAN-003).
 */

export interface PlanTask {
  text: string;
  done: boolean;
  /** From a trailing `[agent: name]` tag, else null. */
  agent: string | null;
  /** Unticked owner check: the text starts with "Owner request" or "Owner report" (REQ-PLAN-007). */
  needsOwner: boolean;
}

export interface PlanIteration {
  version: string;
  title: string;
  status: string | null;
  goal: string | null;
  tasks: PlanTask[];
  done: number;
  total: number;
  complete: boolean;
  /** Version of the major it sits in, or null. */
  major: string | null;
}

export interface PlanMajor {
  version: string;
  title: string;
  iterations: PlanIteration[];
}

export interface ParsedPlan {
  title: string;
  /** Majors in file order; iterations outside any major are grouped under a major with version ''. */
  majors: PlanMajor[];
  iterations: PlanIteration[];
  backlog: string[];
  current: PlanIteration | null;
}

const RE_ITERATION = /^###\s+(v?\d+\.\d+\.\d+)\s*[-—–]\s*(.+?)\s*$/;
const RE_MAJOR = /^##\s+(v?\d+\.\d+)\s*[-—–]\s*(.+?)\s*$/;
const RE_BACKLOG = /^#{1,3}\s+((?:Future\s*\(\s*Backlog\s*\)|Backlog\b).*)$/i;
const RE_PHASE_LIKE = /^#\s+Phase\s+\d+\s*:/i;
const RE_TASK = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const RE_BULLET = /^[-*]\s+(?!\[[ xX]\])(.*)$/;
const RE_GOAL = /^\*\*Goal:\*\*\s*(.*)$/i;
const RE_TITLE = /^#\s+(.+?)\s*$/;
const STATUS_HINT = /(COMPLETE|CLOSED|DONE|ACTIVE|IN PROGRESS|NEXT|WIP|BLOCKED|FAILED|REOPEN(?:ED)?|DRASTIC)/i;
const RE_AGENT = /\s*\[agent:\s*([^\]]+)\]\s*$/i;
const RE_OWNER = /^owner\s+(request|report)\b/i;

const normalizeVersion = (version: string) => (version.startsWith('v') ? version : `v${version}`);

function extractStatus(title: string): [string, string | null] {
  const paren = /\s*\(([^)]*)\)\s*$/.exec(title);
  if (paren && STATUS_HINT.test(paren[1])) return [title.slice(0, paren.index).trimEnd(), paren[1].trim()];
  const tail = /\s+[-—–]\s+((?:COMPLETE|CLOSED|DONE)\b.*)$/i.exec(title);
  if (tail) return [title.slice(0, tail.index).trimEnd(), tail[1].trim()];
  return [title.trim(), null];
}

/** powerplan's Iteration.is_complete. */
function isComplete(status: string | null, done: number, total: number): boolean {
  const upper = (status ?? '').toUpperCase();
  if (upper) {
    if (/FAILED|REOPEN|BLOCKED/.test(upper)) return false;
    if (/COMPLETE|CLOSED|DONE/.test(upper)) return !(total > 0 && done < total);
    if (/ACTIVE|IN PROGRESS|NEXT|WIP/.test(upper)) return false;
  }
  if (total > 0) return done === total;
  return false;
}

function parseTask(raw: string, done: boolean): PlanTask {
  const agentMatch = RE_AGENT.exec(raw);
  const text = (agentMatch ? raw.slice(0, agentMatch.index) : raw).trim();
  return { text, done, agent: agentMatch ? agentMatch[1].trim() : null, needsOwner: !done && RE_OWNER.test(text) };
}

/** powerplan's Plan.current_iteration(), without the Current Status table (rule 2). */
function resolveCurrent(iterations: PlanIteration[]): PlanIteration | null {
  if (!iterations.length) return null;
  const marked = iterations.filter((it) => /\bcurrent\b/i.test(`${it.status ?? ''} ${it.title}`));
  if (marked.length) return marked.find((it) => !it.complete) ?? marked[marked.length - 1];
  return iterations.find((it) => !it.complete && it.tasks.some((task) => !task.done))
    ?? iterations.find((it) => !it.complete)
    ?? iterations[iterations.length - 1];
}

export function parsePlan(source: string): ParsedPlan {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const majors: PlanMajor[] = [];
  const iterations: PlanIteration[] = [];
  const backlog: string[] = [];
  let major: PlanMajor | null = null;
  let iteration: PlanIteration | null = null;
  let inBacklog = false;
  let loose: PlanMajor | null = null;

  const finish = () => {
    if (!iteration) return;
    iteration.done = iteration.tasks.filter((task) => task.done).length;
    iteration.total = iteration.tasks.length;
    iteration.complete = isComplete(iteration.status, iteration.done, iteration.total);
    iteration = null;
  };

  for (const line of lines) {
    if (!title) {
      const heading = RE_TITLE.exec(line);
      if (heading && !RE_PHASE_LIKE.test(line)) {
        title = heading[1].replace(/\s+[-—–]\s+Implementation Plan$/i, '').trim();
        continue;
      }
    }
    if (RE_PHASE_LIKE.test(line)) {
      finish();
      continue;
    }
    const majorMatch = RE_MAJOR.exec(line);
    if (majorMatch) {
      finish();
      inBacklog = false;
      major = { version: normalizeVersion(majorMatch[1]), title: majorMatch[2].trim(), iterations: [] };
      majors.push(major);
      continue;
    }
    const iterationMatch = RE_ITERATION.exec(line);
    if (iterationMatch) {
      finish();
      inBacklog = false;
      const [cleanTitle, status] = extractStatus(iterationMatch[2].trim());
      let host = major;
      if (!host) {
        if (!loose) {
          loose = { version: '', title: 'Iterations', iterations: [] };
          majors.push(loose);
        }
        host = loose;
      }
      iteration = {
        version: normalizeVersion(iterationMatch[1]), title: cleanTitle, status, goal: null, tasks: [],
        done: 0, total: 0, complete: false, major: host.version || null,
      };
      host.iterations.push(iteration);
      iterations.push(iteration);
      continue;
    }
    const backlogMatch = RE_BACKLOG.exec(line);
    if (backlogMatch) {
      finish();
      major = null;
      inBacklog = true;
      continue;
    }
    if (line.startsWith('## ')) {
      // An unversioned major-level header (e.g. "## Current Status") closes everything.
      finish();
      major = null;
      inBacklog = false;
      continue;
    }
    if (iteration) {
      const task = RE_TASK.exec(line);
      if (task) {
        iteration.tasks.push(parseTask(task[2], task[1].toLowerCase() === 'x'));
        continue;
      }
      const goal = RE_GOAL.exec(line);
      if (goal && iteration.goal === null) {
        iteration.goal = goal[1].trim() || null;
        continue;
      }
    } else if (inBacklog) {
      const bullet = RE_BULLET.exec(line) ?? RE_TASK.exec(line);
      if (bullet) backlog.push((bullet[2] ?? bullet[1]).trim());
    }
  }
  finish();
  const shown = majors.filter((entry) => entry.iterations.length > 0);
  return { title, majors: shown, iterations, backlog, current: resolveCurrent(iterations) };
}

/** Tasks across the plan still waiting for the owner (REQ-PLAN-007). */
export function ownerChecks(plan: ParsedPlan): Array<{ iteration: PlanIteration; task: PlanTask }> {
  return plan.iterations.flatMap((iteration) =>
    iteration.tasks.filter((task) => task.needsOwner).map((task) => ({ iteration, task })));
}
