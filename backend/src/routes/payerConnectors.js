import express from "express";
import { listPayerConnectors } from "../services/payerGateway.js";
import {
  listStediPayers,
  searchStediPayers
} from "../services/stediTestConnector.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ connectors: listPayerConnectors() });
});

router.get("/stedi/payers", async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize || 25);
    const query = String(req.query.query || "").trim();

    const result = query
      ? await searchStediPayers({
          query,
          pageSize: Number.isFinite(pageSize) ? pageSize : 25
        })
      : await listStediPayers({
          pageSize: Number.isFinite(pageSize) ? pageSize : 25
        });

    res.json(result);
  } catch (error) {
    console.error("[payer-connectors] Stedi payer lookup failed", {
      code: error?.code || null
    });

    if (error?.code === "PAYER_CONNECTOR_UNAVAILABLE") {
      return res.status(503).json({ error: "Stedi test connector is not configured" });
    }
    if (error?.code === "STEDI_API_ERROR") {
      return res.status(502).json({ error: "Stedi payer-network request failed" });
    }
    throw error;
  }
});

export default router;
