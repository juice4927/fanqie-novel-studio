export interface AsyncQueue<T> {
  push(value: T): void;
  fail(error: unknown): void;
  close(): void;
  iterate(): AsyncIterable<T>;
}

/** 把回调式流式解析器桥接成 async iterable，供驱动统一消费。 */
export function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
  let closed = false;
  let failure: unknown;

  const flush = () => {
    while (waiters.length) {
      const waiter = waiters[0];
      if (values.length) {
        waiters.shift();
        waiter.resolve({ value: values.shift() as T, done: false });
        continue;
      }
      if (failure !== undefined) {
        waiters.shift();
        waiter.reject(failure);
        continue;
      }
      if (closed) {
        waiters.shift();
        waiter.resolve({ value: undefined as never, done: true });
        continue;
      }
      break;
    }
  };

  return {
    push(value) {
      if (closed) return;
      values.push(value);
      flush();
    },
    fail(error) {
      if (closed) return;
      failure = error;
      closed = true;
      flush();
    },
    close() {
      if (closed) return;
      closed = true;
      flush();
    },
    iterate() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<T>>((resolve, reject) => {
                waiters.push({ resolve, reject });
                flush();
              }),
          };
        },
      };
    },
  };
}
