# Request Deduplication Link

## Problem Brief

Add client-side request deduplication to prevent duplicate in-flight requests. When multiple identical query requests are made simultaneously, only one network request should execute, with all callers receiving the same result. This prevents redundant server calls from user actions like double-clicks, rapid navigation, or concurrent component renders.

## Agent Instructions

Implement a publicly exported `deduplicationLink` for tRPC's client package. The link should:

1. **Deduplicate in-flight requests**: Identify identical requests using path and input, share the underlying observable among all subscribers, ensuring only one network call occurs.

2. **Support configuration options**:
   - `ttl`: Optional cache duration in milliseconds for keeping requests cached after completion
   - `maxSize`: Maximum number of concurrent cached requests (LRU eviction)
   - `shouldDeduplicateOperation`: Custom function to determine which operations to deduplicate (default: queries only)
   - `getKey`: Custom function to generate cache keys (default: JSON.stringify of path and input)

3. **Handle edge cases gracefully**:
   - Mutations should NOT be deduplicated by default (to avoid unintended side effects)
   - Individual request cancellation shouldn't cancel other deduplicated subscribers
   - Cache cleanup on completion and errors
   - Expired entries should be removed when TTL is configured

4. **Export the link**: Add to `packages/client/src/links.ts` so users can import it alongside other links like `httpLink` and `httpBatchLink`.

The implementation should use tRPC's observable system with the `share()` operator for multicasting, maintaining proper TypeScript types throughout.

## Test Assumptions

- Implementation must be at `packages/client/src/links/deduplicationLink.ts`
- Must export `deduplicationLink` function and `DeduplicationLinkOptions` interface
- Tests verify: basic deduplication, TTL behavior, maxSize limits, custom predicates, cancellation handling, and mutation exclusion
