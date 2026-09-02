# SRS: Shapes

**Project:** PowerScroll (formerly PowerNote)
**Version:** 0.8.0
**Date:** 2026-03-22

## Purpose

Allow users to create, style, select, move, resize, and delete geometric shapes (rectangle, circle, triangle, arrow, line) on the canvas, with full persistence through save/load.

## Requirements

| ID | Description | Priority | Test Ref |
|----|-------------|----------|----------|
| REQ-SHAPE-001 | With the shape tool active, click+drag on the canvas shall create a shape of the selected type at the drag origin with dimensions matching the drag extent | Must | T51 |
| REQ-SHAPE-002 | The app shall support five shape types: rect, circle, triangle, arrow, line | Must | T51 |
| REQ-SHAPE-003 | A newly created shape shall use the current shape tool options (shapeType, fill, stroke, strokeWidth, strokeDash) | Must | T51 |
| REQ-SHAPE-004 | Shapes shall have configurable fill color, including 'transparent' for no fill | Must | T52 |
| REQ-SHAPE-005 | Shapes shall have configurable stroke color | Must | T52 |
| REQ-SHAPE-006 | Shapes shall have configurable stroke width (1-10 px) | Must | T52 |
| REQ-SHAPE-007 | Shapes shall have configurable stroke dash pattern (solid, dashed, dotted) | Must | T52 |
| REQ-SHAPE-008 | Clicking a shape shall select it; Ctrl+Click shall toggle multi-selection | Must | T51 |
| REQ-SHAPE-009 | Selected shapes shall be draggable to reposition on the canvas | Must | T51 |
| REQ-SHAPE-010 | Selected shapes shall be resizable via Transformer handles | Must | T51, T191 |
| REQ-SHAPE-011 | Delete/Backspace key shall delete the selected shape(s) | Must | T51 |
| REQ-SHAPE-012 | The ShapeToolbar shall appear in the bottom toolbar when the shape tool is active or a shape node is selected, providing shape type selector, fill/stroke color controls, stroke width, and dash style controls | Must | T52 |
| REQ-SHAPE-013 | Ctrl+C / Ctrl+V shall copy and paste selected shapes with a position offset | Must | T51 |
| REQ-SHAPE-014 | Shapes shall support a 5-layer z-index system (layers 1-5, default layer 3), controllable via right-click context menu | Must | T53 |
| REQ-SHAPE-015 | Shape nodes shall persist through save/load round-trips (all properties preserved in exported HTML) | Must | T51 |
| REQ-SHAPE-016 | Selecting an arrow or line shall display two vertex handles (start endpoint, end endpoint) instead of the standard rectangle Transformer | Must | — |
| REQ-SHAPE-017 | Dragging an arrow/line vertex handle shall update that endpoint's position independently while the other endpoint stays fixed | Must | — |
| REQ-SHAPE-018 | The arrow/line stroke shall redraw live while a vertex handle is being dragged | Must | — |
| REQ-SHAPE-019 | Hover highlight on arrows and lines shall detect the stroke path, not the bounding box | Must | — |
| REQ-SHAPE-020 | Dragging the body of an arrow/line shall translate both endpoints together | Must | — |
| REQ-SHAPE-021 | Releasing an arrow or line endpoint within the binding distance of a bindable node shall bind and snap it to that node's outline; a dashed candidate outline shall be shown while hovering. | Must | T194 |
| REQ-SHAPE-022 | Bound endpoints shall follow a node through move, resize, and rotation in the same undo entry. | Must | T194 |
| REQ-SHAPE-023 | Dragging an endpoint away shall unbind it; dragging an arrow body shall unbind both endpoints. | Must | T194 |
| REQ-SHAPE-024 | Deleting either side shall clean up the other, and bindings shall round-trip through save/load. | Must | T194 |
| REQ-SHAPE-025 | Pasted or duplicated arrows shall carry no bindings to nodes outside the copied set. | Must | T194 |
