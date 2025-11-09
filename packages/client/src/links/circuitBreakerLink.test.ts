import { observable } from '@trpc/server/observable';
import type { AnyRouter } from '@trpc/server/unstable-core-do-not-import';
import type { OperationLink } from '../..';
import { TRPCClientError } from '../TRPCClientError';
import { circuitBreakerLink } from './circuitBreakerLink';
import { createChain } from './internals/createChain';

describe('circuitBreakerLink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('allows requests when circuit is closed', async () => {
    const endingLinkTriggered = vi.fn();
    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink()(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          observer.next({
            result: {
              type: 'data',
              data: { input: op.input },
            },
          });
          observer.complete();
        });
      },
    ];

    const result = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 1,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ next: result });

    await vi.waitFor(() => {
      expect(endingLinkTriggered).toHaveBeenCalledTimes(1);
      expect(result).toHaveBeenCalledTimes(1);
    });
  });

  test('opens circuit after failure threshold', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();
    let failureCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 3,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          failureCount++;
          if (failureCount <= 3) {
            observer.error(
              new TRPCClientError('Server error', {
                cause: new Error('Server unavailable'),
              }),
            );
          } else {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          }
        });
      },
    ];

    // First 3 failures should go through
    for (let i = 0; i < 3; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    expect(endingLinkTriggered).toHaveBeenCalledTimes(3);
    expect(stateChanges).toEqual(['open']);

    // 4th request should be rejected immediately
    const error = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 4,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ error });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
      const errorMsg = error.mock.calls[0][0].message.toLowerCase();
      expect(errorMsg).toContain('circuit');
      expect(errorMsg).toContain('open');
    });
    expect(endingLinkTriggered).toHaveBeenCalledTimes(3);
  });

  test('transitions to half-open after timeout', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();
    let requestCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 2,
        openToHalfOpenTimeoutMs: 5000,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          requestCount++;
          if (requestCount <= 2) {
            observer.error(new TRPCClientError('Server error'));
          } else {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          }
        });
      },
    ];

    // Trigger 2 failures to open circuit
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    expect(stateChanges).toEqual(['open']);

    // Advance time to trigger half-open
    vi.advanceTimersByTime(5000);

    // Next request should be allowed
    const success = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 3,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ next: success });

    await vi.waitFor(() => {
      expect(success).toHaveBeenCalled();
    });

    expect(stateChanges).toEqual(['open', 'half-open']);
    expect(endingLinkTriggered).toHaveBeenCalledTimes(3);
  });

  test('closes circuit after successful requests in half-open state', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();
    let requestCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 2,
        openToHalfOpenTimeoutMs: 5000,
        halfOpenSuccessThreshold: 2,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          requestCount++;
          if (requestCount <= 2) {
            observer.error(new TRPCClientError('Server error'));
          } else {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          }
        });
      },
    ];

    // Open the circuit with 2 failures
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    // Advance time to half-open
    vi.advanceTimersByTime(5000);

    // Make 2 successful requests to close circuit
    for (let i = 0; i < 2; i++) {
      const success = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i + 2,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ next: success });

      await vi.waitFor(() => {
        expect(success).toHaveBeenCalled();
      });
    }

    expect(stateChanges).toEqual(['open', 'half-open', 'closed']);
    expect(endingLinkTriggered).toHaveBeenCalledTimes(4);
  });

  test('reopens circuit on failure in half-open state', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();
    let requestCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 2,
        openToHalfOpenTimeoutMs: 5000,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          requestCount++;
          // Fail on requests 1, 2, and 4; succeed on request 3
          if (requestCount === 3) {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          } else {
            observer.error(new TRPCClientError('Server error'));
          }
        });
      },
    ];

    // Open the circuit with 2 failures
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    // Advance time to half-open
    vi.advanceTimersByTime(5000);

    // First request in half-open succeeds
    const success = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 2,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ next: success });

    await vi.waitFor(() => {
      expect(success).toHaveBeenCalled();
    });

    expect(stateChanges).toEqual(['open', 'half-open']);

    // Second request fails, should reopen
    const error = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 3,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ error });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });

    expect(stateChanges).toEqual(['open', 'half-open', 'open']);
    expect(endingLinkTriggered).toHaveBeenCalledTimes(4);
  });

  test('resets failure count on success in closed state', async () => {
    const endingLinkTriggered = vi.fn();
    let requestCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 3,
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          requestCount++;
          // Fail on requests 1 and 2, succeed on 3, fail on 4 and 5
          if (requestCount === 1 || requestCount === 2 || requestCount === 4 || requestCount === 5) {
            observer.error(new TRPCClientError('Server error'));
          } else {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          }
        });
      },
    ];

    // First 2 failures
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    // Success - should reset counter
    const success = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 2,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ next: success });

    await vi.waitFor(() => {
      expect(success).toHaveBeenCalled();
    });

    // Next 2 failures should not open circuit (counter was reset)
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i + 3,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    // All 5 requests should have reached the ending link
    expect(endingLinkTriggered).toHaveBeenCalledTimes(5);
  });

  test('allows requests through in half-open state', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();
    let requestCount = 0;

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 2,
        openToHalfOpenTimeoutMs: 5000,
        halfOpenSuccessThreshold: 3,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      ({ op }) => {
        return observable((observer) => {
          endingLinkTriggered();
          requestCount++;
          // First 2 fail, then all succeed
          if (requestCount <= 2) {
            observer.error(new TRPCClientError('Server error'));
          } else {
            observer.next({
              result: {
                type: 'data',
                data: { input: op.input },
              },
            });
            observer.complete();
          }
        });
      },
    ];

    // Open circuit with 2 failures
    for (let i = 0; i < 2; i++) {
      const error = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ error });

      await vi.waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
    }

    expect(stateChanges).toEqual(['open']);

    // Circuit should reject while open
    const rejectedError = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 2,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ error: rejectedError });

    await vi.waitFor(() => {
      expect(rejectedError).toHaveBeenCalled();
      const errorMsg = rejectedError.mock.calls[0][0].message.toLowerCase();
      expect(errorMsg).toContain('circuit');
      expect(errorMsg).toContain('open');
    });

    // Advance time to half-open
    vi.advanceTimersByTime(5000);

    // In half-open, requests should be allowed through (not rejected)
    // Make 3 successful requests to close the circuit
    for (let i = 0; i < 3; i++) {
      const success = vi.fn();
      createChain<AnyRouter, unknown, unknown>({
        links,
        op: {
          type: 'query',
          id: i + 3,
          input: 'test',
          path: 'test',
          context: {},
          signal: null,
        },
      }).subscribe({ next: success });

      await vi.waitFor(() => {
        expect(success).toHaveBeenCalled();
      });
    }

    // Should transition from open -> half-open -> closed
    expect(stateChanges).toEqual(['open', 'half-open', 'closed']);
    // 2 failures + 3 successes in half-open = 5 requests reached server
    expect(endingLinkTriggered).toHaveBeenCalledTimes(5);
  });

  test('works with custom thresholds', async () => {
    const stateChanges: string[] = [];
    const endingLinkTriggered = vi.fn();

    const links: OperationLink<AnyRouter, any, any>[] = [
      circuitBreakerLink({
        failureThreshold: 1,
        openToHalfOpenTimeoutMs: 2000,
        halfOpenSuccessThreshold: 1,
        onStateChange: (state) => stateChanges.push(state),
      })(null as any),
      () => {
        return observable((observer) => {
          endingLinkTriggered();
          observer.error(new TRPCClientError('Server error'));
        });
      },
    ];

    // Single failure should open circuit
    const error = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 1,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ error });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });

    expect(stateChanges).toEqual(['open']);
    expect(endingLinkTriggered).toHaveBeenCalledTimes(1);

    // Try another request - should be rejected
    const error2 = vi.fn();
    createChain<AnyRouter, unknown, unknown>({
      links,
      op: {
        type: 'query',
        id: 2,
        input: 'test',
        path: 'test',
        context: {},
        signal: null,
      },
    }).subscribe({ error: error2 });

    await vi.waitFor(() => {
      expect(error2).toHaveBeenCalled();
      const errorMsg = error2.mock.calls[0][0].message.toLowerCase();
      expect(errorMsg).toContain('circuit');
      expect(errorMsg).toContain('open');
    });

    expect(endingLinkTriggered).toHaveBeenCalledTimes(1);
  });
});
