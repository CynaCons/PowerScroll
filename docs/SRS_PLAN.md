# SRS — Plan pages

**Feature:** a notebook page that shows a project's PLAN.md, the way powerplan structures it.
**Origin:** owner request 2026-11-26: "I would like powerplan to get a visualizer of its own, embedded
inside PowerScroll just like we did for the powerboards, it will be plans in powerscrolls". Owner pick
from the mockups the same day: a new page type with the iteration rail (option A).

## Requirements

| ID | Requirement | Priority | Test |
|---|---|---|---|
| REQ-PLAN-001 | A section shall offer "Add plan" next to "Add board"; it adds a page of kind `plan` (sidebar icon: a checklist) that opens the plan view instead of the canvas. Notebooks without plan pages are unchanged, and a plan page carries no scrolls. | Must | T254 |
| REQ-PLAN-002 | The plan view shall read PLAN.md with powerplan's rules: `## vX.Y - Title` majors, `### vX.Y.Z - Title (STATUS)` iterations inside the open major (or on their own), unindented `- [ ]` / `- [x]` tasks inside an iteration, `**Goal:**` lines, `[agent: name]` tags, and the `Backlog` / `Future (Backlog)` section; unversioned `##` headers close the open major. An iteration is complete by powerplan's `is_complete` rule, and the current iteration is resolved by powerplan's `current_iteration` order (an iteration marked "current", else the first open one with unticked tasks, else the first open one, else the last). | Must | T254 |
| REQ-PLAN-003 | The plan view is read-only: PowerScroll never writes PLAN.md, so powerplan stays its single writer. The last text read is kept in the notebook so the page shows without the file. | Must | T254 |
| REQ-PLAN-004 | "Open PLAN.md" shall use the browser's file picker. Where the File System Access API exists, the file stays linked to the page (remembered across reloads); elsewhere the file is read once as a snapshot. The header shows the file name and whether it is linked, a snapshot, or paused waiting for permission, with "Reconnect" in the last case. | Must | T254 |
| REQ-PLAN-005 | While a plan page is shown and the tab is visible, a linked file shall be looked at every 3 seconds and re-read when it changed, so ticks written by powerplan appear without any action from the owner. An unchanged file is not re-parsed. | Must | T254 |
| REQ-PLAN-006 | The rail shall show one row per major, oldest of the shown ones first, with each iteration a block whose width grows with its task count and whose fill is the share of its tasks done; the row ends with the major's percentage. Only the newest six majors show until "Show N earlier groups" is pressed. The current iteration's block is ringed. | Must | T254 |
| REQ-PLAN-007 | An unticked task whose text starts with "Owner request" or "Owner report" needs the owner. Iterations holding one are marked in the accent colour, and an "N need you" button lists every such task; picking one opens its iteration. The accent marks these and nothing else. | Must | T254 |
| REQ-PLAN-008 | Below the rail, the current iteration (or the block last clicked) shall be shown as a checklist: version, title, status, goal, a progress bar and each task with its agent tag or "needs you". Backlog items are listed in a collapsed section. | Must | T254 |
| REQ-PLAN-009 | Notebook search shall find plan iterations by title, goal and task text, and a result shall open its iteration on the plan page. | Should | T254 |

## Tests

- T254 — `tests/plan/254-plan-page.spec.ts`
