// Web Worker entry: runs each request through computeLayout and posts the responses back.
import { computeLayout, ITsneRequest, TsneResponse } from "./compute-layout";

// The parts of the worker's global scope used here. The project's TypeScript setup has the DOM
// types, not the worker ones.
interface IWorkerScope {
  onmessage: ((event: MessageEvent<ITsneRequest>) => void) | null;
  postMessage: (response: TsneResponse) => void;
}

const scope = self as unknown as IWorkerScope;
scope.onmessage = event => computeLayout(event.data, response => scope.postMessage(response));
