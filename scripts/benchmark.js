import autocannon from "autocannon";

/**
 * Load test the /check endpoint to get your resume metrics:
 *   - requests/sec (throughput)
 *   - p99 latency
 *
 * Run the service first (npm start, or docker compose up), then: npm run bench
 * Point URL at a single instance (:3000) or your load balancer.
 *
 * RECORD THE NUMBERS IT PRINTS — those become your resume bullet.
 */

const url = process.env.BENCH_URL || "http://localhost:3000/check";

const instance = autocannon(
  {
    url,
    method: "POST",
    headers: { "content-type": "application/json" },
    // Vary clientId a bit so you're not always hitting one hot key.
    body: JSON.stringify({ clientId: "bench-client", algorithm: "tokenbucket" }),
    connections: 50, // concurrent connections
    duration: 20, // seconds
  },
  (err, result) => {
    if (err) {
      console.error("benchmark error:", err);
      process.exit(1);
    }
    console.log("\n=== RESULTS (put these on your resume) ===");
    console.log(`Requests/sec (avg): ${result.requests.average}`);
    console.log(`Latency p99: ${result.latency.p99} ms`);
    console.log(`Latency avg: ${result.latency.average} ms`);
    console.log(`Total 2xx: ${result["2xx"]}, 429s: ${result.non2xx}`);
  }
);

autocannon.track(instance, { renderProgressBar: true });
