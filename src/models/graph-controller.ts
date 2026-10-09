import { compareStructural, reaction } from "mobx";
import { ITsneRequest, kProgressInterval, TsneResponse } from "../tsne/compute-layout";
import { createTsneWorker } from "../tsne/create-tsne-worker";
import { IPluginStore, Row } from "./plugin-store";

// Code-unit order: the same in every browser, unlike localeCompare
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// t-SNE gives each row its starting position by list index, so a fixed order keeps a sorted or
// regrouped table from changing the picture.
const layoutOrder = (rows: readonly Row[]) =>
  rows.slice().sort((a, b) => compareText(a.phrase, b.phrase) || compareText(a.caseId, b.caseId));

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Lays out the rows in a worker when the phrases or seed change. Returns a stop function. */
export const startGraphController = (store: IPluginStore) => {
  let worker: Worker | undefined;
  let busy = false;
  // Replies to older requests are ignored
  let currentRequest = 0;

  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
    busy = false;
  };

  const compute = () => {
    const requestId = ++currentRequest;
    // Never show an old layout against new phrases
    store.setPoints([]);
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
    worker.onmessage = (event: MessageEvent<TsneResponse>) => {
      const response = event.data;
      if (response.requestId !== currentRequest) return;
      switch (response.type) {
        case "progress":
          store.setPoints(toPoints(response.positions));
          break;
        case "done":
          busy = false;
          store.setPoints(toPoints(response.positions));
          store.setComputeStatus("done");
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

  // Compared by value, so a label change or a reorder starts no new layout
  const stopReaction = reaction(
    () => ({ phrases: layoutOrder(store.rows).map(row => [row.caseId, row.phrase]), seed: store.tsneSeed }),
    compute,
    { equals: compareStructural, fireImmediately: true }
  );

  return () => {
    stopReaction();
    stopWorker();
  };
};
