import { createRequestHandler, WorkerRequest, WorkerResponse } from "./compute-layout";

// The project's TypeScript setup has DOM types, not worker types.
interface IWorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (response: WorkerResponse) => void;
}

const scope = self as unknown as IWorkerScope;
const handleRequest = createRequestHandler();
scope.onmessage = event => handleRequest(event.data, response => scope.postMessage(response));
