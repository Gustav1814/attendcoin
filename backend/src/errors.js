export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CHAIN_DOWN_CODES = new Set(["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "ECONNREFUSED"]);

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON" } });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large" } });
  }
  if (CHAIN_DOWN_CODES.has(err.code) || CHAIN_DOWN_CODES.has(err.cause?.code)) {
    return res.status(502).json({ error: { code: "chain_unavailable", message: "Could not reach the blockchain node" } });
  }

  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
}
