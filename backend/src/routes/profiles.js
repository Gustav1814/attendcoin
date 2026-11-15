import { Router } from "express";
import { HttpError } from "../errors.js";
import { idHashFor } from "../identity.js";
import { address, parse, profileBody, walletList } from "../validation.js";

const publicView = ({ wallet, name }) => ({ wallet, name });

export function profileRoutes({ store, salt, requireAdmin }) {
  const router = Router();

  router.post("/profiles", requireAdmin, async (req, res) => {
    const { wallet, name, rollNumber, email } = parse(profileBody, req.body, "body");
    const idHash = idHashFor(salt, rollNumber);
    const key = wallet.toLowerCase();

    const created = await store.update((state) => {
      const owner = Object.values(state.profiles).find((p) => p.idHash === idHash);
      if (owner && owner.wallet !== wallet) {
        throw new HttpError(409, "roll_number_taken", `Roll number is already linked to ${owner.wallet}`);
      }
      const existing = state.profiles[key];
      const now = new Date().toISOString();
      state.profiles[key] = {
        wallet,
        name,
        rollNumber,
        ...(email && { email }),
        idHash,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return !existing;
    });

    res.status(created ? 201 : 200).json({ wallet, idHash });
  });

  router.get("/profiles", (req, res) => {
    if (req.query.wallets === undefined) {
      throw new HttpError(400, "validation_failed", "wallets: query parameter is required");
    }
    const wallets = parse(walletList, String(req.query.wallets), "wallets");
    const { profiles } = store.read();
    res.json({
      profiles: wallets.map((wallet) => profiles[wallet.toLowerCase()]).filter(Boolean).map(publicView),
    });
  });

  router.get("/profiles/:wallet", (req, res) => {
    const wallet = parse(address, req.params.wallet, "wallet");
    const profile = store.read().profiles[wallet.toLowerCase()];
    if (!profile) throw new HttpError(404, "profile_not_found", "No profile for this wallet");
    res.json(publicView(profile));
  });

  router.get("/admin/profiles", requireAdmin, (req, res) => {
    res.json({ profiles: Object.values(store.read().profiles) });
  });

  return router;
}
