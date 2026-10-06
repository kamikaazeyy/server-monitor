// Minimal per-IP fixed-window rate limiter for Express routes.
//
// Usage:
//   const { rateLimit } = require('./ratelimit');
//   router.post('/api/x', rateLimit({ windowMs: 60000, max: 3 }), handler);

function rateLimit({ windowMs = 60000, max = 10, message = 'Too many requests' }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (v.resetAt < now) hits.delete(k);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || rec.resetAt < now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
