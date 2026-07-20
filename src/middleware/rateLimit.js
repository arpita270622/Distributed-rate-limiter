import { tokenBucket } from "../algorithms/tokenBucket.js";

/**
 * Drop-in Express middleware form of the rate limiter.
 * Shows you understand the SDK/middleware pattern, not just a standalone API.
 *
 * Usage:
 *   app.use(rateLimit({ keyFn: req => req.ip, capacity: 20, refillRate: 10 }));
 *
 * The keyFn lets the caller decide what to limit on: IP, API key, user id, etc.
 */
export function rateLimit({ keyFn = (req) => req.ip, ...config }) {
  return async (req, res, next) => {
    try {
      const clientId = keyFn(req);
      const { allowed, remaining, limit } = await tokenBucket(clientId, config);

      // Standard rate-limit response headers (clients rely on these).
      res.set("X-RateLimit-Limit", String(limit));
      res.set("X-RateLimit-Remaining", String(Math.max(0, remaining)));

      if (!allowed) {
        return res.status(429).json({ error: "Too Many Requests" });
      }
      next();
    } catch (err) {
      // Fail open on limiter errors so a Redis blip doesn't take down the app.
      console.error("[rateLimit middleware] error:", err.message);
      next();
    }
  };
}
