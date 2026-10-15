import React, {
  KeyboardEvent, MouseEvent, PointerEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState
} from "react";
import { observer } from "mobx-react-lite";
import { Point, TestPhrasePoint } from "../models/plugin-store";
import { useStore } from "../models/store-context";
import { clearCodapSelection, selectPoint, selectTestPhrase } from "../models/selection-sync";
import {
  applyView, directionToPixels, gridLines, IPosition, ISize, IView, offsetFromNeighbor, paddedBounds, panToInclude,
  toPixels, worldBounds
} from "../tsne/layout";
import { kPlotSymbolExtents, kTestPhraseColor, symbolName, symbolPath, symbolReach } from "./phrase-symbol";
import { ZoomControls } from "./zoom-controls";
import "./graph.scss";

// Radii of the outline and rings described in _variables.scss, then the focus ring outside them
const kPointRadius = 6;
const kHitRadius = 12;
const kOutlineRadius = kPointRadius + 0.5;
const kSelectionRingRadius = kPointRadius + 2;
const kSelectionEdgeRadius = kPointRadius + 3.5;
const kFocusRingRadius = kPointRadius + 5;
// Symbol rings are its path stroked; half of each width lands outside. Set inline, or the dots' CSS
// widths win.
const kSymbolOutlineWidth = 2;
const kSymbolRingWidth = 6;
const kSymbolEdgeWidth = 8;
const kSymbolFocusOuterWidth = 12;

// Positions go through the view; sizes don't
const viewPixels = (point: IPosition, view: IView, size: ISize) => toPixels(applyView(point, view), size);

// A smaller move is still a click
const kDragThresholdPx = 3;

interface IDrag {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  isDragging: boolean;
}

const caseKey = (caseId: string) => `case:${caseId}`;
const slotKey = (slot: number) => `slot:${slot}`;
const slotFromKey = (key: string) => key.startsWith("slot:") ? Number(key.slice(5)) : undefined;

export const kTooFewMessage = "Add at least 4 phrases to see the plot.";
export const kErrorMessage = "Something went wrong while making the plot.";
export const kKeyboardHelp =
  "Arrow keys, Home and End move between phrases, then test phrases. " +
  "Enter selects; Shift+Enter adds or removes; Escape clears.";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const useElementSize = (ref: React.RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState<ISize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setSize({ width, height });
    if (typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [ref]);
  return size;
};

interface IPointMarksProps {
  color: string;
  selected: boolean;
}

const PointMarks = ({ color, selected }: IPointMarksProps) => (
  <>
    <circle className="dot" data-testid="dot" r={kPointRadius} fill={color} />
    <circle className="dot-outline" data-testid="dot-outline" r={kOutlineRadius} />
    {selected && <circle className="selection-ring" data-testid="selection-ring" r={kSelectionRingRadius} />}
    {selected && <circle className="selection-edge" data-testid="selection-edge" r={kSelectionEdgeRadius} />}
    <circle className="focus-ring" r={kFocusRingRadius} />
  </>
);

