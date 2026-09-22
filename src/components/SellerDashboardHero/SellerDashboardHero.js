import React, { useMemo } from 'react';
import classNames from 'classnames';

import { formatMoney } from '../../util/currency';
import { useIntl } from '../../util/reactIntl';
import { types as sdkTypes } from '../../util/sdkLoader';

import css from './SellerDashboardHero.module.css';

// XOLOLO F3 · Fase 1: dashboard hero para el seller en /inbox/sales.
//
// Se monta encima de la lista de tx e incluye:
//   - 4 KPI cards: ventas del mes / pedidos activos / entregados 30d / alertas
//   - Sección "Requiere tu acción" con hasta 5 tx que necesitan algo del seller
//
// Todo se calcula CLIENT-SIDE sobre las `transactions` que InboxPage ya
// cargó (paginación → sólo la página actual, no todo el historial). Esa
// limitación se comunica al seller con el hint "de tus últimas N ventas".
// La Fase 3 elevará estos KPIs a queries agregadas via Integration API.

const { Money } = sdkTypes;

// ---------- helpers de agrupación por estado ----------

// Estados considerados "activos" (post-pago, pre-entrega).
const ACTIVE_TRANSITIONS = new Set([
  'transition/confirm-payment',
  'transition/mark-preparing',
]);

const isDelivered = tx => {
  const transitions = tx?.attributes?.transitions || [];
  if (transitions.some(t => t.transition === 'transition/mark-received')) return true;
  const trackingEvents = tx?.attributes?.metadata?.xololoShippingTrackingEvents || [];
  return trackingEvents.some(e => e.status === 'delivered');
};

const isDeliveredInLast30Days = tx => {
  if (!isDelivered(tx)) return false;
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const transitions = tx?.attributes?.transitions || [];
  const deliveredTx = transitions.find(t => t.transition === 'transition/mark-received');
  if (deliveredTx?.createdAt) {
    return new Date(deliveredTx.createdAt).getTime() >= cutoff;
  }
  const trackingEvents = tx?.attributes?.metadata?.xololoShippingTrackingEvents || [];
  const deliveredEvt = trackingEvents.find(e => e.status === 'delivered');
  if (deliveredEvt?.receivedAt) {
    return new Date(deliveredEvt.receivedAt).getTime() >= cutoff;
  }
  return false;
};

const isActive = tx => {
  if (isDelivered(tx)) return false;
  const meta = tx?.attributes?.metadata || {};
  if (meta.xololoDispute) return false;
  const state = tx?.attributes?.state;
  if (state === 'canceled' || state === 'refunded') return false;
  // Cualquier tx no entregada, no cancelada, con al menos un pago
  // confirmado cuenta como activa.
  const transitions = tx?.attributes?.transitions || [];
  return transitions.some(t => ACTIVE_TRANSITIONS.has(t.transition));
};

