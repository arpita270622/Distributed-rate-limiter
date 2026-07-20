// Home page served at GET "/". It's a live demo: the buttons fire real
// requests at this service's own /check endpoint and show the allow/deny
// decisions streaming in, so a visitor immediately sees the limiter working.
export const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Distributed Rate Limiter</title>
<style>
  :root {
    --bg: #0b0f14;
    --panel: #121820;
    --panel-2: #0f141b;
    --line: #1e2732;
    --text: #e6edf3;
    --muted: #8b98a5;
    --allow: #3fb950;
    --deny: #f85149;
    --accent: #58a6ff;
    --mono: ui-monospace, "Cascadia Code", "JetBrains Mono", "SF Mono", Menlo, monospace;
    --sans: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: var(--sans); line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-weight: 600; letter-spacing: .5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--allow); box-shadow: 0 0 0 0 rgba(63,185,80,.6); animation: pulse 2s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(63,185,80,.5)} 70%{box-shadow:0 0 0 8px rgba(63,185,80,0)} 100%{box-shadow:0 0 0 0 rgba(63,185,80,0)} }
  .pill { font-family: var(--mono); font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; }
  h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.1; margin: 40px 0 12px; letter-spacing: -.5px; }
  h1 .em { color: var(--accent); }
  .lede { color: var(--muted); font-size: 18px; max-width: 620px; margin: 0 0 32px; }

  .demo { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .demo-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  .demo-title { font-family: var(--mono); font-size: 13px; color: var(--muted); }
  .bucket { display: flex; gap: 5px; }
  .pip { width: 12px; height: 20px; border-radius: 3px; background: #223; border: 1px solid var(--line); transition: background .15s, border-color .15s; }
  .pip.full { background: var(--allow); border-color: var(--allow); }
  .controls { display: flex; gap: 10px; padding: 16px 18px; flex-wrap: wrap; }
  button {
    font-family: var(--sans); font-size: 14px; font-weight: 600; cursor: pointer;
    background: var(--accent); color: #06121f; border: none; border-radius: 8px; padding: 10px 16px;
  }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
  button:disabled { opacity: .5; cursor: wait; }
  .tally { padding: 0 18px 8px; font-family: var(--mono); font-size: 13px; color: var(--muted); min-height: 20px; }
  .tally b.a { color: var(--allow); } .tally b.d { color: var(--deny); }
  .log { font-family: var(--mono); font-size: 12.5px; padding: 8px 18px 18px; max-height: 240px; overflow-y: auto; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--panel-2); }
  .row .verdict.allow { color: var(--allow); } .row .verdict.deny { color: var(--deny); }
  .row .meta { color: var(--muted); }
  .hint { color: var(--muted); font-size: 12.5px; margin-top: 10px; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 40px; }
  @media (max-width: 640px){ .grid { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
  .card h3 { margin: 0 0 10px; font-size: 14px; letter-spacing: .3px; }
  .card ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 14px; }
  .card li { margin: 3px 0; }
  code { font-family: var(--mono); background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; font-size: 12.5px; color: var(--text); }
  footer { margin-top: 40px; color: var(--muted); font-size: 13px; font-family: var(--mono); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><span class="dot"></span> distributed-rate-limiter</div>
    <div style="display:flex;gap:10px;align-items:center">
      <span class="pill">live</span>
      <a class="pill" href="https://github.com/arpita270622/Distributed-rate-limiter" target="_blank" rel="noopener">GitHub &#8599;</a>
    </div>
  </header>

  <h1>A request comes in.<br>Ten get through. <span class="em">The rest wait.</span></h1>
  <p class="lede">A Redis-backed rate limiter that enforces one shared limit across every server instance,
  decided atomically so two servers can never both allow the last request. Try it live &#8595;</p>

  <div class="demo">
    <div class="demo-head">
      <span class="demo-title">token bucket &middot; capacity 10 &middot; refills 5/sec</span>
      <div class="bucket" id="bucket"></div>
    </div>
    <div class="controls">
      <button id="one">Send 1 request</button>
      <button id="burst" class="ghost">Hammer it (25 at once)</button>
      <button id="reset" class="ghost">Reset log</button>
    </div>
    <div class="tally" id="tally"></div>
    <div class="log" id="log"></div>
    <div class="controls" style="padding-top:0"><span class="hint" id="hint">First request may take ~30s if the server was asleep (free tier). It wakes on the first hit.</span></div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Four algorithms</h3>
      <ul>
        <li>Token bucket (burst-tolerant)</li>
        <li>Fixed window</li>
        <li>Sliding window log (exact)</li>
        <li>Sliding window counter (hybrid, O(1) memory)</li>
      </ul>
    </div>
    <div class="card">
      <h3>Endpoints</h3>
      <ul>
        <li><code>POST /check</code> &rarr; allow or 429</li>
        <li><code>GET /health</code> &rarr; liveness</li>
        <li><code>GET /ready</code> &rarr; Redis reachable</li>
      </ul>
    </div>
    <div class="card">
      <h3>How it stays correct</h3>
      <ul>
        <li>State lives in Redis, not in memory</li>
        <li>Check-and-decrement runs as one atomic Lua script</li>
        <li>Stateless instances, so scaling out is a dial</li>
      </ul>
    </div>
    <div class="card">
      <h3>Built with</h3>
      <ul>
        <li>Node.js, Express, ioredis</li>
        <li>Redis + Lua, Docker, nginx</li>
        <li>Deployed on Render + Upstash</li>
      </ul>
    </div>
  </div>

  <footer>Node.js &middot; Express &middot; Redis &middot; Lua &middot; Docker &middot; nginx</footer>
</div>

<script>
  const clientId = "demo-" + Math.random().toString(36).slice(2, 8);
  const CAP = 10;
  const bucketEl = document.getElementById("bucket");
  const logEl = document.getElementById("log");
  const tallyEl = document.getElementById("tally");
  const hintEl = document.getElementById("hint");
  const btnOne = document.getElementById("one");
  const btnBurst = document.getElementById("burst");
  const btnReset = document.getElementById("reset");

  // Build the bucket pips.
  const pips = [];
  for (let i = 0; i < CAP; i++) {
    const p = document.createElement("div");
    p.className = "pip full";
    bucketEl.appendChild(p);
    pips.push(p);
  }
  function setBucket(remaining) {
    const r = Math.max(0, Math.min(CAP, remaining));
    pips.forEach((p, i) => p.classList.toggle("full", i < r));
  }
  function addRow(status, data) {
    const row = document.createElement("div");
    row.className = "row";
    const allowed = status === 200;
    const time = new Date().toLocaleTimeString();
    row.innerHTML =
      '<span class="verdict ' + (allowed ? "allow" : "deny") + '">' +
      (allowed ? "ALLOWED" : "BLOCKED 429") + "</span>" +
      '<span class="meta">' + (allowed ? "remaining " + (data.remaining ?? "?") : "bucket empty") +
      " &middot; " + time + "</span>";
    logEl.prepend(row);
  }
  async function check() {
    const res = await fetch("/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, algorithm: "tokenbucket" }),
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  }
  function busy(on, label) {
    [btnOne, btnBurst, btnReset].forEach((b) => (b.disabled = on));
    if (on) { hintEl.textContent = label || "Working..."; }
    else { hintEl.textContent = "Tip: hammer it a few times to watch the bucket empty and refill."; }
  }

  btnOne.addEventListener("click", async () => {
    busy(true, "Sending...");
    try {
      const { status, data } = await check();
      addRow(status, data);
      if (status === 200) setBucket(data.remaining);
      else setBucket(0);
    } catch (e) { hintEl.textContent = "Network error: " + e.message; }
    busy(false);
  });

  btnBurst.addEventListener("click", async () => {
    busy(true, "Firing 25 requests at once...");
    try {
      const results = await Promise.all(Array.from({ length: 25 }, check));
      const allowed = results.filter((r) => r.status === 200).length;
      const blocked = results.length - allowed;
      results.forEach((r) => addRow(r.status, r.data));
      setBucket(0);
      tallyEl.innerHTML =
        "Burst of 25 &rarr; <b class='a'>" + allowed + " allowed</b>, <b class='d'>" +
        blocked + " blocked</b>. The shared Redis bucket enforced the cap.";
    } catch (e) { hintEl.textContent = "Network error: " + e.message; }
    busy(false);
  });

  btnReset.addEventListener("click", () => {
    logEl.innerHTML = "";
    tallyEl.innerHTML = "";
    setBucket(CAP);
  });
</script>
</body>
</html>`;