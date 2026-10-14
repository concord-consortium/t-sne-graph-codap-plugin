import React, {
  KeyboardEvent, MouseEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState
} from "react";
import { observer } from "mobx-react-lite";
import { Point, TestPhrasePoint } from "../models/plugin-store";
import { useStore } from "../models/store-context";
import { clearCodapSelection, selectPoint, selectTestPhrase } from "../models/selection-sync";
import { directionToPixels, IPosition, ISize, offsetFromNeighbor, paddedBounds, toPixels } from "../tsne/layout";
import { kPlotSymbolExtents, kTestPhraseColor, symbolPath } from "./phrase-symbol";
import "./graph.scss";

const kGridCells = 8;
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

const caseKey = (caseId: string) => `case:${caseId}`;
const slotKey = (slot: number) => `slot:${slot}`;
const slotFromKey = (key: string) => key.startsWith("slot:") ? Number(key.slice(5)) : undefined;
const symbolName = (symbol: string) => symbol.charAt(0).toUpperCase() + symbol.slice(1);

export const kTooFewMessage = "Add at least 4 phrases to see the plot.";
export const kErrorMessage = "Something went wrong while making the plot.";
export const kKeyboardHelp =
  "Arrow keys, Home and End move between phrases. Enter selects; Shift+Enter adds or removes; Escape clears.";

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

  const { computeStatus } = store;
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
    // A Shift-click on empty space adds nothing
    if (!event.shiftKey) clearCodapSelection(store);
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
  // hidden slot being edited, so the others don't move into its place meanwhile.
  const testPointPixels = useMemo(() => {
    const bounds = paddedBounds(size);
    const casePixels = store.points.map(point => ({ caseId: point.caseId, ...toPixels(point, size) }));
    const placed = new Map<number, IPosition>();
    store.testPhrasePoints.slice().sort((a, b) => a.slot - b.slot).forEach((point: TestPhrasePoint) => {
      const pixels = toPixels(point, size);
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
  }, [store.points, store.testPhrasePoints, size]);

  // A test phrase is drawn after the case points, so only a case point needs drawing again on top
  const activePoint = activeExists ? points.find(point => caseKey(point.caseId) === activeKey) : undefined;
  const activePixels = activePoint && toPixels(activePoint, size);
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
  // Interior lines, on half pixels so they render as one sharp pixel
  const gridLines = Array.from({ length: kGridCells - 1 }, (_value, i) => i + 1);
  const gridX = (i: number) => Math.round(i * size.width / kGridCells) + 0.5;
  const gridY = (i: number) => Math.round(i * size.height / kGridCells) + 0.5;

  return (
    <div className="graph" data-testid="graph-area" ref={containerRef}>
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
        onKeyDown={handleKeyDown}
        onClick={handleBackgroundClick}
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
          {gridLines.map(i =>
            <line key={`x${i}`} data-testid="grid-line" x1={gridX(i)} x2={gridX(i)} y1={0} y2={size.height} />)}
          {gridLines.map(i =>
            <line key={`y${i}`} data-testid="grid-line" x1={0} x2={size.width} y1={gridY(i)} y2={gridY(i)} />)}
        </g>
        {points.map(point => {
          const { x, y } = toPixels(point, size);
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
              onFocus={() => setActiveKey(key)}
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
          // The focus ring's reach, plus 1px
          const maskSize = extent + kSymbolFocusOuterWidth + 2;
          const maskOrigin = -maskSize / 2;
          return (
            <g
              key={key}
              ref={pointRef(key)}
              className="point test-phrase-point"
              transform={`translate(${x} ${y})`}
              role="button"
              aria-label={`${symbolName(symbol)}: ${store.testPhrases[point.slot]}`}
              aria-pressed={selected}
              tabIndex={key === activeKey ? 0 : -1}
              data-symbol={symbol}
              data-testid="test-phrase-point"
              onClick={event => handlePointClick(event, key)}
              onFocus={() => setActiveKey(key)}
            >
              <circle className="hit-area" data-testid="hit-area" r={kHitRadius} />
              {selected && <path className="selection-edge" data-testid="selection-edge" d={path}
                style={{ strokeWidth: kSymbolEdgeWidth }} />}
              {selected && <path className="selection-ring" data-testid="selection-ring" d={path}
                style={{ strokeWidth: kSymbolRingWidth }} />}
              <path className="dot-outline" data-testid="dot-outline" d={path}
                style={{ strokeWidth: kSymbolOutlineWidth }} />
              <path className="symbol" data-testid="symbol" d={path} fill={kTestPhraseColor} />
              {/* Focus ring: the band 4–6px outside the symbol, a wide stroke with its inner part masked out */}
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
