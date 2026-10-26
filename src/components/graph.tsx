import React, {
  KeyboardEvent, MouseEvent, PointerEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState
} from "react";
import { observer } from "mobx-react-lite";
import { PhraseSymbol, Point, TestPhrasePoint } from "../models/plugin-store";
import { useStore } from "../models/store-context";
import { clearCodapSelection, selectPoint, selectTestPhrase } from "../models/selection-sync";
import { kTestPhraseColor, kTestPhraseTooltipFill, normalizePhrase } from "../tsne/labels";
import {
  applyView, directionToPixels, gridLines, IHitCandidate, IPosition, ISize, IView, nearestPoint, offsetFromNeighbor,
  paddedBounds, panToInclude, toPixels, worldBounds
} from "../tsne/layout";
import {
  kPlotSymbolExtents, kSymbolEdgeWidth, kSymbolOutlineWidth, kSymbolRingWidth, SymbolFocusRing, symbolName, symbolPath
} from "./phrase-symbol";
import { PointTooltip } from "./point-tooltip";
import { ZoomControls } from "./zoom-controls";
import "./graph.scss";

// Radii of the outline and rings described in _variables.scss, then the focus ring outside them
const kPointRadius = 6;
const kOutlineRadius = kPointRadius + 0.5;
const kSelectionRingRadius = kPointRadius + 2;
const kSelectionEdgeRadius = kPointRadius + 3.5;
const kFocusRingRadius = kPointRadius + 5;

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
  "Enter selects; Shift+Enter adds or removes; Escape hides the tooltip, then clears.";

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

interface ISymbolMarksProps {
  symbol: PhraseSymbol;
  selected: boolean;
}

const SymbolMarks = ({ symbol, selected }: ISymbolMarksProps) => {
  const extent = kPlotSymbolExtents[symbol];
  const path = symbolPath(symbol, extent);
  return (
    <>
      {selected && <path className="selection-edge" data-testid="selection-edge" d={path}
        style={{ strokeWidth: kSymbolEdgeWidth }} />}
      {selected && <path className="selection-ring" data-testid="selection-ring" d={path}
        style={{ strokeWidth: kSymbolRingWidth }} />}
      <path className="dot-outline" data-testid="dot-outline" d={path} style={{ strokeWidth: kSymbolOutlineWidth }} />
      <path className="symbol" data-testid="symbol" d={path} fill={kTestPhraseColor} />
      <SymbolFocusRing symbol={symbol} extent={extent} />
    </>
  );
};

