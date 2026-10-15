import { compareStructural, reaction } from "mobx";
import {
  IPlacedResponse, IPlaceRequest, ITsneRequest, kProgressInterval, WorkerResponse
} from "../tsne/compute-layout";
import { createTsneWorker } from "../tsne/create-tsne-worker";
import { IPluginStore, PlacementStatus, Row, TestPhrasePoint } from "./plugin-store";

// Code-unit order: the same in every browser, unlike localeCompare
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// t-SNE gives each row its starting position by list index, so a fixed order keeps a sorted or
// regrouped table from changing the picture.
const layoutOrder = (rows: readonly Row[]) =>
  rows.slice().sort((a, b) => compareText(a.phrase, b.phrase) || compareText(a.caseId, b.caseId));

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Lays out the rows in a worker when the phrases or seed change, and places the test phrases in
 * the result. Returns a stop function. */
export const startGraphController = (store: IPluginStore) => {
  let worker: Worker | undefined;
  let busy = false;
  // Replies to older requests are ignored
  let currentRequest = 0;
  let currentPlacement = 0;
  // The worker's finished layout; caseIds in its phrase order
  let doneLayout: { requestId: number, caseIds: string[] } | undefined;

  // No plot is left: clear any points, including a progress layout an error interrupted. No
  // placement reply will drop a stale slot selection, so drop it here, only if non-empty (see
  // refreshSelection in selection-sync.ts).
  const endWithoutPlacement = (status: "idle" | "too-few" | "error") => {
    store.setPoints([]);
    store.setTestPhrasePoints([], {});
    store.setComputeStatus(status);
    if (store.selectedSlots.size > 0) store.setSelectedSlots([]);
  };

  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
    busy = false;
    // The worker's layout goes with it
    doneLayout = undefined;
  };

  const place = () => {
    if (!worker || !doneLayout) return;
    const request: IPlaceRequest = {
      type: "place",
      placementId: ++currentPlacement,
      layoutRequestId: doneLayout.requestId,
      phrases: store.testPhrases.map(phrase => phrase === "" ? null : phrase)
    };
    worker.postMessage(request);
  };

  const applyPlacement = (response: IPlacedResponse) => {
    if (response.placementId !== currentPlacement || response.layoutRequestId !== doneLayout?.requestId) return;
    const { caseIds } = doneLayout;
    const points: TestPhrasePoint[] = [];
    const status: Record<number, PlacementStatus> = {};
    response.slots.forEach((placement, slot) => {
      // "no-layout" gets no status: still waiting
      if (placement === "no-layout") return;
      if (placement === "empty" || placement === "no-words") {
        status[slot] = placement;
        return;
      }
      const { x, y, neighborIndex, direction } = placement;
      points.push({ slot, x, y, neighborCaseId: caseIds[neighborIndex], direction });
      status[slot] = "placed";
    });
    store.setTestPhrasePoints(points, status);
    // Unselect slots left without a point, or they'd come back selected later
    const placedSlots = new Set(points.map(point => point.slot));
    const stillSelected = Array.from(store.selectedSlots).filter(slot => placedSlots.has(slot));
    if (stillSelected.length < store.selectedSlots.size) store.setSelectedSlots(stillSelected);
  };

  const compute = () => {
    const requestId = ++currentRequest;
    // Never show an old layout against new phrases
    store.setPoints([]);
    store.setTestPhrasePoints([], {});
    doneLayout = undefined;
    // Terminating is the only way to cancel
    if (busy) stopWorker();

    const rows = layoutOrder(store.rows);
    if (rows.length === 0) {
      endWithoutPlacement("idle");
      return;
    }
    const seed = store.tsneSeed;
    if (seed === undefined) {
      // Creating the seed reruns this reaction
      store.ensureTsneSeed();
      return;
    }

    const caseIds = rows.map(row => row.caseId);
    const toPoints = (positions: { x: number, y: number }[]) =>
      positions.map((position, i) => ({ caseId: caseIds[i], ...position }));

    if (!worker) {
      let newWorker: Worker;
      try {
        newWorker = createTsneWorker();
      } catch (error) {
        // E.g. a policy that blocks workers. The next change retries.
        console.error("Unable to start the t-SNE worker:", error instanceof Error ? error.message : String(error));
        endWithoutPlacement("error");
        return;
      }
      newWorker.onerror = event => {
        // E.g. the script failed to load. A new worker is made next time.
        console.error("The t-SNE worker failed:", event.message);
        if (newWorker !== worker) return;
        stopWorker();
        endWithoutPlacement("error");
      };
      worker = newWorker;
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "placed") {
        applyPlacement(response);
        return;
      }
      if (response.requestId !== currentRequest) return;
      switch (response.type) {
        case "progress":
          store.setPoints(toPoints(response.positions));
          break;
        case "done":
          busy = false;
          store.setPoints(toPoints(response.positions));
          store.setComputeStatus("done");
          doneLayout = { requestId, caseIds };
          place();
          break;
        case "too-few":
          busy = false;
          endWithoutPlacement("too-few");
          break;
        case "error":
          busy = false;
          console.error("Unable to lay out the phrases:", response.message);
          endWithoutPlacement("error");
          break;
      }
    };

    busy = true;
    store.setComputeStatus("computing");
    const request: ITsneRequest = {
      requestId,
      phrases: rows.map(row => row.phrase),
      seed,
      progressInterval: prefersReducedMotion() ? 0 : kProgressInterval
    };
    worker.postMessage(request);
  };

  // Compared by value, so a label change starts no new layout
  const stopReaction = reaction(
    () => ({ phrases: layoutOrder(store.rows).map(row => [row.caseId, row.phrase]), seed: store.tsneSeed }),
    compute,
    { equals: compareStructural, fireImmediately: true }
  );

  // By value: an unchanged commit sends nothing
  const stopPlacementReaction = reaction(() => store.testPhrases.slice(), place, { equals: compareStructural });

  return () => {
    stopReaction();
    stopPlacementReaction();
    stopWorker();
  };
};
