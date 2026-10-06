// Helpers for turning internal errors into client-safe API responses.
// The full message is logged server-side; the client gets the same
// message with local filesystem paths redacted.

function publicMessage(err) {
  const raw = err && err.message ? err.message : String(err || 'Internal error');
  let msg = String(raw);
  const home = process.env.HOME;
  if (home) msg = msg.split(home).join('~');
  return msg.slice(0, 500);
}

function sendError(res, status, err) {
  console.error('[api]', err && err.message ? err.message : err);
  res.status(status).json({ error: publicMessage(err) });
}

module.exports = { publicMessage, sendError };
