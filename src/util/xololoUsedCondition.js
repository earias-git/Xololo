// XOLOLO: niveles de estado para listings de segunda mano.
//
// Se persiste en `listing.publicData.usedCondition` cuando
// `listing.publicData.condition === 'used'`. La escala viene de las
// convenciones comunes de marketplaces de segunda mano (Mercado Libre
// Usados, Facebook Marketplace, eBay) para no confundir al buyer.
//
// Nota legal / de producto: TODOS los productos de segunda mano se
// venden "como usados" (as-is). El buyer compra conociendo el nivel
// declarado por el vendedor; cualquier aclaración se resuelve con el
// vendedor directamente. Xololo recomienda revisar bien el producto
// al recibirlo. Este disclaimer vive en xololoUsedCondition.NOTICE para
// renderizarse donde el buyer lo vea (ListingPage, confirmación de
// pedido, email de entrega).

export const USED_CONDITIONS = {
  LIKE_NEW: 'like_new',
  VERY_GOOD: 'very_good',
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
};

export const USED_CONDITION_OPTIONS = [
  {
    key: USED_CONDITIONS.LIKE_NEW,
    label: 'Como nuevo — sin uso o con mínimas marcas',
  },
  {
    key: USED_CONDITIONS.VERY_GOOD,
    label: 'Muy buen estado — poco uso, funciona perfecto',
  },
  {
    key: USED_CONDITIONS.GOOD,
    label: 'Buen estado — uso normal, detalles cosméticos menores',
  },
  {
    key: USED_CONDITIONS.FAIR,
    label: 'Estado regular — se nota el uso, pero funciona',
  },
  {
    key: USED_CONDITIONS.POOR,
    label: 'Muy mal estado — para refacciones o restaurar',
  },
];

export const NOTICE =
  'Los productos de segunda mano se venden "como usados" (as-is). ' +
  'El vendedor declara el nivel de estado; cualquier aclaración o duda ' +
  'resuélvela directamente con quien vende. Al recibir el producto ' +
  'revísalo bien antes de aceptarlo.';

export const getUsedConditionLabel = key => {
  const opt = USED_CONDITION_OPTIONS.find(o => o.key === key);
  return opt ? opt.label : null;
};
