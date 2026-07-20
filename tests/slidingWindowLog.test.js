import { slidingWindowLog } from "../src/algorithms/slidingWindowLog.js";
import redis from "../src/config/redis.js";

afterAll(async () => {
  await redis.quit();
});

describe("sliding window log", () => {
  test("allows up to limit, then denies within the window", async () => {
    const client = `jest:sw:${Date.now()}`;
    const cfg = { limit: 5, windowMs: 2000 };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await slidingWindowLog(client, cfg));
    expect(results.filter((r) => r.allowed).length).toBe(5);
  });

  test("concurrent same-millisecond requests never exceed the limit", async () => {
    // This proves BOTH the Lua atomicity AND the unique-member fix:
    // if members collided, ZADD would overwrite and the count would be wrong.
    const client = `jest:sw:conc:${Date.now()}`;
    const cfg = { limit: 10, windowMs: 2000 };
    const results = await Promise.all(
      Array.from({ length: 25 }, () => slidingWindowLog(client, cfg))
    );
    expect(results.filter((r) => r.allowed).length).toBe(10);
  });

  test("allows again after the window slides past", async () => {
    const client = `jest:sw:expiry:${Date.now()}`;
    const cfg = { limit: 2, windowMs: 1000 };
    await slidingWindowLog(client, cfg);
    await slidingWindowLog(client, cfg);
    const denied = await slidingWindowLog(client, cfg);
    expect(denied.allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    const allowedAgain = await slidingWindowLog(client, cfg);
    expect(allowedAgain.allowed).toBe(true);
  });
});
