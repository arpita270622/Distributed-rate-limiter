import Redis from "ioredis";

// Single shared Redis connection for the whole service.
// In production you'd add TLS, auth, and a connection pool / cluster client here.
const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  // Fail fast instead of buffering commands forever if Redis is down.
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[redis] connected");
});

export default redis;
