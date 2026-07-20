import redis from "../config/redis.js";

/**
 * FIXED WINDOW COUNTER
 * --------------------
 * Divides time into fixed windows (e.g. every 60s). Counts requests in the
 * current window; if count <= limit, allow and increment; else deny. A new
 * window starts a fresh counter.
 *
 * windowId = floor(now / windowMs) — same value for every request in the
 * same window, so the key `rl:fixedwindow:<clientId>:<windowId>` is shared
 * by all requests in that window and changes automatically at the boundary.
 *
 * WHY LUA: we INCR the counter, then must EXPIRE it — but only on first
 * creation. Doing INCR and EXPIRE as two separate commands leaves a gap: if
 * the process dies between them, the key never expires and lives forever.
 * The Lua script makes "INCR, and if it's the first hit set EXPIRE" a single
 * atomic operation.
 *
 * KNOWN FLAW (say this in interviews): fixed window allows boundary bursts.
 * With limit=100/min a client can send 100 at 11:00:59 and 100 at 11:01:00 —
 * 200 requests in ~1s across two windows. Sliding window fixes this.
 */

const FIXED_WINDOW_LUA = `
-- KEYS[1] = counter key for this client+window
-- ARGV[1] = limit
-- ARGV[2] = window length in seconds (for EXPIRE)

local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local ttl    = tonumber(ARGV[2])

-- INCR returns the new value. On the very first request in this window it
-- returns 1, which is our signal to set the expiry exactly once.
local count = redis.call("INCR", key)
if count == 1 then
  redis.call("EXPIRE", key, ttl)
end

local allowed = 0
if count <= limit then
  allowed = 1
end

-- remaining never goes negative
local remaining = math.max(0, limit - count)
return { allowed, remaining }
`;

export async function fixedWindow(clientId, { limit, windowMs }) {
  const windowId = Math.floor(Date.now() / windowMs);
  const key = `rl:fixedwindow:${clientId}:${windowId}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  const [allowed, remaining] = await redis.eval(
    FIXED_WINDOW_LUA,
    1, // number of KEYS
    key,
    limit,
    ttlSeconds
  );

  return {
    allowed: allowed === 1,
    remaining,
    limit,
  };
}

