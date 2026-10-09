// Starts the t-SNE worker. Kept in its own file because Jest can't compile import.meta; tests mock
// this module instead.
//
// webpack sees `new Worker(new URL(...), import.meta.url)`, bundles the worker as its own file, and
// loads it from the folder the main script came from, so it also works from index-top.html. The
// name becomes the file name (assets/tsne-worker.[contenthash].js) and labels it in dev tools.
export const createTsneWorker = () =>
  new Worker(new URL("./tsne-worker.ts", import.meta.url), { name: "tsne-worker" });
