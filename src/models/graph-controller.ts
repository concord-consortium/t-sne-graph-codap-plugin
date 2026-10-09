import { compareStructural, reaction } from "mobx";
import { ITsneRequest, kProgressInterval, TsneResponse } from "../tsne/compute-layout";
import { createTsneWorker } from "../tsne/create-tsne-worker";
import { IPluginStore, Row } from "./plugin-store";

// Compares strings by UTF-16 code unit, which is the same in every browser and language setting
// (unlike localeCompare)
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// The rows in a fixed order, by phrase and then case ID. t-SNE gives each row its starting position
// by its place in the list, so laying out the table's order would give a new picture whenever the
// table is only sorted or regrouped.
const layoutOrder = (rows: readonly Row[]) =>
  rows.slice().sort((a, b) => compareText(a.phrase, b.phrase) || compareText(a.caseId, b.caseId));

// True when the user asks for less motion: then only the final layout is shown
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Lays out the store's rows whenever the phrases or the seed change, in a Web Worker, and writes
 * the points and status to the store (CODAP-1571 plan §4.2 steps 3–7). A label change only
 * recolors, so it starts no new layout. Returns a function that stops it.
 */
export const startGraphController = (store: IPluginStore) => {
  let worker: Worker | undefined;
  // True while the worker is working on a request
  let busy = false;
  // Each request takes a new number; replies to an older request are ignored
  let currentRequest = 0;

  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
    busy = false;
  };

  const compute = () => {
    const requestId = ++currentRequest;
    // Never show the old layout against new phrases
    store.setPoints([]);
    // A busy worker is still on an old request; stopping it is the only way to cancel
    if (busy) stopWorker();

    const rows = layoutOrder(store.rows);
    if (rows.length === 0) {
      store.setComputeStatus("idle");
      return;
    }
    const seed = store.tsneSeed;
    if (seed === undefined) {
      // A document saved before it had a seed. Creating one runs this again, with the seed.
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
        // For example, a security policy that blocks workers. The next change tries again.
        console.error("Unable to start the t-SNE worker:", error instanceof Error ? error.message : String(error));
        store.setComputeStatus("error");
        return;
      }
      newWorker.onerror = event => {
        // The worker failed, for example its script didn't load. A new one is made next time.
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

  // The phrases with their case IDs, in layout order, and the seed. Compared by value, so rows with
  // the same phrases don't start a new layout: not after a Label Column change, and not when the
  // table is only sorted or regrouped.
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
