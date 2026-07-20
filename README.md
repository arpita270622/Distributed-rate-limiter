# Distributed Rate Limiter as a Service

A pluggable, Redis-backed rate-limiting service. Supports four algorithms
(token bucket, fixed window, sliding window log, sliding window counter), runs
as a standalone API or as Express middleware, and enforces a **single global
limit across multiple service instances** via shared Redis state with atomic
Lua scripts.

> This README doubles as your build roadmap. Follow the phases in order.

---

## Why this project matters (for interviews)

"Design a rate limiter" is one of the most common systems-design questions at
big tech. Building one means you can discuss, from real experience:
- **Atomicity & race conditions** (the core problem, solved with Lua scripts)
- **Algorithm tradeoffs** (burst tolerance vs precision vs memory)
- **Distributed state** (why Redis, why not in-memory)
- **Failure modes** (fail-open vs fail-closed when Redis is down)

The value is in *your* understanding. The token bucket is implemented as a
reference; **you implement the other two yourself** — that's where the
interview stories come from.

---

## Architecture

```
        ┌─────────────┐     ┌─────────────┐
client → │ instance 1  │     │ instance 2  │  ← both stateless
         └──────┬──────┘     └──────┬──────┘
                │                   │
                └─────────┬─────────┘
                          ▼
                    ┌───────────┐
                    │   Redis   │  ← single source of truth
                    │  (atomic  │     (Lua scripts run atomically)
                    │  Lua ops) │
                    └───────────┘
```

Each instance is stateless; all rate-limit state lives in Redis. Because Redis
runs Lua scripts atomically, two instances can never both "allow" the same
last token. That's what makes the limit *global* and correct under concurrency.

---

## Build roadmap

### ✅ Phase 0 — Scaffold (done for you)
Working skeleton, token bucket reference implementation, Docker, CI, benchmark
harness, and one starter test.

### 📌 Phase 1 — Get it running (Day 1)
1. `npm install`
2. `docker compose up redis -d` (Redis only, for local dev)
3. `npm run dev`
4. Test it: `curl -X POST localhost:3000/check -H "content-type: application/json" -d '{"clientId":"me"}'`
5. Fire it 15 times fast — watch it start returning 429 after the bucket empties.
6. **Read `src/algorithms/tokenBucket.js` line by line.** Understand the Lua
   script completely before moving on. This is the template for everything else.

### 📌 Phase 2 — Implement Fixed Window (Days 2–4)
- Open `src/algorithms/fixedWindow.js` — full guidance is in the comments.
- Easiest algorithm; good warm-up for writing your own Lua.
- When done, manually test the **boundary-burst flaw** (send limit at end of
  one window + limit at start of next). Seeing it fail is the lesson.

### 📌 Phase 3 — Implement Sliding Window Log (Days 5–9)
- Open `src/algorithms/slidingWindowLog.js` — guidance in comments.
- The hard one. Uses a Redis sorted set. Watch for the duplicate-score bug
  noted in the file — hitting and fixing it is a great interview story.
- Confirm it does NOT have the boundary-burst flaw fixed window has.

### 📌 Phase 4 — Tests (Days 10–12)
- Extend `tests/tokenBucket.test.js`; add test files for the other two.
- **Must-have test: fire many requests in parallel with `Promise.all` and
  assert the total allowed never exceeds the limit.** This proves your Lua
  atomicity works — the single most important correctness property.
- Get CI green (push to GitHub; the workflow runs Redis + your tests).

### 📌 Phase 5 — Dockerize & go distributed (Days 13–15)
- `docker compose up --build` — brings up Redis + TWO service instances.
- Run load against both instances and show the limit holds globally.
- Capture a screenshot/GIF for the README. This visual sells the project.

### 📌 Phase 6 — Benchmark & document (Days 16–18)
- `npm run bench` — record requests/sec and p99 latency.
- Put real numbers in the README and on your resume.
- Add an architecture diagram (the ASCII one above is fine, or draw one).

### ✅ Phase 7 — Sliding Window Counter (done)
The hybrid algorithm: O(1) memory (three integers per client, not one log entry
per request) while still avoiding the fixed-window boundary-burst flaw. It
estimates the rolling count as `previousCount * weight + currentCount`, where
`weight` is the fraction of the previous window that still overlaps the rolling
window. See `src/algorithms/slidingWindowCounter.js`; covered by tests including
a boundary-smoothing test that proves it does NOT hand out a fresh full limit at
the window edge the way fixed window does.

### Optional stretch (if you have time)
- Per-client config via a `/rules` endpoint stored in Redis.
- Prometheus `/metrics` endpoint + a tiny live dashboard.

---

## Run it

```bash
# Local dev (Redis in Docker, service on host)
docker compose up redis -d
npm install
npm run dev

# Full distributed setup (Redis + 2 instances)
docker compose up --build

# Tests
npm test

# Benchmark
npm run bench
```

## API

`POST /check`
```json
{ "clientId": "user-123", "algorithm": "tokenbucket" }
```
Returns `200 {allowed:true,...}` or `429 {allowed:false,...}`.
Algorithms: `tokenbucket`, `fixedwindow`, `slidinglog`, `slidingcounter`.

---

## Resume bullets (fill in YOUR real numbers after Phase 6)

- Built a **distributed rate-limiting service** (Node.js, Redis) with four
  pluggable algorithms (token bucket, fixed window, sliding window log, and a
  sliding-window-counter hybrid), enforcing a single global limit across
  multiple stateless instances.
- Guaranteed **atomic check-and-decrement under concurrency** using Redis Lua
  scripts, eliminating race conditions verified by parallel-request tests.
- Sustained **~___ req/sec with p99 latency under ___ ms** (measured via
  autocannon load tests); containerized with Docker Compose and CI via GitHub Actions.

> ⚠️ Only claim numbers you actually measured. Interviewers will ask.
```
