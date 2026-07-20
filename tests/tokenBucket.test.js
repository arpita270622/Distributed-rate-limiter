import { tokenBucket } from "../src/algorithms/tokenBucket.js";
import redis from "../src/config/redis.js";

// NOTE: these tests need a running Redis (docker compose up redis).

const TEST_CLIENT = "test:client:tokenbucket";

afterAll(async () => {
  await redis.del(`rl:tokenbucket:${TEST_CLIENT}`);
  await redis.quit();
});

describe("token bucket", () => {
  test("allows requests up to capacity, then denies", async () => {
    const config = { capacity: 5, refillRate: 0 }; // refillRate 0 = no refill during test
    await redis.del(`rl:tokenbucket:${TEST_CLIENT}`);

    const results = [];
    for (let i = 0; i < 7; i++) {
      results.push(await tokenBucket(TEST_CLIENT, config));
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(5); // exactly capacity
    expect(results[5].allowed).toBe(false);
    expect(results[6].allowed).toBe(false);
  });

  test("refills tokens over time", async () => {
    // 5 tokens/sec => one token every 200ms.
    const client = `jest:tb:refill:${Date.now()}`;
    const config = { capacity: 5, refillRate: 5 };

    // Drain the bucket completely.
    for (let i = 0; i < 5; i++) await tokenBucket(client, config);

    // Empty now: the next request must be denied.
    const denied = await tokenBucket(client, config);
    expect(denied.allowed).toBe(false);

    // Wait long enough for the bucket to refill (~2.5 tokens in 500ms).
    await new Promise((r) => setTimeout(r, 500));

    // It should allow again, proving refill happened purely from elapsed time.
    const allowedAgain = await tokenBucket(client, config);
    expect(allowedAgain.allowed).toBe(true);

    await redis.del(`rl:tokenbucket:${client}`);
  });

  test("concurrent requests never exceed capacity (atomicity)", async () => {
    // refillRate 0 => no refill mid-test, so capacity is an exact ceiling.
    // If the Lua check-and-decrement weren't atomic, parallel requests would
    // race and let more than `capacity` through.
    const client = `jest:tb:conc:${Date.now()}`;
    const config = { capacity: 10, refillRate: 0 };

    const results = await Promise.all(
      Array.from({ length: 25 }, () => tokenBucket(client, config))
    );
    expect(results.filter((r) => r.allowed).length).toBe(10);

    await redis.del(`rl:tokenbucket:${client}`);
  });
});
