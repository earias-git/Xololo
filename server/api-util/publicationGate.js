// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.3, roadmap #6): gate de
// publicación — cierra/reabre los listings de un seller según si su
// suscripción está activa.
//
// Decisión de diseño: reusa el mecanismo NATIVO de Sharetribe
// (listing.state 'published'/'closed') en vez de un flag custom +
// filtro de búsqueda. Ventajas:
//   - SearchPage y el storefront ({slug}.xololo.mx) ya excluyen
//     listings 'closed' automáticamente — es el comportamiento
//     estándar de `sdk.listings.query()` de la Marketplace API, cero
//     cambios de frontend.
//   - ListingPage ya maneja bien el estado 'closed' para un
//     comprador que llega por link directo (deshabilita la compra,
//     `noIndex` para SEO, sin 404) — también cero cambios.
//   - La alternativa (publicData.xololoPublishable + filtro pub_/meta_
//     en la búsqueda) hubiera requerido habilitar el campo "for
//     search" a mano en Sharetribe Console antes de que funcionara.
//
// Se llama SIEMPRE que xololoSubscription.status cruza la frontera
// activo/no-activo (ver syncSubscriptionMetadata en stripeBilling.js)
// — NO hace un "barrido" retroactivo de sellers que nunca tocaron el
// sistema de suscripción (docs §3.4: sin retroactividad, aplica desde
// cero a partir del lanzamiento). Tampoco bloquea el primer publish de
// un seller que jamás se suscribió — eso requeriría interceptar el
// flujo de alta/publish en ManageListingsPage, fuera de este alcance
// (ver nota en docs §3.3/roadmap).
//
// Distingue "cerrado por Xololo" de "cerrado por el seller a
// propósito" vía listing.attributes.metadata.xololoGatedClosed — al
// reactivar sólo reabre los que XOLOLO cerró, nunca uno que el seller
// cerró por su cuenta (agotado, pausado, etc).
//
// ADR-007 PR 2 (2026-11-23) — fuente de verdad server-side de los
// status Stripe que mantienen un seller publicable. Debe espejar el
// listado del cliente en src/util/xololoCanPublish.js:
// PUBLISHABLE_STATUSES = ['active','trialing','past_due']. En el
// server los status internos ya mapean trialing→'active' (ver
// STRIPE_TO_XOLOLO_STATUS), así que aquí viven sólo 'active' y
// 'past_due' — past_due es LA ventana de gracia de ADR-007.
// LOCKED: no mover esta lista sin actualizar ADR-007.

const PUBLISHABLE_INTERNAL_STATUSES = ['active', 'past_due'];

const isPublishableStatus = status => PUBLISHABLE_INTERNAL_STATUSES.includes(status);

// ADR-007 PR 2 — defensa: casual_reseller está exento del gate de
// suscripción por diseño fiscal (Art. 9 IV LIVA; no paga sub). En
// práctica un casual nunca recibirá un webhook de Stripe sub porque
// no se suscribe, pero si por algún camino raro (importación, data
// migration) llegara aquí, nunca cerramos sus listings.

const PER_PAGE = 100;
const MAX_PAGES = 20; // hasta 2000 listings por seller — holgado para v1

const applyPublicationGate = async ({ isdk, sellerId, shouldBeVisible }) => {
  let closedCount = 0;
  let reopenedCount = 0;

  try {
    const userResp = await isdk.users.show({ id: sellerId });
    const sellerMode = userResp.data.data?.attributes?.profile?.publicData?.sellerMode;
    if (sellerMode === 'casual_reseller') {
      // eslint-disable-next-line no-console
      console.log(`[publicationGate] ${sellerId} es casual_reseller — exento del gate`);
      return { closedCount: 0, reopenedCount: 0, skipped: 'casual_reseller' };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[publicationGate] no se pudo leer sellerMode de ${sellerId}:`, e?.message);
    // Fallback: seguimos con el gate. Es "fail-close" — mejor cerrar
    // de más que dejar un canceled publicando.
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await isdk.listings.query({
      authorId: sellerId,
      states: ['published', 'closed'],
      page,
      perPage: PER_PAGE,
    });
    const listings = resp.data.data || [];

    for (const listing of listings) {
      const state = listing.attributes.state;
      const gatedClosed = listing.attributes.metadata?.xololoGatedClosed === true;

      if (!shouldBeVisible && state === 'published') {
        // eslint-disable-next-line no-await-in-loop
        await isdk.listings.close({ id: listing.id });
        // eslint-disable-next-line no-await-in-loop
        await isdk.listings.update({ id: listing.id, metadata: { xololoGatedClosed: true } });
        closedCount += 1;
      } else if (shouldBeVisible && state === 'closed' && gatedClosed) {
        // eslint-disable-next-line no-await-in-loop
        await isdk.listings.open({ id: listing.id });
        // eslint-disable-next-line no-await-in-loop
        await isdk.listings.update({ id: listing.id, metadata: { xololoGatedClosed: false } });
        reopenedCount += 1;
      }
    }

    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  return { closedCount, reopenedCount };
};

module.exports = {
  applyPublicationGate,
  PUBLISHABLE_INTERNAL_STATUSES,
  isPublishableStatus,
};
