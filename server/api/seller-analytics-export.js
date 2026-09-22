// XOLOLO F3 · Sprint 6: export de ventas a CSV para el seller.
//
// Contrato:
//   GET /api/seller-analytics/export?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Auth: user logueado. Solo trae SUS ventas.
//   200 → text/csv con Content-Disposition: attachment
//   400 → { error: 'invalid_request' }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// Formato: UTF-8 con BOM (﻿) para que Excel MX abra los acentos
// correctamente. Separador coma (,). Campos con coma o comilla se
// entrecomillan con doble comilla y las comillas internas se escapan
// duplicándolas (\", ..." → \",..."").
//
// Columnas (§6.1 del doc):
//   id, fecha_pago, cliente, producto, cantidad, subtotal_mxn,
//   envio_mxn, comision_xololo_mxn, neto_seller_mxn, estado,
//   tracking, source

const { getSdk } = require('../api-util/sdk');

const MAX_PAGES = 5;
const PER_PAGE = 100;

const isValidIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// -------------- CSV helpers --------------

const csvEscape = value => {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const formatMxn = subunits => {
  const n = Number(subunits) || 0;
  return (n / 100).toFixed(2);
};

const formatDateMx = iso => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    // dd/mm/yyyy hh:mm (24h) — sin dependencias, formato mexicano.
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) {
    return '';
  }
};

// Extrae la última transición 'transition/confirm-payment' o
// 'transition/request-payment' como "fecha_pago". Sin eso, cae a
// createdAt de la tx.
const paymentDateOf = tx => {
  const transitions = tx.attributes?.transitions || [];
  const paid =
    transitions.find(t => t.transition === 'transition/confirm-payment') ||
    transitions.find(t => t.transition === 'transition/request-payment');
  return paid?.createdAt || tx.attributes?.createdAt;
};

const humanState = (state, lastTransition) => {
  if (state === 'canceled') return 'Cancelada';
  if (state === 'refunded') return 'Reembolsada';
  const lt = lastTransition || '';
  if (lt.includes('mark-received') || lt.includes('auto-mark-received')) return 'Entregado';
  if (lt.includes('mark-delivered')) return 'Entregado';
  if (lt.includes('mark-preparing')) return 'Preparando';
  if (lt.includes('confirm-payment') || lt.includes('request-payment')) return 'Pagado';
  return state || '';
};

// -------------- fetch --------------

const fetchAllSales = async (sdk, fromDate, toDate) => {
  const all = [];
  let included = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let resp;
    try {
      resp = await sdk.transactions.query({
        only: 'sale',
        page,
        perPage: PER_PAGE,
        include: ['listing', 'customer'],
        'fields.transaction': [
          'createdAt',
          'lastTransitionedAt',
          'state',
          'lastTransition',
          'payinTotal',
          'payoutTotal',
          'lineItems',
          'transitions',
          'metadata',
          'protectedData',
        ],
        'fields.listing': ['title'],
        'fields.user': ['profile.displayName'],
      });
    } catch (e) {
      if (e.status === 400) {
        // Reintentar sin `only:sale`.
        resp = await sdk.transactions.query({
          page,
          perPage: PER_PAGE,
          include: ['listing', 'customer'],
        });
      } else {
        throw e;
      }
    }
    const data = resp.data.data || [];
    included = included.concat(resp.data.included || []);
    for (const tx of data) {
      const ca = tx.attributes?.createdAt ? new Date(tx.attributes.createdAt).getTime() : 0;
      if (ca >= fromDate.getTime() && ca <= toDate.getTime()) {
        all.push(tx);
      }
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
    const oldestInPage = data[data.length - 1]?.attributes?.createdAt;
    if (oldestInPage && new Date(oldestInPage).getTime() < fromDate.getTime()) break;
  }
  return { txs: all, included };
};

// -------------- handler --------------

module.exports = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      return res.status(400).json({ error: 'invalid_request', details: 'from/to deben ser YYYY-MM-DD.' });
    }
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) {
      return res.status(400).json({ error: 'invalid_request', details: 'rango inválido.' });
    }

    const sdk = getSdk(req, res);

    try {
      await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { txs, included } = await fetchAllSales(sdk, fromDate, toDate);

    // Index included por tipo+id.
    const listings = new Map();
    const users = new Map();
    for (const r of included) {
      if (r.type === 'listing') listings.set(r.id.uuid, r);
      else if (r.type === 'user') users.set(r.id.uuid, r);
    }

    // Header.
    const header = [
      'id',
      'fecha_pago',
      'cliente',
      'producto',
      'cantidad',
      'subtotal_mxn',
      'envio_mxn',
      'comision_xololo_mxn',
      'neto_seller_mxn',
      'estado',
      'tracking',
      'source',
    ];

    const rows = [header.join(',')];

    for (const tx of txs) {
      const attrs = tx.attributes || {};
      const lineItems = attrs.lineItems || [];
      const listingId = tx.relationships?.listing?.data?.id?.uuid;
      const customerId = tx.relationships?.customer?.data?.id?.uuid;
      const listing = listings.get(listingId);
      const customer = users.get(customerId);

      // Suma sobre líneas 'line-item/item' (cart multi-item incluido).
      let subtotal = 0;
      let cantidad = 0;
      for (const li of lineItems) {
        if (li.code !== 'line-item/item') continue;
        const incFor = li.includeFor || [];
        if (!incFor.includes('customer') || !incFor.includes('provider')) continue;
        subtotal += li.lineTotal?.amount || 0;
        cantidad += Number(li.quantity) || 0;
      }

      const shipping = lineItems
        .filter(li => li.code === 'line-item/shipping-fee')
        .reduce((s, li) => s + (li.lineTotal?.amount || 0), 0);

      const commission = lineItems
        .filter(li => li.code === 'line-item/provider-commission')
        .reduce((s, li) => s + Math.abs(li.lineTotal?.amount || 0), 0);

      const guide = attrs.metadata?.xololoShippingGuide;
      const tracking = guide?.trackingNumber || '';

      // Source: hoy no lo capturamos en la tx (Sprint 2 lo pone en
      // metadata del listing, no en la tx). Dejamos '' para v1;
      // Sprint 5+ agregará source a la tx si lo necesitamos aquí.
      const source = '';

      const row = [
        tx.id?.uuid || '',
        formatDateMx(paymentDateOf(tx)),
        customer?.attributes?.profile?.displayName || '',
        listing?.attributes?.title || '',
        cantidad,
        formatMxn(subtotal),
        formatMxn(shipping),
        formatMxn(commission),
        formatMxn(attrs.payoutTotal?.amount),
        humanState(attrs.state, attrs.lastTransition),
        tracking,
        source,
      ]
        .map(csvEscape)
        .join(',');

      rows.push(row);
    }

    // BOM ﻿ antes del contenido para que Excel MX detecte UTF-8.
    const body = '﻿' + rows.join('\r\n') + '\r\n';

    const filename = `xololo-ventas-${from}_${to}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(body);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-analytics-export] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
