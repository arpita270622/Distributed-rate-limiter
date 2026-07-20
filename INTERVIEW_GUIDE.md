# Interview Study Guide — Distributed Rate Limiter

Read this until you can explain each answer **out loud without looking**. Budget
2–3 focused hours. This is what turns the project from a resume line into an
asset you can defend. The interviewer's questions are predictable — they're below.

---

## 30-second project pitch (memorize the shape, not the words)

> "I built a distributed rate-limiting service in Node.js backed by Redis. It
> supports four algorithms — token bucket, fixed window, sliding window log,
> and a sliding window counter
> — behind one API, and it enforces a single global limit even across multiple
> server instances. The core challenge was correctness under concurrency: I used
> Redis Lua scripts to make the check-and-update atomic, which prevents race
> conditions where two instances both allow a request that should've been denied.
> I verified it with parallel-request tests and load-tested it with autocannon."

---

## The 5 questions you WILL be asked

### 1. "Why Redis? Why not just count in memory?"
Because the limiter runs on **multiple instances** (horizontal scaling). If each
instance counted in its own memory, a client hitting instance A and instance B
would get *two separate* limits — so with N instances the real limit is N× what
you intended. Redis is a **single shared source of truth** all instances read and
write, so the limit is global. Redis is also fast (in-memory) and gives us atomic
operations and TTL/expiry for free.

### 2. "What's the race condition, and how did you solve it?" ⭐ THE KEY ONE
The dangerous operation is **read-modify-write**: read the current count, decide
if there's room, then write the new count. If two requests do this at the same
time, both can read "1 token left," both decide "allowed," and both write —
letting through 2 requests when only 1 was permitted.

**Solution: Redis Lua scripts.** Redis is single-threaded and executes an entire
Lua script **atomically** — no other command runs in the middle. So the read,
the decision, and the write happen as one indivisible unit. No interleaving, no
race. That's why every algorithm's core logic lives in a `redis.eval(LUA, ...)`
call, not in JavaScript.

*Proof I did it right:* my tests fire 20 requests in parallel with `Promise.all`
against a limit of 10 and assert **exactly 10** are allowed. Without atomicity
you'd see 11–20 allowed.

### 3. "Walk me through the algorithms and their tradeoffs."

| Algorithm | How it works | Pro | Con |
|---|---|---|---|
| **Token bucket** | Bucket holds up to `capacity` tokens, refills at `refillRate`/sec; each request spends 1 | Allows controlled bursts; smooth | Slightly more state (tokens + timestamp) |
| **Fixed window** | Count requests per fixed time block (e.g. per minute); reset each block | Dead simple, cheap (one integer) | **Boundary burst**: 2× limit possible across a boundary |
| **Sliding window log** | Store a timestamp per request; count only those inside the last `windowMs` | Precise, no boundary burst | More memory (one entry per request) |
| **Sliding window counter** | Keep current + previous window counts; estimate = `prev * weight + cur` | O(1) memory, largely fixes boundary burst | Estimate assumes even spread in the previous window — slightly approximate |

**Boundary-burst flaw (say this — it shows depth):** with fixed window limit
100/min, a client sends 100 at 11:00:59 and 100 at 11:01:00 — 200 requests in ~1
second, because those fall in two different windows. Sliding window log fixes
this exactly by always looking at the *actual* last 60 seconds; the sliding
window **counter** fixes it approximately but for O(1) memory — early in a
window it weights in most of the previous window's count, so there's no fresh
full burst. The counter is the tradeoff sweet spot and what many production
limiters (CDNs, API gateways) actually run.

### 4. "What happens when Redis goes down?"
That's a **fail-open vs fail-closed** design decision.
- **Fail open** (what my middleware does): if the limiter errors, allow the
  request. Keeps the app up during a Redis blip, but temporarily unprotected.
- **Fail closed**: deny everything. Safer against abuse, but a Redis outage
  takes down your whole API.

The right choice depends on the endpoint: fail open for a normal API, fail closed
for something like a login/payment endpoint where abuse is dangerous. I default
to fail-open in the middleware and note it's configurable.

### 5. "How would you scale this further / what are its limits?"
- **Single Redis is a bottleneck / SPOF.** Next step: Redis Cluster or a
  replica setup; shard keys by clientId so load spreads.
- **Sliding window log uses memory proportional to traffic.** For very high
  limits, switch to the **sliding window counter** (a hybrid: keeps two
  fixed-window counts and interpolates — O(1) memory, nearly as accurate). I
  implemented this one too, so I can contrast the exact-but-heavy log against
  the approximate-but-cheap counter from real code.
- **Network hop per request.** Each check is a round-trip to Redis. For extreme
  scale you'd add a small local pre-check or approximate counting.

---

## Line-level things to understand in the code

Open each file and make sure these click:

**`tokenBucket.js`** — the `HMGET` reads tokens+timestamp; the refill math
(`elapsed * refillRate`, capped at capacity) is how tokens come back over time;
the TTL guards against divide-by-zero when refillRate is 0 (a bug I hit and fixed).

**`fixedWindow.js`** — `windowId = floor(now / windowMs)` is what makes the key
roll over automatically at each boundary; `INCR` returning 1 is the signal to set
`EXPIRE` exactly once; the whole thing is Lua so INCR+EXPIRE can't be split.

**`slidingWindowLog.js`** — sorted set with score = timestamp; `ZREMRANGEBYSCORE`
drops old entries, `ZCARD` counts, `ZADD` records; the **member must be unique**
(`now:suffix`) or same-millisecond requests overwrite each other and the count
breaks. This unique-member detail is a great story — it's a real bug you'd hit.

**`server.js`** — the `ALGORITHMS` registry is the "pluggable" design: adding an
algorithm is one line. The 429 status code is the HTTP standard for rate limited.

---

## Honest disclaimer for yourself

You did not type every line of this — but after reading this guide and the
inline comments, you *understand* every line, which is what actually matters.
Before any interview: re-implement the fixed window from scratch on paper (it's
the simplest). If you can do that, you own the project. If you can explain
question #2 (the race condition) clearly, you're ahead of most candidates.
