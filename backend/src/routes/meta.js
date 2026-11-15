import { Router } from "express";

export function metaRoutes({ chain }) {
  const router = Router();

  router.get("/health", async (req, res) => {
    try {
      const [chainId, blockNumber] = await Promise.all([
        chain.provider.send("eth_chainId", []),
        chain.provider.getBlockNumber(),
      ]);
      res.json({ ok: Number(chainId) === chain.chainId, chainId: Number(chainId), blockNumber });
    } catch {
      res.status(503).json({ ok: false, chainId: chain.chainId, blockNumber: null });
    }
  });

  router.get("/config", (req, res) => {
    res.json({ chainId: chain.chainId, contracts: chain.contracts, eip712Domain: chain.domain });
  });

  return router;
}
