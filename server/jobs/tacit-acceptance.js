// XOLOLO: job de afirmativa ficta (docs/LOGISTICS_V1.md §4).
// Corre cada hora. Busca transacciones "entregadas" hace más de 48h
// que NO tienen review ni disputa (xololoBuyerReview + xololoDispute
// vacíos), y persiste acceptanceProof.type='tacit' con timestamp.
//
// En v2 disparará también la transition/complete que libera fondos
// al seller vía Stripe Connect. Por ahora sólo persistimos el flag
// para dejar la evidencia lista.
//
// Se llama desde server/index.js con:
//   const { start } = require('./jobs/tacit-acceptance');
//   start();
//
// El scheduler es simple setInterval — no depende de infra externa.
// Si el server se reinicia, el próximo tick sigue del último punto
// (no hay estado que perder — es idempotente).

const sharetribeSdkIntegration = require('sharetribe-flex-integration-sdk');

const TACIT_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const RUN_EVERY_MS = 60 * 60 * 1000; // cada hora

let integrationSdk = null;
const getIntegrationSdk = () => {
  if (integrationSdk) return integrationSdk;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  integrationSdk = sharetribeSdkIntegration.createInstance({ clientId, clientSecret });
  return integrationSdk;
};

// Detecta cuándo fue entregada una tx. Preferimos el evento del
// webhook Skydropx (status 'delivered'); fallback: transición
// mark-delivered en Sharetribe.
const findDeliveryTimestamp = tx => {
  const events = tx.attributes.metadata?.xololoShippingTrackingEvents || [];
  const deliveredEvt = events.find(e => e.status === 'delivered');
  if (deliveredEvt?.receivedAt) return deliveredEvt.receivedAt;

  const transitions = tx.attributes.transitions || [];
  const deliveredTx = transitions.find(t => t.transition === 'transition/mark-delivered');
  return deliveredTx?.createdAt || null;
};

// Un tick del job: busca candidatos y aplica la afirmativa ficta a
// los que califiquen. Se puede llamar manual también (para pruebas).
const runTick = async () => {
  const sdk = getIntegrationSdk();
  if (!sdk) return { skipped: 'integration_api_not_configured', processed: 0 };

  const now = Date.now();
  let processed = 0;
  let inspected = 0;

  // Iteramos hasta 500 transacciones recientes. Aceptable para v1;
  // migrar a un query filtrado por metadata específico si escala.
  for (let page = 1; page <= 5; page++) {
    let resp;
    try {
      resp = await sdk.transactions.query({ page, perPage: 100 });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[tacit-acceptance] query falló:', e.message);
      break;
    }
    const list = resp.data.data || [];
    if (list.length === 0) break;

    for (const tx of list) {
      inspected += 1;
      const meta = tx.attributes.metadata || {};
      if (meta.xololoAcceptanceProof) continue; // ya procesada
      if (meta.xololoBuyerReview) continue; // ya hubo review explícita
      if (meta.xololoDispute) continue; // hay disputa abierta

      const deliveredAt = findDeliveryTimestamp(tx);
      if (!deliveredAt) continue; // aún no entregada

      const deliveredMs = new Date(deliveredAt).getTime();
      if (!Number.isFinite(deliveredMs)) continue;
      if (now - deliveredMs < TACIT_WINDOW_MS) continue; // menos de 48h

      // Aplicar afirmativa ficta.
      const nowIso = new Date(now).toISOString();
      const acceptanceProof = {
        type: 'tacit',
        deliveredAt,
        acceptedAt: nowIso,
        method: 'tacit_acceptance_cron',
        windowMs: TACIT_WINDOW_MS,
      };
      try {
        await sdk.transactions.updateMetadata({
          id: tx.id.uuid,
          metadata: { xololoAcceptanceProof: acceptanceProof },
        });
        processed += 1;
        // eslint-disable-next-line no-console
        console.log(
          `[tacit-acceptance] ✓ tx ${tx.id.uuid} entregada ${new Date(
            deliveredAt
          ).toISOString()} → afirmativa ficta aplicada`
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[tacit-acceptance] updateMetadata falló para tx ${tx.id.uuid}:`,
          e.message
        );
      }
    }

    if (resp.data.meta?.totalPages <= page) break;
  }

  return { inspected, processed };
};

let intervalHandle = null;

const start = () => {
  if (intervalHandle) return; // idempotente
  // Primer tick a los 5 min de arrancado (evita spike al deploy).
  const initialDelayMs = 5 * 60 * 1000;
  setTimeout(() => {
    runTick().then(r => {
      // eslint-disable-next-line no-console
      console.log('[tacit-acceptance] first tick:', r);
    });
    intervalHandle = setInterval(() => {
      runTick().then(r => {
        // eslint-disable-next-line no-console
        console.log('[tacit-acceptance] tick:', r);
      });
    }, RUN_EVERY_MS);
  }, initialDelayMs);
};

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = { start, stop, runTick };
