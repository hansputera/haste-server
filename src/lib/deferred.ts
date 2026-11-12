// A deferred promise that works on every supported runtime.
//
// `Promise.withResolvers` is ES2024 and only exists from Node 22, while this
// package supports Node 20. This helper is the single place that spells out the
// executor form; call sites stay linear:
//
//   const { promise, resolve } = deferred<void>();
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
};
