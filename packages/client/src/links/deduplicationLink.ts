import type { Observable } from '@trpc/server/observable';
import { observable, share } from '@trpc/server/observable';
import type { AnyRouter } from '@trpc/server/unstable-core-do-not-import';
import type { Operation, TRPCLink } from './types';

export interface DeduplicationLinkOptions {
  /**
   * Time-to-live for cached requests in milliseconds.
   * After this time, a new request with the same key will not be deduplicated.
   * @default undefined (no TTL, only deduplicates in-flight requests)
   */
  ttl?: number;

  /**
   * Maximum number of in-flight requests to cache.
   * When exceeded, the oldest entry is evicted (LRU).
   * @default Infinity
   */
  maxSize?: number;

  /**
   * Custom function to determine if an operation should be deduplicated.
   * @default Only queries are deduplicated
   */
  shouldDeduplicateOperation?: (op: Operation) => boolean;

  /**
   * Custom function to generate cache key for an operation.
   * @default Uses JSON.stringify([op.path, op.input])
   */
  getKey?: (op: Operation) => string;
}

interface CacheEntry {
  observable: Observable<any, any>;
  timestamp: number;
  completed?: boolean;
  result?: any;
}

/**
 * Link that deduplicates identical in-flight requests.
 * By default, only queries are deduplicated to prevent issues with mutations.
 *
 * @example
 * ```ts
 * import { createTRPCClient, deduplicationLink, httpBatchLink } from '@trpc/client';
 *
 * const client = createTRPCClient({
 *   links: [
 *     deduplicationLink(),
 *     httpBatchLink({ url: 'http://localhost:3000' }),
 *   ],
 * });
 * ```
 *
 * @example With options
 * ```ts
 * deduplicationLink({
 *   ttl: 5000, // Cache for 5 seconds
 *   maxSize: 100, // Keep max 100 in-flight requests
 * })
 * ```
 *
 * @see https://trpc.io/docs/client/links/deduplicationLink
 */
export function deduplicationLink<
  TRouter extends AnyRouter = AnyRouter,
>(opts?: DeduplicationLinkOptions): TRPCLink<TRouter> {
  const {
    ttl,
    maxSize = Infinity,
    shouldDeduplicateOperation = (op) => op.type === 'query',
    getKey = (op) => JSON.stringify([op.path, op.input]),
  } = opts ?? {};

  return () => {
    const cache = new Map<string, CacheEntry>();
    const keyOrder: string[] = [];

    function evictOldest() {
      if (keyOrder.length > 0) {
        const oldestKey = keyOrder.shift();
        if (oldestKey) {
          cache.delete(oldestKey);
        }
      }
    }

    function cleanupKey(key: string) {
      cache.delete(key);
      const index = keyOrder.indexOf(key);
      if (index !== -1) {
        keyOrder.splice(index, 1);
      }
    }

    function isExpired(entry: CacheEntry): boolean {
      if (!ttl) return false;
      return Date.now() - entry.timestamp > ttl;
    }

    return ({ op, next }) => {
      // Check if this operation should be deduplicated
      if (!shouldDeduplicateOperation(op)) {
        return next(op);
      }

      const key = getKey(op);
      const cachedEntry = cache.get(key);

      // Check if we have a cached entry and it's not expired
      if (cachedEntry && !isExpired(cachedEntry)) {
        // If the request has completed and we have a result, return it immediately
        if (cachedEntry.completed && cachedEntry.result !== undefined) {
          return observable((observer) => {
            // Synchronously emit the cached result
            setTimeout(() => {
              observer.next(cachedEntry.result);
              observer.complete();
            }, 0);
            return () => {};
          });
        }
        // Otherwise return the in-flight observable
        return cachedEntry.observable;
      }

      // If expired, clean it up
      if (cachedEntry && isExpired(cachedEntry)) {
        cleanupKey(key);
      }

      // Create a shared observable with cleanup
      const source$ = next(op);
      
      // Store the cache entry first
      const cacheEntry: CacheEntry = {
        observable: null as any, // Will be set below
        timestamp: Date.now(),
      };
      
      // Enforce max size before adding new entry
      // Only evict if we're at capacity AND adding a new key
      if (!cache.has(key) && cache.size >= maxSize) {
        evictOldest();
      }
      
      cache.set(key, cacheEntry);
      // Only add to keyOrder if it's a new key
      if (!keyOrder.includes(key)) {
        keyOrder.push(key);
      }

      let cachedResult: any = undefined;
      let hasCompleted = false;

      const shared$ = source$.pipe(share());
      
      // Wrap to add cleanup logic
      const wrapped$ = observable((observer) => {
        const subscription = shared$.subscribe({
          next(value) {
            // Cache the result if TTL is enabled
            if (ttl && !hasCompleted) {
              cachedResult = value;
              // Update the cache entry with the result
              cacheEntry.result = value;
            }
            observer.next(value);
          },
          error(err) {
            // Clean up cache on error
            cleanupKey(key);
            observer.error(err);
          },
          complete() {
            if (!hasCompleted) {
              hasCompleted = true;
              // If TTL is set, mark as completed
              if (ttl) {
                cacheEntry.completed = true;
                cacheEntry.result = cachedResult;
              } else {
                // No TTL, clean up immediately
                cleanupKey(key);
              }
            }
            observer.complete();
          },
        });

        return () => {
          subscription.unsubscribe();
        };
      });
      
      cacheEntry.observable = wrapped$;
      
      return wrapped$;
    };
  };
}
