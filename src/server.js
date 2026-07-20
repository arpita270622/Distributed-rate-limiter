import express from "express";
import redis from "./config/redis.js";
import { LANDING_PAGE } from "./landingPage.js";
import { tokenBucket } from "./algorithms/tokenBucket.js";
import { fixedWindow } from "./algorithms/fixedWindow.js";
import { slidingWindowLog } from "./algorithms/slidingWindowLog.js";
import { slidingWindowCounter } from "./algorithms/slidingWindowCounter.js";

const app = express();
app.use(express.json());

// Behind a load balancer / reverse proxy (nginx in our compose setup), so the
// real client IP arrives in X-Forwarded-For. Trust it so req.ip is correct —
// important because the middleware form limits by req.ip by default.
app.set("trust proxy", true);

// Failure mode when Redis is unreachable, set via env:
//   FAIL_MODE=open   (default) -> allow requests, keep the app usable
//   FAIL_MODE=closed          -> deny requests, safer against abuse
// This is the classic fail-open vs fail-closed tradeoff, now configurable.
const FAIL_MODE = (process.env.FAIL_MODE || "open").toLowerCase();

// Registry of available algorithms. Adding a new one = one line here.
// This "pluggable" design is a selling point — mention it on your resume.
const ALGORITHMS = {
  tokenbucket: tokenBucket,
  fixedwindow: fixedWindow,
  slidinglog: slidingWindowLog,
  slidingcounter: slidingWindowCounter,
};

// Default limit config per algorithm. In a real service these would come
// from a config store / per-client rules in a database.
const DEFAULT_CONFIG = {
  tokenbucket: { capacity: 10, refillRate: 5 }, // 10 burst, refills 5/sec
  fixedwindow: { limit: 100, windowMs: 60_000 }, // 100 per minute
  slidinglog: { limit: 100, windowMs: 60_000 },
  slidingcounter: { limit: 100, windowMs: 60_000 },
};

// Home page: a live demo so visitors (and recruiters) see the limiter working
// instead of a bare 404 at the root.
app.get("/", (_req, res) => {
  res.type("html").send(LANDING_PAGE);
});

// Liveness: is the process up? Cheap, no dependencies. Orchestrators restart
// the container if this fails.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Readiness: can we actually serve traffic (is Redis reachable)? Orchestrators
// use this to decide whether to route requests here. We race the ping against a
// short timeout so a hung Redis can't hang the probe.
app.get("/ready", async (_req, res) => {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), 1000)
      ),
    ]);
    if (pong === "PONG") return res.json({ status: "ready" });
    return res
      .status(503)
      .json({ status: "not ready", reason: "unexpected redis response" });
  } catch (err) {
    return res.status(503).json({ status: "not ready", reason: err.message });
  }
});

/**
 * POST /check
 * body: { clientId: string, algorithm?: string }
 * Returns 200 { allowed:true, ... } or 429 { allowed:false, ... }
 *
 * This is the endpoint other services call before serving a request,
 * OR you can wire the middleware (src/middleware/rateLimit.js) directly
 * into an app. Both patterns are worth showing.
 */
app.post("/check", async (req, res) => {
  const { clientId, algorithm = "tokenbucket" } = req.body || {};

  if (!clientId) {
    return res.status(400).json({ error: "clientId is required" });
  }

  const algoFn = ALGORITHMS[algorithm];
  if (!algoFn) {
    return res.status(400).json({
      error: `unknown algorithm '${algorithm}'`,
      available: Object.keys(ALGORITHMS),
    });
  }

  try {
    const result = await algoFn(clientId, DEFAULT_CONFIG[algorithm]);
    const status = result.allowed ? 200 : 429;
    res.status(status).json({ algorithm, ...result });
  } catch (err) {
    // Redis is unreachable. Honor the configured failure mode instead of
    // always returning 500 — that's the real production decision.
    console.error("[check] limiter error:", err.message);
    if (FAIL_MODE === "closed") {
      return res.status(503).json({
        allowed: false,
        algorithm,
        error: "rate limiter unavailable (fail-closed)",
      });
    }
    // fail open: let the request through so a Redis blip doesn't take the app down
    return res.status(200).json({
      allowed: true,
      algorithm,
      degraded: true,
      error: "rate limiter unavailable (fail-open)",
    });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
const server = app.listen(PORT, () => {
  console.log(`[server] rate limiter listening on :${PORT} (fail-mode: ${FAIL_MODE})`);
});

// Graceful shutdown: on a deploy/stop signal, stop taking new connections,
// finish in-flight requests, close Redis, then exit. Without this, Docker/k8s
// SIGTERM would hard-kill mid-request and wait out the 10s grace timeout.
function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  server.close(async () => {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
    console.log("[server] shutdown complete");
    process.exit(0);
  });
  // Safety net: if something hangs, force-exit rather than block forever.
  setTimeout(() => {
    console.error("[server] graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

["SIGTERM", "SIGINT"].forEach((sig) => process.on(sig, () => shutdown(sig)));

export default app;