/** One Tab stop; arrow keys move through the case points, then the test phrases. */
export const Graph = observer(() => {
  const store = useStore();
  const maskIdPrefix = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const helpId = useId();
  const pointRefs = useRef(new Map<string, SVGGElement>());
  const area = useElementSize(containerRef);
  // A square centered in the area, at whole pixels so the grid lines stay sharp; the bands around it
  // are the area's background
  const side = Math.floor(Math.min(area.width, area.height));
  const size = useMemo(() => ({ width: side, height: side }), [side]);
  const offset = { left: Math.floor((area.width - side) / 2), top: Math.floor((area.height - side) / 2) };

  // Kept while a recompute empties the plot, so focus can return
  const [activeKey, setActiveKey] = useState<string>();
  const focusWithin = useRef(false);
  // Set when a recompute removed the focused point, until focus is back on a point
  const restoringFocus = useRef(false);
  // Every drag end clears it, so none is left running
  const drag = useRef<IDrag | undefined>(undefined);
  // The click after a drag isn't a background click
  const ignoreClick = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const { computeStatus } = store;
  const { zoomLevel, centerX, centerY } = store.view;
  const view = useMemo<IView>(() => ({ zoomLevel, centerX, centerY }), [zoomLevel, centerX, centerY]);

  // Table order for drawing and the arrow keys; the layout uses its own fixed order
  const points = useMemo(() => {
    const byCaseId = new Map(store.points.map(point => [point.caseId, point]));
    const ordered: Point[] = [];
    store.rows.forEach(row => {
      const point = byCaseId.get(row.caseId);
      if (point) ordered.push(point);
    });
    return ordered;
  }, [store.points, store.rows]);
  const phrases = useMemo(() => new Map(store.rows.map(row => [row.caseId, row.phrase])), [store.rows]);
  const testPoints = useMemo(
    () => store.testPhrasePoints.filter(point => store.placedSlots.has(point.slot)).sort((a, b) => a.slot - b.slot),
    [store.testPhrasePoints, store.placedSlots]);
  const keys = useMemo(
    () => [...points.map(point => caseKey(point.caseId)), ...testPoints.map(point => slotKey(point.slot))],
    [points, testPoints]);
  const activeExists = activeKey !== undefined && keys.includes(activeKey);

  // If the remembered point is gone while focus is in the plot, use the first point. From outside,
  // keep it: a test phrase's point is only hidden while its field is edited, and comes back.
  useEffect(() => {
    if (focusWithin.current && activeKey !== undefined && keys.length > 0 && !keys.includes(activeKey)) {
      setActiveKey(keys[0]);
    }
  }, [activeKey, keys]);

  // When a recompute removes the focused point, hold focus on the plot, then return it to the
  // active point. Focus the user put on the plot stays there.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!focusWithin.current || !svg) return;
    const focusLost = !svg.contains(document.activeElement);
    if (!focusLost && !restoringFocus.current) return;
    const target = activeExists ? pointRefs.current.get(activeKey) : svg;
    if (target && document.activeElement !== target) target.focus();
    restoringFocus.current = !activeExists;
  });

  const moveTo = (key: string | undefined) => {
    if (key === undefined) return;
    setActiveKey(key);
    pointRefs.current.get(key)?.focus();
  };

  const select = (key: string, extend: boolean) => {
    const slot = slotFromKey(key);
    if (slot !== undefined) selectTestPhrase(store, slot, extend);
    else selectPoint(store, key.slice("case:".length), extend);
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    // Leave shortcuts such as Alt+Arrow to the browser
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = activeExists ? keys.indexOf(activeKey) : -1;
    const last = keys.length - 1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        moveTo(keys[index < 0 ? 0 : Math.min(index + 1, last)]);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        moveTo(keys[index < 0 ? last : Math.max(index - 1, 0)]);
        break;
      case "Home":
        moveTo(keys[0]);
        break;
      case "End":
        moveTo(keys[last]);
        break;
      case "Enter":
      case " ":
        // A held key would select, or with Shift add and remove, over and over
        if (event.repeat) break;
        // These keys on the plot itself select nothing
        if (event.target === svgRef.current || !activeExists) return;
        select(activeKey, event.shiftKey);
        break;
      case "Escape":
        clearCodapSelection(store);
        break;
      default:
        return;
    }
    // Arrows and Space would scroll
    event.preventDefault();
  };

  const handleBackgroundClick = (event: MouseEvent<SVGSVGElement>) => {
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    // A Shift-click on empty space adds nothing
    if (!event.shiftKey) clearCodapSelection(store);
  };

  // Only from the background: a press on a point is a click on it. An empty plot has no view to move.
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!store.hasGraph || event.button !== 0 || (event.target as Element).closest(".point")) return;
    // A second finger doesn't take over a drag
    if (drag.current) return;
    // In case the last drag's click never came
    ignoreClick.current = false;
    const { pointerId, clientX, clientY } = event;
    drag.current = { pointerId, startX: clientX, startY: clientY, lastX: clientX, lastY: clientY, isDragging: false };
    // Drags past the plot's edge. Optional: jsdom lacks it.
    svgRef.current?.setPointerCapture?.(pointerId);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (event.pointerId !== current?.pointerId) return;
    // No button down: the release never came, as when the window lost focus mid-drag
    if (event.buttons === 0) {
      endDrag(event, false);
      return;
    }
    const { clientX, clientY } = event;
    if (!current.isDragging) {
      if (Math.hypot(clientX - current.startX, clientY - current.startY) < kDragThresholdPx) return;
      current.isDragging = true;
      setIsDragging(true);
    }
    // From the last position (the press at first), so the dots follow the pointer
    const { left, top, right, bottom } = paddedBounds(size);
    const scale = store.scale;
    const { centerX: x, centerY: y } = store.view;
    store.panTo(
      right > left ? x - (clientX - current.lastX) / ((right - left) * scale) : x,
      // y is flipped, as in `toPixels`
      bottom > top ? y + (clientY - current.lastY) / ((bottom - top) * scale) : y);
    current.lastX = clientX;
    current.lastY = clientY;
  };

  // No click follows a cancel or a lost capture
  const endDrag = (event: PointerEvent<SVGSVGElement>, isRelease: boolean) => {
    const current = drag.current;
    if (event.pointerId !== current?.pointerId) return;
    if (isRelease && current.isDragging) ignoreClick.current = true;
    drag.current = undefined;
    setIsDragging(false);
  };

  const handlePointClick = (event: MouseEvent<SVGGElement>, key: string) => {
    event.stopPropagation();
    setActiveKey(key);
    select(key, event.shiftKey);
  };

  const pointRef = (key: string) => (element: SVGGElement | null) => {
    if (element) pointRefs.current.set(key, element);
    else pointRefs.current.delete(key);
  };

  // In slot order: each symbol keeps clear of every dot and of the lower slots' symbols. Includes the
  // hidden slot being edited, so the others don't move into its place meanwhile. The bounds are the
  // whole layout's, so a symbol stays with an off-screen neighbor.
  const testPointPixels = useMemo(() => {
    const bounds = worldBounds(size, view);
    const casePixels = store.points.map(point => ({ caseId: point.caseId, ...viewPixels(point, view, size) }));
    const placed = new Map<number, IPosition>();
    store.testPhrasePoints.slice().sort((a, b) => a.slot - b.slot).forEach((point: TestPhrasePoint) => {
      const pixels = viewPixels(point, view, size);
      const neighbor = casePixels.find(({ caseId }) => caseId === point.neighborCaseId);
      if (!neighbor) {
        placed.set(point.slot, { x: Math.min(bounds.right, Math.max(bounds.left, pixels.x)),
          y: Math.min(bounds.bottom, Math.max(bounds.top, pixels.y)) });
        return;
      }
      const others = [...casePixels.filter(({ caseId }) => caseId !== point.neighborCaseId), ...placed.values()];
      placed.set(point.slot,
        offsetFromNeighbor(neighbor, pixels, directionToPixels(point.direction, size), bounds, others));
    });
    return placed;
  }, [store.points, store.testPhrasePoints, size, view]);

  // A point given keyboard focus outside the padded area pans into view. By its drawn position: the
  // ring search can move a symbol 18px. Not on a mouse press, which would move the dot from under the
  // pointer before release and make the click land on the background. (jsdom always matches
  // :focus-visible.)
  const handlePointFocus = (key: string) => {
    setActiveKey(key);
    const slot = slotFromKey(key);
    const caseId = key.slice("case:".length);
    const casePoint = slot === undefined ? store.points.find(point => point.caseId === caseId) : undefined;
    const pixel = slot !== undefined ? testPointPixels.get(slot) : casePoint && viewPixels(casePoint, view, size);
    if (!pixel || !pointRefs.current.get(key)?.matches(":focus-visible")) return;
    const panned = panToInclude(view, pixel, size);
    if (panned !== view) store.panTo(panned.centerX, panned.centerY);
  };

  // A test phrase is drawn after the case points, so only a case point needs drawing again on top
  const activePoint = activeExists ? points.find(point => caseKey(point.caseId) === activeKey) : undefined;
  const activePixels = activePoint && viewPixels(activePoint, view, size);
  const hasPoints = points.length > 0;
  const hasLabels = store.labelAttributeName !== undefined;
  const testPhraseCount = testPoints.length > 0 ? ` and ${plural(testPoints.length, "test phrase")}` : "";
  const label = !hasPoints ? "t-SNE plot"
    : (hasLabels ? `t-SNE plot of ${plural(points.length, "phrase")} in ${plural(store.labelEntries.length, "label")}`
      : `t-SNE plot of ${plural(points.length, "phrase")}`) + testPhraseCount;
  const pointName = (caseId: string) => {
    const phrase = phrases.get(caseId) ?? caseId;
    return hasLabels ? `${phrase}, ${store.labelForCase(caseId)}` : phrase;
  };
  const message = computeStatus === "too-few" ? kTooFewMessage : computeStatus === "error" ? kErrorMessage : "";
  // On half pixels, so each line renders as one sharp pixel
  const grid = gridLines(size, view);

  return (
    <div className="graph" data-testid="graph-area" ref={containerRef}>
      <ZoomControls />
      <svg
        ref={svgRef}
        className="graph-plot"
        width={size.width}
        height={size.height}
        style={offset}
        role="group"
        aria-label={label}
        aria-describedby={hasPoints ? helpId : undefined}
        // One Tab stop: the plot until a point is focused. An empty plot leaves the Tab order but
        // can still take focus.
        tabIndex={hasPoints && !activeExists ? 0 : -1}
        data-dragging={isDragging || undefined}
        onKeyDown={handleKeyDown}
        onClick={handleBackgroundClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={event => endDrag(event, true)}
        onPointerCancel={event => endDrag(event, false)}
        onLostPointerCapture={event => endDrag(event, false)}
        onFocus={() => { focusWithin.current = true; }}
        onBlur={event => {
          // A focused point that is removed blurs with no relatedTarget; that isn't leaving
          const leaving = event.relatedTarget
            ? !svgRef.current?.contains(event.relatedTarget as Node)
            : (event.target as Element).isConnected;
          if (leaving) {
            focusWithin.current = false;
            restoringFocus.current = false;
          }
        }}
      >
        <g className="grid" data-testid="grid" aria-hidden="true">
          {grid.x.map(x =>
            <line key={`x${x}`} data-testid="grid-line" x1={x} x2={x} y1={0} y2={size.height} />)}
          {grid.y.map(y =>
            <line key={`y${y}`} data-testid="grid-line" x1={0} x2={size.width} y1={y} y2={y} />)}
        </g>
        {points.map(point => {
          const { x, y } = viewPixels(point, view, size);
          const selected = store.isSelected(point.caseId);
          const key = caseKey(point.caseId);
          return (
            <g
              key={key}
              ref={pointRef(key)}
              className="point"
              transform={`translate(${x} ${y})`}
              role="button"
              aria-label={pointName(point.caseId)}
              aria-pressed={selected}
              tabIndex={key === activeKey ? 0 : -1}
              onClick={event => handlePointClick(event, key)}
              onFocus={() => handlePointFocus(key)}
            >
              <circle className="hit-area" data-testid="hit-area" r={kHitRadius} />
              <PointMarks color={store.colorForCase(point.caseId)} selected={selected} />
            </g>
          );
        })}
        {/* The active point drawn again on top of its neighbors. Moving the point itself to the end
            would make React move a focused element, which drops its focus. */}
        {activePoint && activePixels && (
          <g className="active-point" data-testid="active-point" aria-hidden="true"
            transform={`translate(${activePixels.x} ${activePixels.y})`}>
            <PointMarks color={store.colorForCase(activePoint.caseId)}
              selected={store.isSelected(activePoint.caseId)} />
          </g>
        )}
        {testPoints.map(point => {
          const { x, y } = testPointPixels.get(point.slot) ?? { x: 0, y: 0 };
          const selected = store.isSlotSelected(point.slot);
          const symbol = store.symbolForSlot(point.slot);
          const extent = kPlotSymbolExtents[symbol];
          const path = symbolPath(symbol, extent);
          const key = slotKey(point.slot);
          const maskId = `${maskIdPrefix}-focus-${point.slot}`;
          // The focus ring's reach, plus 1px: half the stroke past the path, or up to √2 times that at a
          // mitered 90° corner. Too big is harmless.
          const maskSize = 2 * (symbolReach(symbol, extent) + kSymbolFocusOuterWidth / 2 * Math.SQRT2 + 1);
          const maskOrigin = -maskSize / 2;
          return (
            <g
              key={key}
              ref={pointRef(key)}
              className="point test-phrase-point"
              transform={`translate(${x} ${y})`}
              role="button"
              aria-label={`${symbolName(symbol)} test phrase: ${store.testPhrases[point.slot]}`}
              aria-pressed={selected}
              tabIndex={key === activeKey ? 0 : -1}
              data-symbol={symbol}
              data-testid="test-phrase-point"
              onClick={event => handlePointClick(event, key)}
              onFocus={() => handlePointFocus(key)}
            >
              <circle className="hit-area" data-testid="hit-area" r={kHitRadius} />
              {selected && <path className="selection-edge" data-testid="selection-edge" d={path}
                style={{ strokeWidth: kSymbolEdgeWidth }} />}
              {selected && <path className="selection-ring" data-testid="selection-ring" d={path}
                style={{ strokeWidth: kSymbolRingWidth }} />}
              <path className="dot-outline" data-testid="dot-outline" d={path}
                style={{ strokeWidth: kSymbolOutlineWidth }} />
              <path className="symbol" data-testid="symbol" d={path} fill={kTestPhraseColor} />
              {/* Focus ring: 4–6px outside the symbol's edges, a wide stroke with its inner part masked out */}
              <mask id={maskId} data-testid="focus-mask" maskUnits="userSpaceOnUse" x={maskOrigin} y={maskOrigin}
                width={maskSize} height={maskSize}>
                <path d={path} fill="white" stroke="white" strokeWidth={kSymbolFocusOuterWidth}
                  data-testid="focus-mask-outer" />
                <path d={path} fill="black" stroke="black" strokeWidth={kSymbolEdgeWidth}
                  data-testid="focus-mask-inner" />
              </mask>
              <path className="focus-ring" data-testid="focus-ring" d={path} mask={`url(#${maskId})`}
                style={{ strokeWidth: kSymbolFocusOuterWidth }} />
            </g>
          );
        })}
      </svg>
      <p className="visually-hidden" id={helpId}>{kKeyboardHelp}</p>
      <p className="graph-status" role="status" aria-live="polite">{message}</p>
    </div>
  );
});
