import redis from "../config/redis.js";

/**
 * SLIDING WINDOW LOG
 * ------------------
 * Keeps a timestamped log of every request in the last `windowMs`. To decide
 * a new request: drop all timestamps older than (now - windowMs), count what
 * remains; if under the limit, allow and record this request.
 *
 * This is PRECISE — no boundary-burst flaw like fixed window — at the cost of
 * more memory (one sorted-set entry per request in the window).
 *
 * Implemented with a Redis SORTED SET where score = timestamp (ms):
 *   ZREMRANGEBYSCORE  drops entries older than the window
 *   ZCARD             counts what's left
 *   ZADD              records the new request
 *
 * WHY LUA: the remove -> count -> add sequence must be atomic. Otherwise two
 * instances can both see "count = limit - 1", both decide "allowed", and both
 * ZADD — letting through one more than the limit. Running it as one Lua script
 * closes that race.
 *
 * DUPLICATE-SCORE BUG (important interview point): a sorted set member must be
 * unique. If two requests arrive in the same millisecond and we use the raw
 * timestamp as the member, the second ZADD overwrites the first (same member),
 * so our count is wrong. Fix: keep score = timestamp for the time-window math,
 * but make the MEMBER unique by appending a counter/random suffix.
 */

const SLIDING_LOG_LUA = `
-- KEYS[1] = sorted set key for this client
-- ARGV[1] = now (ms)
-- ARGV[2] = windowMs
-- ARGV[3] = limit
-- ARGV[4] = a unique suffix to guarantee a unique member for this request

local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local suffix   = ARGV[4]

-- 1. Drop entries older than the sliding window.
local cutoff = now - windowMs
redis.call("ZREMRANGEBYSCORE", key, 0, cutoff)

-- 2. Count requests still inside the window.
local count = redis.call("ZCARD", key)

local allowed = 0
if count < limit then
  -- 3. Record this request. Score = now (for future window math),
  --    member = now:suffix (unique, so it can't overwrite another entry).
  redis.call("ZADD", key, now, now .. ":" .. suffix)
  allowed = 1
  count = count + 1
end

-- Keep the key alive a bit longer than the window, then let it expire.
redis.call("PEXPIRE", key, windowMs + 1000)

local remaining = math.max(0, limit - count)
return { allowed, remaining }
`;

// A process-local counter so two calls in the same millisecond still get
// distinct members even before the random part.
let counter = 0;

export async function slidingWindowLog(clientId, { limit, windowMs }) {
  const key = `rl:slidinglog:${clientId}`;
  const now = Date.now();
  const suffix = `${process.pid}-${counter++}-${Math.random().toString(36).slice(2)}`;

  const [allowed, remaining] = await redis.eval(
    SLIDING_LOG_LUA,
    1, // number of KEYS
    key,
    now,
    windowMs,
    limit,
    suffix
  );

  return {
    allowed: allowed === 1,
    remaining,
    limit,
  };
}

