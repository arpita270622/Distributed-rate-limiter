import { slidingWindowCounter } from "../src/algorithms/slidingWindowCounter.js";
import redis from "../src/config/redis.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  await redis.quit();
});

describe("sliding window counter", () => {
  test("allows up to limit within a window, then denies", async () => {
    // With no previous window, the estimate equals the current count, so the
    // ceiling is exact.
    const client = `jest:swc:${Date.now()}`;
    const cfg = { limit: 5, windowMs: 60000 };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await slidingWindowCounter(client, cfg));
    expect(results.filter((r) => r.allowed).length).toBe(5);
    expect(results[4].allowed).toBe(true);
    expect(results[5].allowed).toBe(false);
    await redis.del(`rl:slidingcounter:${client}`);
  });

  test("concurrent requests never exceed the limit (atomicity)", async () => {
    // All in one window (previous = 0), so exactly `limit` may pass. If the
    // read-estimate-write weren't atomic, parallel calls would over-admit.
    const client = `jest:swc:conc:${Date.now()}`;
    const cfg = { limit: 10, windowMs: 60000 };
    const results = await Promise.all(
      Array.from({ length: 25 }, () => slidingWindowCounter(client, cfg))
    );
    expect(results.filter((r) => r.allowed).length).toBe(10);
    await redis.del(`rl:slidingcounter:${client}`);
  });

  test("smooths across the boundary (no fresh full burst like fixed window)", async () => {
    // Uses short 1s windows and aligns to boundaries so the test is stable.
    const client = `jest:swc:smooth:${Date.now()}`;
    const cfg = { limit: 10, windowMs: 1000 };

    // Land just inside a fresh window, then fill it to the limit.
    await sleep(cfg.windowMs - (Date.now() % cfg.windowMs) + 20);
    let allowedW1 = 0;
    for (let i = 0; i < cfg.limit; i++) {
      if ((await slidingWindowCounter(client, cfg)).allowed) allowedW1++;
    }
    expect(allowedW1).toBe(cfg.limit);

    // Cross just into the NEXT window. A fixed window would now hand out a
    // fresh full `limit`; the counter weights in the (full) previous window,
    // so far fewer requests get through.
    await sleep(cfg.windowMs - (Date.now() % cfg.windowMs) + 20);
    let allowedW2 = 0;
    for (let i = 0; i < cfg.limit; i++) {
      if ((await slidingWindowCounter(client, cfg)).allowed) allowedW2++;
    }
    expect(allowedW2).toBeLessThan(cfg.limit);

    await redis.del(`rl:slidingcounter:${client}`);
  });
});