/** One Tab stop; arrow keys move through the case points, then the test phrases. */
export const Graph = observer(() => {
  const store = useStore();
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
  // The point a press was on, for the click that follows. Cleared with the drag state, and by a move as far as a
  // drag's.
  const pressed = useRef<
    { key: string, pointerId: number, startX: number, startY: number, isReleased: boolean } | undefined
  >(undefined);
  const [isDragging, setIsDragging] = useState(false);
  // The point under a mouse or pen, or whose tooltip it is on
  const [hoverKey, setHoverKey] = useState<string>();
  // The point with DOM focus; `activeKey` outlives it
  const [focused, setFocused] = useState<{ key: string, showsTooltip: boolean }>();
  // Undefined for the keyboard
  const lastPointerType = useRef<string | undefined>(undefined);
  // By Escape, until a point is hovered or focused again
  const [isDismissed, setIsDismissed] = useState(false);

  // On the whole document, so a Tab from the panel back to a point counts as the keyboard. Leaving the
  // plugin resets it, so a Tab in from CODAP does too. A touch ends a resting mouse's hover: the latest
  // input wins.
  useEffect(() => {
    const handlePointer = (event: globalThis.PointerEvent) => {
      lastPointerType.current = event.pointerType;
      if (event.pointerType === "touch") setHoverKey(undefined);
    };
    const resetPointerType = () => { lastPointerType.current = undefined; };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      resetPointerType();
      // The plot's own handler decides for an Escape there. Setting it here could redraw the plot before that
      // handler runs; it would then see no tooltip and clear the selection too.
      const inPlot = event.target instanceof Node && svgRef.current?.contains(event.target);
      if (event.key === "Escape" && !inPlot) setIsDismissed(true);
    };
    document.addEventListener("pointerdown", handlePointer, true);
    document.addEventListener("keydown", handleKey, true);
    window.addEventListener("blur", resetPointerType);
    return () => {
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("blur", resetPointerType);
    };
  }, []);

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
  // Both groups are drawn highest slot first, so the lowest slot is on top of a stack of identical phrases.
  // Exact matches are drawn before the case points, so under their dots; the others after.
  const exactTestPoints = useMemo(() => testPoints.filter(point => point.isExactMatch).reverse(), [testPoints]);
  const besideTestPoints = useMemo(() => testPoints.filter(point => !point.isExactMatch).reverse(), [testPoints]);
  const keys = useMemo(
    () => [...points.map(point => caseKey(point.caseId)), ...testPoints.map(point => slotKey(point.slot))],
    [points, testPoints]);
  const activeExists = activeKey !== undefined && keys.includes(activeKey);

  // A removed point gets no pointerleave, and may not blur
  useEffect(() => {
    if (hoverKey !== undefined && !keys.includes(hoverKey)) setHoverKey(undefined);
    if (focused && !keys.includes(focused.key)) setFocused(undefined);
  }, [hoverKey, focused, keys]);

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

  // Keyboard or touch focus shows the tooltip; mouse and pen have hover
  const setFocusedPoint = (key: string) => {
    const pointerType = lastPointerType.current;
    setFocused({ key, showsTooltip: pointerType === undefined || pointerType === "touch" });
    setIsDismissed(false);
  };

  // Focusing the focused point fires no focus event, so this also sets the focus tooltip and ends the hover
  const moveTo = (key: string | undefined) => {
    if (key === undefined) return;
    setActiveKey(key);
    pointRefs.current.get(key)?.focus();
    setFocusedPoint(key);
    if (lastPointerType.current === undefined) setHoverKey(undefined);
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
        // A showing tooltip is hidden first; the selection is kept
        if (tooltip) setIsDismissed(true);
        else clearCodapSelection(store);
        break;
      default:
        return;
    }
    // Arrows and Space would scroll
    event.preventDefault();
  };

  // A mouse or pen click is on the point, even if keyboard focus ended its hover. Browsers don't reliably
  // focus a tapped point.
  const activatePoint = (key: string, extend: boolean) => {
    moveTo(key);
    const pointerType = lastPointerType.current;
    if (pointerType === "mouse" || pointerType === "pen") setHoverKey(key);
    select(key, extend);
  };

  // The point a press or click took from the pointer, not from the point elements
  const handlePlotClick = (event: MouseEvent<SVGSVGElement>) => {
    const pressedKey = pressed.current?.key;
    pressed.current = undefined;
    if (pressedKey !== undefined) {
      if (keys.includes(pressedKey)) activatePoint(pressedKey, event.shiftKey);
      return;
    }
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    // A Shift-click on empty space adds nothing
    if (!event.shiftKey) clearCodapSelection(store);
  };

  // Only from the background: a press on a point is a click on it. An empty plot has no view to move.
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.isPrimary === false) return;
    pressed.current = undefined;
    const hit = hitTest(event);
    if (hit !== undefined) {
      if (event.button === 0) {
        pressed.current = { key: hit, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          isReleased: false };
      }
      return;
    }
    // Not every browser blurs a point on a press here, which would leave a tapped point's tooltip
    const svg = svgRef.current;
    if (svg && document.activeElement !== svg && svg.contains(document.activeElement)) svg.focus();
    if (!store.hasGraph || event.button !== 0) return;
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
    // Moved off the point, as far as a drag: its click is then a background click, not a click on the point
    const press = pressed.current;
    if (press?.pointerId === event.pointerId && !press.isReleased &&
      Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >= kDragThresholdPx) {
      pressed.current = undefined;
    }
    const current = drag.current;
    if (!current) {
      updateHover(event);
      return;
    }
    if (event.pointerId !== current.pointerId) return;
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

  // No click follows a cancel or a lost capture. A touch loses its implicit capture after every release,
  // before the click, so only a capture lost before the release ends a press.
  const endDrag = (event: PointerEvent<SVGSVGElement>, isRelease: boolean) => {
    const press = pressed.current;
    if (press?.pointerId === event.pointerId) {
      if (isRelease) press.isReleased = true;
      else if (!(press.isReleased && event.type === "lostpointercapture")) pressed.current = undefined;
    }
    const current = drag.current;
    if (event.pointerId !== current?.pointerId) return;
    if (isRelease && current.isDragging) ignoreClick.current = true;
    drag.current = undefined;
    setIsDragging(false);
  };

  // Only a click no pointer made reaches a point element, such as a screen reader's. Stopped, so the plot's
  // click handler doesn't handle it again.
  const handlePointClick = (event: MouseEvent<SVGGElement>, key: string) => {
    event.stopPropagation();
    activatePoint(key, event.shiftKey);
  };

  // A finger has no hover; a tap focuses instead
  const isHoverPointer = (event: PointerEvent<Element>) => event.pointerType === "mouse" || event.pointerType === "pen";

  // A tooltip shown by hover can be hovered too
  const handleTooltipEnter = (event: PointerEvent<Element>, key: string) => {
    if (!isHoverPointer(event)) return;
    setHoverKey(key);
    setIsDismissed(false);
  };

  // Moving between the plot and the tooltip keeps the hover; back on the plot, the pointer's position decides
  const handlePointerLeave = (event: PointerEvent<Element>) => {
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (to?.closest(".point-tooltip")) return;
    if (to && svgRef.current?.contains(to)) updateHover(event);
    else setHoverKey(undefined);
  };

  const handlePointBlur = (key: string) => {
    setFocused(current => current?.key === key ? undefined : current);
  };

  const pointRef = (key: string) => (element: SVGGElement | null) => {
    if (element) pointRefs.current.set(key, element);
    else pointRefs.current.delete(key);
  };

  // In slot order: each symbol keeps clear of every dot and of the lower slots' symbols. Includes the
  // hidden slot being edited, so the others don't move into its place meanwhile. The bounds are the
  // whole layout's, so a symbol stays with an off-screen neighbor. An exact match goes on its dot, and a phrase
  // that a lower slot already has (normalized) goes on that slot's symbol.
  // A string, since MobX State Tree changes the array in place. A field holds one line, so no phrase has "\n".
  const committedPhrases = store.testPhrases.join("\n");
  const testPointPixels = useMemo(() => {
    const slotPhrases = committedPhrases.split("\n").map(normalizePhrase);
    const bounds = worldBounds(size, view);
    const casePixels = store.points.map(point => ({ caseId: point.caseId, ...viewPixels(point, view, size) }));
    const placed = new Map<number, IPosition>();
    const slotByPhrase = new Map<string, number>();
    const clampToBounds = ({ x, y }: IPosition) => ({ x: Math.min(bounds.right, Math.max(bounds.left, x)),
      y: Math.min(bounds.bottom, Math.max(bounds.top, y)) });
    store.testPhrasePoints.slice().sort((a, b) => a.slot - b.slot).forEach((point: TestPhrasePoint) => {
      const phrase = slotPhrases[point.slot] ?? "";
      const samePhraseSlot = slotByPhrase.get(phrase);
      const samePhrasePixel = samePhraseSlot !== undefined ? placed.get(samePhraseSlot) : undefined;
      if (samePhrasePixel) {
        placed.set(point.slot, samePhrasePixel);
        return;
      }
      slotByPhrase.set(phrase, point.slot);
      const pixels = viewPixels(point, view, size);
      const neighbor = casePixels.find(({ caseId }) => caseId === point.neighborCaseId);
      if (!neighbor) {
        placed.set(point.slot, clampToBounds(pixels));
        return;
      }
      if (point.isExactMatch) {
        placed.set(point.slot, clampToBounds(neighbor));
        return;
      }
      const others = [...casePixels.filter(({ caseId }) => caseId !== point.neighborCaseId), ...placed.values()];
      placed.set(point.slot,
        offsetFromNeighbor(neighbor, pixels, directionToPixels(point.direction, size), bounds, others));
    });
    return placed;
  }, [store.points, store.testPhrasePoints, committedPhrases, size, view]);

  // In draw order, so a tie goes to the point on top
  const hitCandidates = () => {
    const candidates: IHitCandidate[] = [];
    const addSymbols = (symbolPoints: TestPhrasePoint[]) => symbolPoints.forEach(point => {
      const center = testPointPixels.get(point.slot);
      if (!center) return;
      candidates.push({ key: slotKey(point.slot), center,
        halfExtent: kPlotSymbolExtents[store.symbolForSlot(point.slot)] / 2, isRound: false });
    });
    addSymbols(exactTestPoints);
    points.forEach(point => candidates.push({ key: caseKey(point.caseId), center: viewPixels(point, view, size),
      halfExtent: kOutlineRadius, isRound: true }));
    addSymbols(besideTestPoints);
    return candidates;
  };

  // The point whose center is nearest the pointer. The point elements take no pointer events, so the browser,
  // which picks the one drawn last, doesn't choose.
  const hitTest = ({ clientX, clientY }: { clientX: number, clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const { left, top } = svg.getBoundingClientRect();
    return nearestPoint({ x: clientX - left, y: clientY - top }, hitCandidates());
  };

  const updateHover = (event: PointerEvent<Element>) => {
    if (!isHoverPointer(event)) return;
    const hit = hitTest(event);
    if (hit !== undefined && hit !== hoverKey) setIsDismissed(false);
    setHoverKey(hit);
  };

  // The ring search can put a symbol 18px from its dot
  const drawnPixel = (key: string) => {
    const slot = slotFromKey(key);
    if (slot !== undefined) return testPointPixels.get(slot);
    const caseId = key.slice("case:".length);
    const casePoint = store.points.find(point => point.caseId === caseId);
    return casePoint && viewPixels(casePoint, view, size);
  };

  // Keyboard focus pans the point into view and ends a resting mouse's hover. Not a press: a pan would move
  // the dot from under the pointer before the click.
  const handlePointFocus = (key: string) => {
    setActiveKey(key);
    setFocusedPoint(key);
    if (lastPointerType.current !== undefined) return;
    setHoverKey(undefined);
    const pixel = drawnPixel(key);
    if (!pixel) return;
    const panned = panToInclude(view, pixel, size);
    if (panned !== view) store.panTo(panned.centerX, panned.centerY);
  };

  // Drawn again on top of everything: the focused point, then the hovered one above it
  const topCopies: { key: string, reason: "focus" | "hover", pixels: IPosition }[] = [];
  const addTopCopy = (key: string | undefined, reason: "focus" | "hover") => {
    const pixels = key !== undefined && keys.includes(key) ? drawnPixel(key) : undefined;
    if (key !== undefined && pixels) topCopies.push({ key, reason, pixels });
  };
  // The point with DOM focus, not `activeKey`, which outlives it: a symbol's copy would stay over its dot
  const focusCopyKey = focused !== undefined && keys.includes(focused.key) ? focused.key : undefined;
  addTopCopy(focusCopyKey, "focus");
  addTopCopy(hoverKey !== focusCopyKey ? hoverKey : undefined, "hover");
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
  // Hover wins
  const focusTooltipKey = focused?.showsTooltip ? focused.key : undefined;
  const tooltipKey = isDragging || isDismissed ? undefined : hoverKey ?? focusTooltipKey;
  const tooltip = (() => {
    const pixel = tooltipKey !== undefined && keys.includes(tooltipKey) ? drawnPixel(tooltipKey) : undefined;
    if (tooltipKey === undefined || !pixel) return undefined;
    const slot = slotFromKey(tooltipKey);
    if (slot !== undefined) {
      return { key: tooltipKey, text: store.testPhrases[slot], color: kTestPhraseColor, fill: kTestPhraseTooltipFill,
        pixel, halfExtent: kPlotSymbolExtents[store.symbolForSlot(slot)] / 2 };
    }
    const caseId = tooltipKey.slice("case:".length);
    return { key: tooltipKey, text: phrases.get(caseId) ?? "", color: store.colorForCase(caseId),
      fill: store.tooltipFillForCase(caseId), pixel, halfExtent: kPointRadius };
  })();
  const renderTestPoint = (point: TestPhrasePoint) => {
    const { x, y } = testPointPixels.get(point.slot) ?? { x: 0, y: 0 };
    const symbol = store.symbolForSlot(point.slot);
    const key = slotKey(point.slot);
    return (
      <g
        key={key}
        ref={pointRef(key)}
        className="point test-phrase-point"
        transform={`translate(${x} ${y})`}
        role="button"
        aria-label={`${symbolName(symbol)} test phrase: ${store.testPhrases[point.slot]}`}
        aria-pressed={store.isSlotSelected(point.slot)}
        tabIndex={key === activeKey ? 0 : -1}
        data-symbol={symbol}
        data-testid="test-phrase-point"
        onClick={event => handlePointClick(event, key)}
        onFocus={() => handlePointFocus(key)}
        onBlur={() => handlePointBlur(key)}
      >
        <SymbolMarks symbol={symbol} selected={store.isSlotSelected(point.slot)} />
      </g>
    );
  };
  const message = computeStatus === "too-few" ? kTooFewMessage : computeStatus === "error" ? kErrorMessage : "";
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
        data-over-point={hoverKey !== undefined || undefined}
        onKeyDown={handleKeyDown}
        onClick={handlePlotClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
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
          {grid.x.map((x, i) =>
            <line key={`x${i}`} data-testid="grid-line" x1={x} x2={x} y1={0} y2={size.height} />)}
          {grid.y.map((y, i) =>
            <line key={`y${i}`} data-testid="grid-line" x1={0} x2={size.width} y1={y} y2={y} />)}
        </g>
        {exactTestPoints.map(renderTestPoint)}
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
              onBlur={() => handlePointBlur(key)}
            >
              <PointMarks color={store.colorForCase(point.caseId)} selected={selected} />
            </g>
          );
        })}
        {besideTestPoints.map(renderTestPoint)}
        {/* The focused and hovered points drawn again on top. Moving the points themselves to the end would make
            React move a focused element, which drops its focus. */}
        {topCopies.map(({ key, reason, pixels }) => {
          const slot = slotFromKey(key);
          const symbol = slot !== undefined ? store.symbolForSlot(slot) : undefined;
          const caseId = key.slice("case:".length);
          return (
            <g key={reason} className="active-point" data-testid="active-point" data-reason={reason}
              data-symbol={symbol} aria-hidden="true" transform={`translate(${pixels.x} ${pixels.y})`}>
              {slot !== undefined && symbol
                ? <SymbolMarks symbol={symbol} selected={store.isSlotSelected(slot)} />
                : <PointMarks color={store.colorForCase(caseId)} selected={store.isSelected(caseId)} />}
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <PointTooltip text={tooltip.text} color={tooltip.color} fill={tooltip.fill} halfExtent={tooltip.halfExtent}
          anchor={{ x: tooltip.pixel.x + offset.left, y: tooltip.pixel.y + offset.top }} area={area}
          isHoverable={tooltip.key === hoverKey}
          onPointerEnter={event => handleTooltipEnter(event, tooltip.key)}
          onPointerLeave={handlePointerLeave} />
      )}
      <p className="visually-hidden" id={helpId}>{kKeyboardHelp}</p>
      <p className="graph-status" role="status" aria-live="polite">{message}</p>
    </div>
  );
});
