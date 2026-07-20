import redis from "../config/redis.js";

/**
 * SLIDING WINDOW COUNTER  (the hybrid)
 * ------------------------------------
 * A middle ground between fixed window and sliding window log:
 *   - Cheaper than the log — it stores THREE integers per client, not one
 *     sorted-set entry per request. Memory is O(1), not O(requests-in-window).
 *   - Smoother than fixed window — it doesn't reset to a full fresh limit at
 *     the window boundary, so it largely avoids the boundary-burst flaw.
 *
 * HOW IT WORKS
 * We keep a counter for the CURRENT fixed window and the PREVIOUS one. To
 * estimate how many requests fall inside the rolling window ending at `now`,
 * we take the whole current-window count plus a *weighted fraction* of the
 * previous-window count — the fraction of the previous window that still
 * overlaps the rolling window:
 *
 *     weight   = (windowMs - elapsedIntoCurrentWindow) / windowMs   // 1 -> 0
 *     estimate = previousCount * weight + currentCount
 *
 * Early in the current window, weight is near 1, so almost all of the previous
 * window still counts against you (no fresh full burst). Late in the window,
 * weight approaches 0, so the previous window has mostly aged out. If the
 * estimate is below the limit we allow and increment the current counter.
 *
 * TRADEOFF TO SAY IN INTERVIEWS: the estimate assumes the previous window's
 * requests were spread evenly across it. That's an approximation — it can be
 * slightly optimistic or pessimistic versus the exact log — but in exchange
 * you get O(1) memory and no per-request log. In practice the error is small,
 * which is why this is what many production limiters (e.g. CDNs) actually use.
 *
 * WHY LUA: same reason as the others — read the two counters, compute the
 * estimate, decide, and write the incremented counter must be ONE atomic step,
 * or two instances racing on the "last" slot both allow.
 *
 * State is a single Redis hash per client:
 *   win  -> the current window id (floor(now / windowMs))
 *   cur  -> request count in the current window
 *   prev -> request count in the immediately previous window
 */

const SLIDING_COUNTER_LUA = `
-- KEYS[1] = hash key for this client
-- ARGV[1] = windowId (floor(now / windowMs))
-- ARGV[2] = weight    (fraction of the previous window still overlapping, 0..1)
-- ARGV[3] = limit
-- ARGV[4] = ttl in seconds (>= two windows so 'prev' survives into 'cur')

local key      = KEYS[1]
local windowId = tonumber(ARGV[1])
local weight   = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

local data      = redis.call("HMGET", key, "win", "cur", "prev")
local storedWin = tonumber(data[1])
local cur       = tonumber(data[2])
local prev      = tonumber(data[3])

if storedWin == nil then
  -- Brand new client.
  storedWin = windowId
  cur = 0
  prev = 0
elseif storedWin == windowId then
  -- Still in the same window: keep both counters as-is.
elseif storedWin == windowId - 1 then
  -- Advanced exactly one window: the old current becomes the new previous.
  prev = cur
  cur = 0
else
  -- Gap of two or more windows: nothing relevant survives.
  prev = 0
  cur = 0
end

-- Defensive: treat any missing field as zero.
if cur == nil then cur = 0 end
if prev == nil then prev = 0 end

local estimate = prev * weight + cur

local allowed = 0
if estimate < limit then
  allowed = 1
  cur = cur + 1
end

redis.call("HMSET", key, "win", windowId, "cur", cur, "prev", prev)
redis.call("EXPIRE", key, ttl)

local newEstimate = prev * weight + cur
local remaining = math.max(0, math.floor(limit - newEstimate))
return { allowed, remaining }
`;

export async function slidingWindowCounter(clientId, { limit, windowMs }) {
  const key = `rl:slidingcounter:${clientId}`;
  const now = Date.now();

  const windowId = Math.floor(now / windowMs);
  const elapsed = now - windowId * windowMs; // ms into the current window
  const weight = (windowMs - elapsed) / windowMs; // 1 at start -> ~0 at end
  const ttlSeconds = Math.ceil(windowMs / 1000) * 2 + 10;

  const [allowed, remaining] = await redis.eval(
    SLIDING_COUNTER_LUA,
    1, // number of KEYS
    key,
    windowId,
    weight,
    limit,
    ttlSeconds
  );

  return {
    allowed: allowed === 1,
    remaining,
    limit,
  };
}
