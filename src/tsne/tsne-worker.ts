import { computeLayout, ITsneRequest, TsneResponse } from "./compute-layout";

// The project's TypeScript setup has DOM types, not worker types.
interface IWorkerScope {
  onmessage: ((event: MessageEvent<ITsneRequest>) => void) | null;
  postMessage: (response: TsneResponse) => void;
}

const scope = self as unknown as IWorkerScope;
scope.onmessage = event => computeLayout(event.data, response => scope.postMessage(response));
