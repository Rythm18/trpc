import { createMiddlewareFactory } from './middleware';
import type { MiddlewareResult } from './middleware';

type PendingRequest = {
  promise: Promise<MiddlewareResult<any>>;
};

/**
 * Creates a key for deduplication based on procedure path and input
 */
function createDeduplicationKey(path: string, input: unknown): string {
  // Use JSON.stringify for input to create a stable key
  // Sort keys for objects to ensure {a:1, b:2} matches {b:2, a:1}
  const inputKey =
    input === undefined ? 'undefined' : JSON.stringify(input, sortKeys);
  return `${path}:${inputKey}`;
}

/**
 * Helper to sort object keys for stable JSON stringification
 */
function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result: Record<string, unknown>, key) => {
        result[key] = (value as Record<string, unknown>)[key];
        return result;
      }, {});
  }
  return value;
}

/**
 * Experimental request deduplication middleware
 * Deduplicates concurrent requests with identical path and input
 *
 * @example
 * ```ts
 * const deduplicatedProcedure = t.procedure
 *   .use(experimental_requestDeduplication())
 *   .query(async ({ input }) => {
 *     // This will only execute once for concurrent identical requests
 *     return await expensiveDatabaseQuery(input);
 *   });
 * ```
 *
 * @see https://trpc.io/docs/v11/server/middlewares
 */
export function experimental_requestDeduplication<
  TContext extends { ctx?: object; meta?: object; input?: unknown } = {
    ctx: object;
    meta: object;
    input: unknown;
  },
>() {
  // Shared map for tracking in-flight requests
  const pendingRequests = new Map<string, PendingRequest>();

  const middleware = createMiddlewareFactory<
    TContext extends { ctx: infer T extends object } ? T : any,
    TContext extends { meta: infer T extends object } ? T : object,
    TContext extends { input: infer T } ? T : unknown
  >();

  return middleware(async (opts) => {
    const { path, getRawInput } = opts;
    // Get the raw input to create the deduplication key
    const rawInput = await getRawInput();
    const key = createDeduplicationKey(path, rawInput);

    // Check if there's already a pending request for this key
    const existing = pendingRequests.get(key);
    if (existing) {
      // Reuse the existing promise
      return await existing.promise;
    }

    // Create a new request and store it
    const promise = opts.next();

    // Store the pending request
    pendingRequests.set(key, { promise });

    try {
      // Wait for the result
      const result = await promise;

      // Clean up after completion
      pendingRequests.delete(key);

      return result;
    } catch (error) {
      // Clean up on error
      pendingRequests.delete(key);

      // Re-throw the error
      throw error;
    }
  });
}
