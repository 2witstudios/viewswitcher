/**
 * Runs at most `n` of the functions given to it at once; the rest wait, first come first served. A
 * finished one hands its slot straight to the next waiter, so a caller arriving in between can't
 * take it as well and go over the bound. Never nest calls to one limit: an outer call holding a slot
 * while it waits for an inner one can deadlock.
 */
export function limit(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
