import { fixedWindow } from "../src/algorithms/fixedWindow.js";
import redis from "../src/config/redis.js";

afterAll(async () => {
  await redis.quit();
});

describe("fixed window", () => {
  test("allows up to limit, then denies within a window", async () => {
    const client = `jest:fw:${Date.now()}`;
    const cfg = { limit: 5, windowMs: 60000 };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await fixedWindow(client, cfg));
    expect(results.filter((r) => r.allowed).length).toBe(5);
    expect(results[4].allowed).toBe(true);
    expect(results[5].allowed).toBe(false);
  });

  test("concurrent requests never exceed the limit (atomicity)", async () => {
    const client = `jest:fw:conc:${Date.now()}`;
    const cfg = { limit: 10, windowMs: 60000 };
    const results = await Promise.all(
      Array.from({ length: 25 }, () => fixedWindow(client, cfg))
    );
    expect(results.filter((r) => r.allowed).length).toBe(10);
  });
});