const isPaidThisMonth = tx => {
  const transitions = tx?.attributes?.transitions || [];
  const paidTx = transitions.find(t => t.transition === 'transition/confirm-payment');
  if (!paidTx?.createdAt) return false;
  const d = new Date(paidTx.createdAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

// ---------- alertas: cosas que requieren acción del seller ----------

const alertsFor = tx => {
  const meta = tx?.attributes?.metadata || {};
  const pd = tx?.attributes?.protectedData || {};
  const shipping = pd.xololoShipping || {};
  const alerts = [];

  // Disputa abierta
  if (meta.xololoDispute) {
    alerts.push({ code: 'dispute', label: 'Disputa abierta', severity: 'high' });
  }

  // Sólo aplica a shipping carrier con rate elegido y todavía sin guía
  const needsGuide =
    shipping.mode === 'carrier' &&
    shipping.rate?.id &&
    !meta.xololoShippingGuide?.shipmentId &&
    !isDelivered(tx);

  const sosPhotos = meta.xololoShippingSosPhotos || {};
  const sosSlots = ['producto', 'embalado', 'guia', 'medidas', 'peso'];
  const sosCount = sosSlots.filter(k => sosPhotos[k]).length;

  if (needsGuide && sosCount < 5) {
    alerts.push({
      code: 'sos_pending',
      label: `Faltan ${5 - sosCount} fotos SOS`,
      severity: 'medium',
    });
  }
  if (needsGuide && sosCount === 5) {
    alerts.push({ code: 'label_pending', label: 'Genera la guía', severity: 'high' });
  }

  // Pickup pending: modo pickup, la orden fue pagada, aún sin código verificado.
  if (shipping.mode === 'pickup' && shipping.pickupCode?.code && !shipping.pickupCode.verifiedAt) {
    if (!isDelivered(tx)) {
      alerts.push({ code: 'pickup_pending', label: 'Recolección pendiente', severity: 'low' });
    }
  }

  return alerts;
};

// ---------- suma de payin total ----------

const sumPayin = txs => {
  let currency = 'MXN';
  let total = 0;
  for (const tx of txs) {
    const payin = tx?.attributes?.payinTotal;
    if (payin?.amount) {
      total += payin.amount;
      currency = payin.currency || currency;
    }
  }
  return { amount: total, currency };
};

// ---------- KPI Card ----------

const KpiCard = ({ label, value, hint, tone, icon }) => (
  <div className={classNames(css.kpi, tone && css[`kpi--${tone}`])}>
    <div className={css.kpiIcon} aria-hidden>
      {icon}
    </div>
    <div className={css.kpiBody}>
      <p className={css.kpiLabel}>{label}</p>
      <p className={css.kpiValue}>{value}</p>
      {hint ? <p className={css.kpiHint}>{hint}</p> : null}
    </div>
  </div>
);

// ---------- componente principal ----------

const SellerDashboardHero = ({ transactions, className }) => {
  const intl = useIntl();

  const {
    salesMonth,
    activeCount,
    deliveredCount,
    alertCount,
    alertList,
  } = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    const paidThisMonth = txs.filter(isPaidThisMonth);
    const active = txs.filter(isActive);
    const delivered30 = txs.filter(isDeliveredInLast30Days);

    // Sumar payin sólo de las pagadas este mes.
    const salesMoney = sumPayin(paidThisMonth);
    const salesMoneyObj = salesMoney.amount > 0
      ? new Money(salesMoney.amount, salesMoney.currency)
      : null;

    // Recolectar alertas.
    const alertList = [];
    let alertCount = 0;
    for (const tx of txs) {
      const alerts = alertsFor(tx);
      if (alerts.length === 0) continue;
      alertCount += alerts.length;
      alertList.push({ tx, alerts });
    }
    // Prioridad: high antes que medium antes que low, luego más recientes primero.
    const sevRank = { high: 3, medium: 2, low: 1 };
    alertList.sort((a, b) => {
      const maxA = Math.max(...a.alerts.map(x => sevRank[x.severity] || 0));
      const maxB = Math.max(...b.alerts.map(x => sevRank[x.severity] || 0));
      if (maxA !== maxB) return maxB - maxA;
      return (
        new Date(b.tx?.attributes?.lastTransitionedAt || 0).getTime() -
        new Date(a.tx?.attributes?.lastTransitionedAt || 0).getTime()
      );
    });

    return {
      salesMonth: salesMoneyObj,
      activeCount: active.length,
      deliveredCount: delivered30.length,
      alertCount,
      alertList: alertList.slice(0, 5),
    };
  }, [transactions]);

  const noData = !transactions || transactions.length === 0;
  if (noData) return null;

  return (
    <section className={classNames(css.root, className)}>
      <div className={css.kpiGrid}>
        <KpiCard
          icon="💰"
          tone="revenue"
          label="Ventas este mes"
          value={salesMonth ? formatMoney(intl, salesMonth) : '—'}
          hint={salesMonth ? null : 'Aún sin ventas confirmadas este mes'}
        />
        <KpiCard
          icon="📦"
          tone="active"
          label="Pedidos activos"
          value={String(activeCount)}
          hint={activeCount === 0 ? 'Todo entregado' : 'Pagados y sin entregar'}
        />
        <KpiCard
          icon="✅"
          tone="delivered"
          label="Entregados 30d"
          value={String(deliveredCount)}
        />
        <KpiCard
          icon={alertCount > 0 ? '⚠️' : '👍'}
          tone={alertCount > 0 ? 'alert' : 'ok'}
          label="Requiere acción"
          value={String(alertCount)}
          hint={alertCount === 0 ? 'Sin pendientes' : 'Fotos, guías o disputas'}
        />
      </div>

      {alertList.length > 0 ? (
        <div className={css.alertsBlock}>
          <h4 className={css.alertsTitle}>Requiere tu acción</h4>
          <ul className={css.alertsList}>
            {alertList.map(({ tx, alerts }) => {
              const listingTitle = tx?.listing?.attributes?.title || 'Producto';
              const buyerName = tx?.customer?.attributes?.profile?.displayName || 'Comprador';
              const txUrl = `/sale/${tx.id.uuid}/details`;
              return (
                <li key={tx.id.uuid} className={css.alertItem}>
                  <a href={txUrl} className={css.alertLink}>
                    <div className={css.alertMain}>
                      <p className={css.alertListing}>{listingTitle}</p>
                      <p className={css.alertBuyer}>{buyerName}</p>
                    </div>
                    <div className={css.alertChips}>
                      {alerts.map(a => (
                        <span
                          key={a.code}
                          className={classNames(css.chip, css[`chip--${a.severity}`])}
                        >
                          {a.label}
                        </span>
                      ))}
                    </div>
                    <span className={css.alertArrow} aria-hidden>
                      →
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className={css.alertsHint}>
            Cálculo sobre tus últimas {transactions.length} ventas cargadas.
          </p>
        </div>
      ) : null}
    </section>
  );
};

export default SellerDashboardHero;
