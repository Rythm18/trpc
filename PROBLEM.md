# Server-Side Request Deduplication

## Problem Brief

When multiple concurrent requests arrive for the same procedure with identical inputs, tRPC currently executes the resolver function separately for each request. This creates unnecessary load on databases, external APIs, and compute resources. We need server-side request deduplication that executes the resolver once and shares the result with all concurrent callers.

## Agent Instructions

Implement a middleware that deduplicates concurrent server-side procedure calls. When multiple requests arrive simultaneously for the same procedure path and input, only the first request should trigger resolver execution. Subsequent concurrent requests should wait for and receive the same result.

The deduplication logic should:
- Generate a unique key from procedure path and input
- Track in-flight requests and reuse pending promises
- Clean up completed/failed requests from the tracking map
- Work transparently with existing middleware and error handling
- Handle both successful results and errors correctly (errors should be shared too)

This should be implemented as a reusable middleware that can be applied to any procedure or router. The feature must work with queries, mutations, and support proper AbortSignal handling.

## Test Assumptions

- Must be importable from `@trpc/server`
- Should support standard JSON-serializable inputs for key generation
- Concurrent requests are those that arrive before the first request completes
- Non-concurrent (sequential) requests should not share cached results
