import redis from "../config/redis.js";

/**
 * TOKEN BUCKET ALGORITHM  (fully implemented — use this as your reference)
 * -----------------------------------------------------------------------
 * Idea: each client has a "bucket" that holds up to `capacity` tokens.
 * Tokens refill at a steady `refillRate` (tokens per second). Every request
 * costs 1 token. If the bucket has a token, the request is allowed and a
 * token is removed; if it's empty, the request is denied.
 *
 * WHY A LUA SCRIPT?
 * The check-and-decrement must be ATOMIC. If two of our service instances
 * both read "1 token left" at the same time and both allow the request,
 * we've let through 2 requests when only 1 was permitted. Redis runs each
 * Lua script atomically (single-threaded, no interleaving), so the read,
 * the refill calculation, and the write all happen as one indivisible unit.
 * THIS is the core distributed-systems insight of the whole project.
 *
 * We store two fields per client in a Redis hash:
 *   tokens    -> how many tokens are currently in the bucket
 *   timestamp -> the last time (ms) we refilled the bucket
 */

const TOKEN_BUCKET_LUA = `
-- KEYS[1] = the redis key for this client's bucket
-- ARGV[1] = capacity (max tokens)
-- ARGV[2] = refillRate (tokens per second)
-- ARGV[3] = now (current time in milliseconds)
-- ARGV[4] = requested (tokens this request costs, usually 1)

local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local refillRate= tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

-- Read current state (or start with a full bucket if this is a new client).
local bucket = redis.call("HMGET", key, "tokens", "timestamp")
local tokens = tonumber(bucket[1])
local last   = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last = now
end

-- Refill: figure out how many tokens have accrued since the last request.
local elapsed = math.max(0, now - last) / 1000  -- seconds
local refill  = elapsed * refillRate
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
  allowed = 1
  tokens = tokens - requested
end

-- Persist new state. Set a TTL so idle clients get cleaned up automatically
-- (avoids Redis filling with dead keys). TTL = time to fully refill + buffer.
-- Guard against refillRate == 0 (would divide by zero -> inf -> Redis error).
redis.call("HMSET", key, "tokens", tokens, "timestamp", now)
local ttl
if refillRate > 0 then
  ttl = math.ceil(capacity / refillRate) + 10
else
  ttl = 3600  -- no refill: just keep the key an hour then let it expire
end
redis.call("EXPIRE", key, ttl)

-- Return: allowed(0/1), tokens remaining (floored for reporting)
return { allowed, math.floor(tokens) }
`;

export async function tokenBucket(clientId, { capacity, refillRate, cost = 1 }) {
  const key = `rl:tokenbucket:${clientId}`;
  const now = Date.now();

  const [allowed, remaining] = await redis.eval(
    TOKEN_BUCKET_LUA,
    1, // number of KEYS
    key,
    capacity,
    refillRate,
    now,
    cost
  );

  return {
    allowed: allowed === 1,
    remaining,
    limit: capacity,
  };
}
