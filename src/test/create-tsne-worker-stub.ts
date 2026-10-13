// Jest can't compile import.meta in create-tsne-worker.ts, so tests get this module instead
export const createTsneWorker = (): Worker => {
  throw new Error("No t-SNE worker in Jest; mock createTsneWorker in the test");
};
