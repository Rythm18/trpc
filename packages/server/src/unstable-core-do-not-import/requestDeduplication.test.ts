import { z } from 'zod';
import { TRPCError } from './error/TRPCError';
import { initTRPC } from './initTRPC';
import { experimental_requestDeduplication } from './requestDeduplication';

describe('request deduplication middleware', () => {
  test('deduplicates concurrent identical requests', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionCount++;
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { id: input.id, value: 'test-value' };
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // Fire off 5 concurrent requests with the same input
    const results = await Promise.all([
      caller.getItem({ id: '123' }),
      caller.getItem({ id: '123' }),
      caller.getItem({ id: '123' }),
      caller.getItem({ id: '123' }),
      caller.getItem({ id: '123' }),
    ]);

    // All requests should return the same result
    expect(results).toHaveLength(5);
    results.forEach((result) => {
      expect(result).toEqual({ id: '123', value: 'test-value' });
    });

    // But the resolver should only execute once
    expect(executionCount).toBe(1);
  });

  test('does not deduplicate requests with different inputs', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { id: input.id, value: `value-${input.id}` };
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // Fire off concurrent requests with different inputs
    const results = await Promise.all([
      caller.getItem({ id: '1' }),
      caller.getItem({ id: '2' }),
      caller.getItem({ id: '3' }),
    ]);

    // Each should have unique results
    expect(results[0]).toEqual({ id: '1', value: 'value-1' });
    expect(results[1]).toEqual({ id: '2', value: 'value-2' });
    expect(results[2]).toEqual({ id: '3', value: 'value-3' });

    // Resolver should execute for each unique input
    expect(executionCount).toBe(3);
  });

  test('does not deduplicate sequential requests', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { id: input.id, count: executionCount };
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // Make sequential requests (not concurrent)
    const result1 = await caller.getItem({ id: '123' });
    const result2 = await caller.getItem({ id: '123' });
    const result3 = await caller.getItem({ id: '123' });

    // Each should execute separately
    expect(result1.count).toBe(1);
    expect(result2.count).toBe(2);
    expect(result3.count).toBe(3);
    expect(executionCount).toBe(3);
  });

  test('shares errors across concurrent requests', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Item ${input.id} not found`,
        });
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // Fire off concurrent requests that will all error
    const promises = [
      caller.getItem({ id: '404' }),
      caller.getItem({ id: '404' }),
      caller.getItem({ id: '404' }),
    ];

    // All should throw the same error
    await expect(promises[0]).rejects.toThrow('Item 404 not found');
    await expect(promises[1]).rejects.toThrow('Item 404 not found');
    await expect(promises[2]).rejects.toThrow('Item 404 not found');

    // But resolver should only execute once
    expect(executionCount).toBe(1);
  });

  test('cleans up after request completion', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { id: input.id, count: executionCount };
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // First batch of concurrent requests
    await Promise.all([
      caller.getItem({ id: 'test' }),
      caller.getItem({ id: 'test' }),
    ]);

    expect(executionCount).toBe(1);

    // Wait a bit to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second batch should not be deduplicated with first
    await Promise.all([
      caller.getItem({ id: 'test' }),
      caller.getItem({ id: 'test' }),
    ]);

    expect(executionCount).toBe(2);
  });

  test('works with mutations', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedMutation = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ value: z.number() }))
      .mutation(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { result: input.value * 2 };
      });

    const router = t.router({
      double: deduplicatedMutation,
    });

    const caller = router.createCaller({});

    // Concurrent mutations with same input should deduplicate
    const results = await Promise.all([
      caller.double({ value: 5 }),
      caller.double({ value: 5 }),
      caller.double({ value: 5 }),
    ]);

    expect(results).toEqual([
      { result: 10 },
      { result: 10 },
      { result: 10 },
    ]);
    expect(executionCount).toBe(1);
  });

  test('handles complex nested inputs', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(
        z.object({
          user: z.object({
            id: z.string(),
            preferences: z.object({
              theme: z.string(),
            }),
          }),
          filters: z.array(z.string()),
        }),
      )
      .query(async ({ input }) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { success: true, input };
      });

    const router = t.router({
      complexQuery: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    const complexInput = {
      user: {
        id: 'user-123',
        preferences: {
          theme: 'dark',
        },
      },
      filters: ['active', 'verified'],
    };

    // Concurrent requests with identical complex inputs
    const results = await Promise.all([
      caller.complexQuery(complexInput),
      caller.complexQuery(complexInput),
      caller.complexQuery(complexInput),
    ]);

    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result.success).toBe(true);
      expect(result.input).toEqual(complexInput);
    });
    expect(executionCount).toBe(1);
  });

  test('differentiates between similar but not identical inputs', async () => {
    const t = initTRPC.create();
    const executionLog: string[] = [];

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ a: z.number(), b: z.number() }))
      .query(async ({ input }) => {
        const key = `${input.a}-${input.b}`;
        executionLog.push(key);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { sum: input.a + input.b };
      });

    const router = t.router({
      add: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // These inputs are different despite similar structure
    const results = await Promise.all([
      caller.add({ a: 1, b: 2 }),
      caller.add({ a: 2, b: 1 }), // Different values
      caller.add({ a: 1, b: 2 }), // Same as first
    ]);

    expect(results[0]).toEqual({ sum: 3 });
    expect(results[1]).toEqual({ sum: 3 });
    expect(results[2]).toEqual({ sum: 3 });

    // Should execute twice: once for {1,2} and once for {2,1}
    expect(executionLog).toHaveLength(2);
    expect(executionLog).toContain('1-2');
    expect(executionLog).toContain('2-1');
  });

  test('works with undefined input', async () => {
    const t = initTRPC.create();
    let executionCount = 0;

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .query(async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { timestamp: Date.now() };
      });

    const router = t.router({
      getTime: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // Concurrent requests with no input
    const results = await Promise.all([
      caller.getTime(),
      caller.getTime(),
      caller.getTime(),
    ]);

    // All should have the same timestamp
    expect(results[0].timestamp).toBe(results[1].timestamp);
    expect(results[1].timestamp).toBe(results[2].timestamp);
    expect(executionCount).toBe(1);
  });

  test('handles mixed concurrent and sequential requests correctly', async () => {
    const t = initTRPC.create();
    const executionTimestamps: number[] = [];

    const deduplicatedProcedure = t.procedure
      .use(experimental_requestDeduplication())
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        executionTimestamps.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { id: input.id, executions: executionTimestamps.length };
      });

    const router = t.router({
      getItem: deduplicatedProcedure,
    });

    const caller = router.createCaller({});

    // First batch of concurrent requests
    const batch1 = await Promise.all([
      caller.getItem({ id: 'x' }),
      caller.getItem({ id: 'x' }),
    ]);

    expect(batch1[0].executions).toBe(1);
    expect(batch1[1].executions).toBe(1);

    // Wait for a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second batch should execute again
    const batch2 = await Promise.all([
      caller.getItem({ id: 'x' }),
      caller.getItem({ id: 'x' }),
    ]);

    expect(batch2[0].executions).toBe(2);
    expect(batch2[1].executions).toBe(2);
    expect(executionTimestamps).toHaveLength(2);
  });
});
