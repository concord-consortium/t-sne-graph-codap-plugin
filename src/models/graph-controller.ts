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

/** Lays out the rows in a worker when the phrases or seed change, then places the test phrases
 * into the finished layout, and again when they change. Returns a stop function. */
export const startGraphController = (store: IPluginStore) => {
  let worker: Worker | undefined;
  let busy = false;
  // Replies to older requests are ignored
  let currentRequest = 0;
  let currentPlacement = 0;
  // The finished layout the worker holds; caseIds are in its phrase order
  let doneLayout: { requestId: number, caseIds: string[] } | undefined;

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
      store.setComputeStatus("idle");
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
        store.setComputeStatus("error");
        return;
      }
      newWorker.onerror = event => {
        // E.g. the script failed to load. A new worker is made next time.
        console.error("The t-SNE worker failed:", event.message);
        if (newWorker === worker) {
          stopWorker();
          store.setComputeStatus("error");
        }
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
          store.setComputeStatus("too-few");
          break;
        case "error":
          busy = false;
          console.error("Unable to lay out the phrases:", response.message);
          store.setComputeStatus("error");
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

  // An unchanged commit leaves the phrases equal, so it sends nothing
  const stopPlacementReaction = reaction(() => store.testPhrases.slice(), place, { equals: compareStructural });

  return () => {
    stopReaction();
    stopPlacementReaction();
    stopWorker();
  };
};
