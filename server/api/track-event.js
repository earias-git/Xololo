// XOLOLO F3 · Sprint 2: recibe eventos de tracking del cliente y los
// encola. Fire-and-forget desde el cliente — respondemos 200 inmediato.
//
// Contrato:
//   POST /api/track/event
//   Body: {
//     event: 'listing.viewed' | 'listing.added_to_cart' |
//            'checkout.started' | 'listing.shared_external',
//     listingId: uuid,
//     source: 'direct' | 'xololo' | 'seller_store' | ...
//     channel?: 'whatsapp' | 'facebook' | ... (para shared_external),
//     sessionId: string,
//   }
//   200 → { ok: true, queued: true }
//   400 → { error: 'invalid_request' | 'invalid_event' }
//   429 → { error: 'rate_limited' }
//
// Auth: público (buyer no autenticado también trackea).
// Rate-limit: ventana deslizante de 60s con máximo 60 events por IP.
// Bot filter: user-agent regex — bots comunes se rechazan silente.

const {
  enqueue,
  VALID_EVENTS,
} = require('../api-util/trackingQueue');

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60s
const RATE_LIMIT_MAX = 60;

// Map<ip, timestamps[]>. Cada request añade su timestamp y filtra los
// que salieron de la ventana. En serverless cada réplica tiene su propio
// mapa — aceptable en v1 (Render corre 1 instancia por servicio).
const rateHits = new Map();
const MAX_RATE_MAP = 5000; // fusible

const checkRateLimit = ip => {
  const now = Date.now();
  const arr = rateHits.get(ip) || [];
  // Filtra timestamps viejos.
  const fresh = arr.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  if (rateHits.size >= MAX_RATE_MAP) {
    // Purge oldest key (Map preserva insertion order).
    const oldest = rateHits.keys().next().value;
    if (oldest) rateHits.delete(oldest);
  }
  rateHits.set(ip, fresh);
  return true;
};

// Filtro simple de bots por user-agent. No es perfecto pero limpia el
// ruido más obvio (Googlebot, Bingbot, scrapers). Bots sofisticados
// falsean UA — para eso está el rate-limit.
const BOT_UA_REGEX = /(bot|crawler|spider|slurp|fetch|preview|scraper|monitor|link ?checker|prerender|headless)/i;

const isBot = req => {
  const ua = req.headers['user-agent'] || '';
  return BOT_UA_REGEX.test(ua);
};

const getIp = req => {
  // Render sitting behind Cloudflare — el header confiable es
  // cf-connecting-ip. Fallback a x-forwarded-for o remoteAddress.
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
};

module.exports = (req, res) => {
  try {
    if (isBot(req)) {
      // 200 silente — no queremos que un bot marque nuestro endpoint como fallido.
      return res.status(200).json({ ok: true, skipped: 'bot' });
    }

    const ip = getIp(req);
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    const { event, listingId, source, channel, sessionId } = req.body || {};

    if (!event || typeof event !== 'string' || !VALID_EVENTS.has(event)) {
      return res.status(400).json({ error: 'invalid_event' });
    }
    if (!listingId || typeof listingId !== 'string' || listingId.length < 8) {
      return res.status(400).json({ error: 'invalid_request', details: 'listingId requerido.' });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'sessionId requerido.' });
    }
    if (event === 'listing.shared_external' && !channel) {
      return res.status(400).json({ error: 'invalid_request', details: 'channel requerido para shared_external.' });
    }

    const result = enqueue({
      event,
      listingId,
      source: source || 'direct',
      channel: channel || null,
      sessionId,
      ip: ip.slice(0, 32), // truncado, para debugging futuro sin acumular PII
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.reason || 'enqueue_failed' });
    }
    return res.status(200).json({ ok: true, queued: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[track-event] unexpected:', e?.message);
    // Silencioso: no queremos que el cliente vea nunca un error de tracking.
    return res.status(200).json({ ok: false, error: 'internal' });
  }
};
