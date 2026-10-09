/*
 * Exact t-SNE, ported to TypeScript from tsnejs by Andrej Karpathy:
 * https://github.com/karpathy/tsnejs/blob/13ece5d7e751a5180a59ca396013e800e1059c20/tsne.js
 * tsnejs is under the MIT License, as its Readme states:
 *
 *   Copyright (c) Andrej Karpathy
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *   and associated documentation files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 *   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Changes from the original: an injected random generator; exp and log from portable-math.ts; Q
 * matrices allocated once; initDataDist and debugGrad left out. Same arithmetic in the same order.
 */
import { exp, log } from "./portable-math";
import { gaussian, RandomFn } from "./random";

// The original scikit-learn page's settings
export const kTsneSettings = { perplexity: 40, epsilon: 100, steps: 1000 };

/** At most (n - 1) / 3; 0 below 4 points. */
export const clampPerplexity = (perplexity: number, n: number) => Math.min(perplexity, Math.floor((n - 1) / 3));

export interface ITsneOptions {
  // Effective number of nearest neighbors
  perplexity: number;
  // Learning rate
  epsilon: number;
  dim?: number;
  random: RandomFn;
}

// Squared distances, n × n
const pairwiseDistances = (X: number[][]) => {
  const n = X.length;
  const distances = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < X[i].length; k++) {
        const difference = X[i][k] - X[j][k];
        d += difference * difference;
      }
      distances[i * n + j] = d;
      distances[j * n + i] = d;
    }
  }
  return distances;
};

// Binary-searches each point's Gaussian precision for the target perplexity, then returns the
// symmetric joint probabilities (p_{i|j} + p_{j|i}) / 2n.
const distancesToP = (D: Float64Array, n: number, perplexity: number, tolerance: number) => {
  const targetEntropy = log(perplexity);
  const P = new Float64Array(n * n);
  const row = new Float64Array(n);
  const kMaxTries = 50;
  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;
    for (let tries = 1; ; tries++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        const p = i === j ? 0 : exp(-D[i * n + j] * beta);
        row[j] = p;
        sum += p;
      }
      let entropy = 0;
      for (let j = 0; j < n; j++) {
        const p = sum === 0 ? 0 : row[j] / sum;
        row[j] = p;
        if (p > 1e-7) entropy -= p * log(p);
      }
      if (entropy > targetEntropy) {
        // Too spread out
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        // Too peaked
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
      if (Math.abs(entropy - targetEntropy) < tolerance || tries >= kMaxTries) break;
    }
    P.set(row, i * n);
  }

  const result = new Float64Array(n * n);
  const n2 = n * 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i * n + j] = Math.max((P[i * n + j] + P[j * n + i]) / n2, 1e-100);
    }
  }
  return result;
};

const sign = (x: number) => x > 0 ? 1 : x < 0 ? -1 : 0;

const fill2d = (n: number, dim: number, value: () => number) =>
  Array.from({ length: n }, () => Array.from({ length: dim }, value));

export class Tsne {
  private readonly perplexity: number;
  private readonly epsilon: number;
  private readonly dim: number;
  private readonly randn: RandomFn;
  private n = 0;
  private iter = 0;
  private P = new Float64Array(0);
  private Qu = new Float64Array(0);
  private Q = new Float64Array(0);
  private Y: number[][] = [];
  private gains: number[][] = [];
  private ystep: number[][] = [];

  constructor({ perplexity, epsilon, dim = 2, random }: ITsneOptions) {
    this.perplexity = perplexity;
    this.epsilon = epsilon;
    this.dim = dim;
    this.randn = gaussian(random);
  }

  /** One row per point, all the same length. Starts a new random layout. */
  initData(X: number[][]) {
    if (X.length === 0) throw new Error("t-SNE needs at least one point");
    if (X[0].length === 0) throw new Error("t-SNE needs at least one value per point");
    this.n = X.length;
    this.P = distancesToP(pairwiseDistances(X), this.n, this.perplexity, 1e-4);
    this.Qu = new Float64Array(this.n * this.n);
    this.Q = new Float64Array(this.n * this.n);
    this.Y = fill2d(this.n, this.dim, () => this.randn() * 1e-4);
    this.gains = fill2d(this.n, this.dim, () => 1);
    this.ystep = fill2d(this.n, this.dim, () => 0);
    this.iter = 0;
  }

  // Mutated by each step
  get solution(): readonly (readonly number[])[] {
    return this.Y;
  }

  get iteration() {
    return this.iter;
  }

  /** One gradient-descent step. Returns the cost before it. */
  step() {
    this.iter += 1;
    const { n, dim, Y } = this;
    const { cost, grad } = this.costGrad();

    const mean = new Array<number>(dim).fill(0);
    const momentum = this.iter < 250 ? 0.5 : 0.8;
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dim; d++) {
        const g = grad[i][d];
        const previousStep = this.ystep[i][d];
        // Shrink the gain when the step reverses direction (gradient and last step share a sign)
        const gain = Math.max(
          sign(g) === sign(previousStep) ? this.gains[i][d] * 0.8 : this.gains[i][d] + 0.2, 0.01);
        this.gains[i][d] = gain;
        const newStep = momentum * previousStep - this.epsilon * gain * g;
        this.ystep[i][d] = newStep;
        Y[i][d] += newStep;
        mean[d] += Y[i][d];
      }
    }
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dim; d++) {
        Y[i][d] -= mean[d] / n;
      }
    }
    return cost;
  }

  private costGrad() {
    const { n, dim, P, Qu, Q, Y } = this;
    // Early exaggeration avoids poor local minima
    const pMultiplier = this.iter < 100 ? 4 : 1;

    // Student-t similarities, normalized to sum to 1
    let qSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dSum = 0;
        for (let d = 0; d < dim; d++) {
          const difference = Y[i][d] - Y[j][d];
          dSum += difference * difference;
        }
        const qu = 1 / (1 + dSum);
        Qu[i * n + j] = qu;
        Qu[j * n + i] = qu;
        qSum += 2 * qu;
      }
    }
    for (let q = 0; q < n * n; q++) {
      Q[q] = Math.max(Qu[q] / qSum, 1e-100);
    }

    let cost = 0;
    const grad: number[][] = [];
    for (let i = 0; i < n; i++) {
      const gSum = new Array<number>(dim).fill(0);
      for (let j = 0; j < n; j++) {
        // Only the part of the KL divergence that depends on the layout
        cost += -P[i * n + j] * log(Q[i * n + j]);
        const premultiplier = 4 * (pMultiplier * P[i * n + j] - Q[i * n + j]) * Qu[i * n + j];
        for (let d = 0; d < dim; d++) {
          gSum[d] += premultiplier * (Y[i][d] - Y[j][d]);
        }
      }
      grad.push(gSum);
    }
    return { cost, grad };
  }
}
