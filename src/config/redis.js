import Redis from "ioredis";

const url = process.env.REDIS_URL;

// Options shared by both connection styles.
const commonOptions = {
  maxRetriesPerRequest: 5,
  connectTimeout: 15_000,
  // Some hosted providers (Upstash) handle the READY handshake differently,
  // which can make ioredis hang waiting for "ready". Send commands as soon as
  // the socket connects instead.
  enableReadyCheck: false,
  // Reconnect with backoff instead of giving up after a blip.
  retryStrategy: (times) => Math.min(times * 200, 2000),
};

// Single shared Redis connection for the whole service.
//
// Two ways to configure it:
//   1. REDIS_URL: a full connection string, which is what hosted providers
//      (Upstash, Render, Railway) hand you. A "rediss://" URL uses TLS.
//   2. REDIS_HOST / REDIS_PORT / REDIS_PASSWORD: discrete vars, handy for
//      local/dev Redis where no URL is involved.
const redis = url
  ? new Redis(url, {
      ...commonOptions,
      // rediss:// endpoints require TLS. Set it explicitly so the handshake
      // always happens, even if URL parsing doesn't enable it on its own.
      ...(url.startsWith("rediss://") ? { tls: {} } : {}),
    })
  : new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
      ...commonOptions,
    });

redis.on("error", (err) => console.error("[redis] connection error:", err.message));
redis.on("connect", () => console.log("[redis] socket connected"));
redis.on("ready", () => console.log("[redis] ready"));
redis.on("reconnecting", () => console.log("[redis] reconnecting..."));

export default redis;