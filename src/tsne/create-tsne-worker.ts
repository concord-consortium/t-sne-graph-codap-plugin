// Its own module: Jest can't compile import.meta, so tests mock it.
// webpack bundles the worker and loads it from the main script's folder, so index-top.html works.
export const createTsneWorker = () =>
  new Worker(new URL("./tsne-worker.ts", import.meta.url), { name: "tsne-worker" });
