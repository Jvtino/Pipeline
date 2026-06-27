// Pipeline hosted API (Fastify). Phase 2 slice: serves the derived board from
// demo data so the web app runs end to end. Real OAuth connect, per-user
// persistence (Postgres), encrypted tokens, and incremental sync come next
// (plan §8/§10). The contract is validated on the way out — the API never
// ships a shape the rest of the system can't trust.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { boardSchema } from "@pipeline/contracts";
import { buildBoard } from "./applications";
import { DEMO_THREADS } from "./demo-data";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, service: "pipeline-api" }));

  app.get("/api/applications", async () => {
    // Validate our own output against the shared contract before returning it.
    return boardSchema.parse(buildBoard(DEMO_THREADS, "demo"));
  });

  return app;
}

// Only start a listener when run directly (so tests can import buildServer()).
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3001);
  const app = buildServer();
  app
    .listen({ port, host: "0.0.0.0" })
    .then(() => app.log.info(`Pipeline API ready on http://localhost:${port}/api/applications`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
