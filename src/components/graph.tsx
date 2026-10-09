import React, { KeyboardEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { useStore } from "../models/store-context";
import { clearCodapSelection, selectInCodap } from "../models/selection-sync";
import { ISize, toPixels } from "../tsne/layout";
import "./graph.scss";

// Grid lines divide the graph into this many cells each way
const kGridCells = 8;
// Radii in pixels: the 12px point and its 24px click target. Outside the point, as in the spec's
// box-shadow (0 0 0 1px #fff, 0 0 0 3px #006c8e, 0 0 0 4px #fff): a 1px white outline on every
// point, then when selected a 2px ring and a 1px white edge, then the 2px keyboard focus ring.
const kPointRadius = 6;
const kHitRadius = 12;
const kOutlineRadius = kPointRadius + 0.5;
const kSelectionRingRadius = kPointRadius + 2;
const kSelectionEdgeRadius = kPointRadius + 3.5;
const kFocusRingRadius = kPointRadius + 5;

export const kTooFewMessage = "Add at least 4 phrases to see the plot.";
export const kErrorMessage = "Something went wrong while making the plot.";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The size of an element, kept current with a ResizeObserver
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

/**
 * The t-SNE scatter plot (CODAP-1571 plan §4.4): an 8 × 8 grid, one dot per point in its label's
 * color, and the selection mirrored from CODAP. The plot is one Tab stop; the arrow keys move
 * between points.
 */
export const Graph = observer(() => {
  const store = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointRefs = useRef(new Map<string, SVGGElement>());
  const size = useElementSize(containerRef);

  // The point the arrow keys move from. Kept while the graph is empty during a recompute, so
  // focus can come back to the same case.
  const [activeCaseId, setActiveCaseId] = useState<string>();
  // True while keyboard focus is in the plot
  const focusWithin = useRef(false);

  const { points, computeStatus } = store;
  const caseIds = useMemo(() => points.map(point => point.caseId), [points]);
  const phrases = useMemo(() => new Map(store.rows.map(row => [row.caseId, row.phrase])), [store.rows]);
  const activeExists = activeCaseId !== undefined && caseIds.includes(activeCaseId);

  // After a recompute, the remembered point moves to the first point if its case is gone
  useEffect(() => {
    if (activeCaseId !== undefined && caseIds.length > 0 && !caseIds.includes(activeCaseId)) {
      setActiveCaseId(caseIds[0]);
    }
  }, [activeCaseId, caseIds]);

  // Keep keyboard focus in the plot when its points change: on the active point if it is shown,
  // otherwise on the plot itself
  useLayoutEffect(() => {
    if (!focusWithin.current) return;
    const target = activeExists ? pointRefs.current.get(activeCaseId) : svgRef.current;
    if (target && document.activeElement !== target) target.focus();
  });

  const moveTo = (caseId: string | undefined) => {
    if (caseId === undefined) return;
    setActiveCaseId(caseId);
    pointRefs.current.get(caseId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const index = activeExists ? caseIds.indexOf(activeCaseId) : -1;
    const last = caseIds.length - 1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        moveTo(caseIds[index < 0 ? 0 : Math.min(index + 1, last)]);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        moveTo(caseIds[index < 0 ? last : Math.max(index - 1, 0)]);
        break;
      case "Home":
        moveTo(caseIds[0]);
        break;
      case "End":
        moveTo(caseIds[last]);
        break;
      case "Enter":
      case " ":
        // Only a focused point is selected; on the plot itself these keys do nothing
        if (event.target === svgRef.current || !activeExists) return;
        selectInCodap(store, [activeCaseId], event.shiftKey);
        break;
      case "Escape":
        clearCodapSelection(store);
        break;
      default:
        return;
    }
    // The arrow keys and Space would otherwise scroll
    event.preventDefault();
  };

  const handleBackgroundClick = (event: MouseEvent<SVGSVGElement>) => {
    // Shift-click extends the selection; on empty space there is nothing to add
    if (!event.shiftKey) clearCodapSelection(store);
  };

  const handlePointClick = (event: MouseEvent<SVGGElement>, caseId: string) => {
    event.stopPropagation();
    setActiveCaseId(caseId);
    selectInCodap(store, [caseId], event.shiftKey);
  };

  const hasPoints = points.length > 0;
  const label = hasPoints
    ? `t-SNE plot of ${plural(points.length, "phrase")} in ${plural(store.labelEntries.length, "label")}`
    : "t-SNE plot";
  const message = computeStatus === "too-few" ? kTooFewMessage : computeStatus === "error" ? kErrorMessage : "";
  // Lines at the cell edges inside the plot, on half pixels so each is one sharp pixel wide
  const gridLines = Array.from({ length: kGridCells - 1 }, (_value, i) => i + 1);
  const gridX = (i: number) => Math.round(i * size.width / kGridCells) + 0.5;
  const gridY = (i: number) => Math.round(i * size.height / kGridCells) + 0.5;

  return (
    <div className="graph" ref={containerRef}>
      <svg
        ref={svgRef}
        className="graph-plot"
        width={size.width}
        height={size.height}
        role="group"
        aria-label={label}
        // One Tab stop: the plot until a point has been focused, then that point. An empty plot
        // is not in the Tab order, but can take focus when its points go away.
        tabIndex={hasPoints && !activeExists ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={handleBackgroundClick}
        onFocus={() => { focusWithin.current = true; }}
        onBlur={event => {
          // A point removed while focused moves focus nowhere; that doesn't count as leaving
          const leaving = event.relatedTarget
            ? !svgRef.current?.contains(event.relatedTarget as Node)
            : (event.target as Element).isConnected;
          if (leaving) focusWithin.current = false;
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
          return (
            <g
              key={point.caseId}
              ref={element => {
                if (element) pointRefs.current.set(point.caseId, element);
                else pointRefs.current.delete(point.caseId);
              }}
              className="point"
              transform={`translate(${x} ${y})`}
              role="button"
              aria-label={phrases.get(point.caseId) ?? point.caseId}
              aria-pressed={selected}
              tabIndex={point.caseId === activeCaseId ? 0 : -1}
              onClick={event => handlePointClick(event, point.caseId)}
              onFocus={() => setActiveCaseId(point.caseId)}
            >
              <circle className="hit-area" data-testid="hit-area" r={kHitRadius} />
              <circle className="dot" data-testid="dot" r={kPointRadius} fill={store.colorForCase(point.caseId)} />
              <circle className="dot-outline" data-testid="dot-outline" r={kOutlineRadius} />
              {selected && <circle className="selection-ring" data-testid="selection-ring" r={kSelectionRingRadius} />}
              {selected && <circle className="selection-edge" data-testid="selection-edge" r={kSelectionEdgeRadius} />}
              <circle className="focus-ring" r={kFocusRingRadius} />
            </g>
          );
        })}
      </svg>
      <p className="graph-status" role="status" aria-live="polite">{message}</p>
    </div>
  );
});
