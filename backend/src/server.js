import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { loadConfig } from "./config.js";
import { createChain } from "./chain.js";
import { openStore } from "./store.js";
import { requireAdmin } from "./auth.js";
import { errorHandler, notFound } from "./errors.js";
import { metaRoutes } from "./routes/meta.js";
import { checkinRoutes } from "./routes/checkins.js";
import { profileRoutes } from "./routes/profiles.js";
import { courseRoutes } from "./routes/courses.js";

const unixNow = () => Math.floor(Date.now() / 1000);

export function createApp({
  chain,
  store,
  salt,
  frontendOrigins = ["http://localhost:5173"],
  nowSeconds = unixNow,
  checkinLimit = 120,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: frontendOrigins }));
  app.use(express.json({ limit: "16kb" }));

  // A whole classroom can share one campus NAT address and scan within
  // seconds of each other, so this is a flood guard rather than a tight cap.
  const rateLimiter = rateLimit({
    windowMs: 60_000,
    limit: checkinLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ error: { code: "rate_limited", message: "Too many check-ins, try again shortly" } }),
  });

  const admin = requireAdmin(chain);
  const api = express.Router();
  api.use(metaRoutes({ chain }));
  api.use(checkinRoutes({ chain, store, nowSeconds, rateLimiter }));
  api.use(profileRoutes({ store, salt, requireAdmin: admin }));
  api.use(courseRoutes({ chain, store, requireAdmin: admin }));

  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

async function start() {
  const config = loadConfig();
  const chain = createChain(config);
  const store = await openStore(config.dataDir);

  try {
    await chain.verifyDeployment();
  } catch (err) {
    console.warn(`Warning: ${err.message}`);
  }

  const app = createApp({ chain, store, salt: config.salt, frontendOrigins: config.frontendOrigins });
  const server = app.listen(config.port, () => {
    console.log(`AttendCoin API on http://localhost:${config.port}/api (${config.network}, chain ${chain.chainId})`);
  });

  const shutdown = () => {
    server.close(async () => {
      await store.flush();
      chain.provider.destroy();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
