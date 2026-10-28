import React from 'react';
import classNames from 'classnames';
import { useSelector } from 'react-redux';

import { usePayoutGate } from '../../hooks/usePayoutGate';
import { usePendingPayouts } from '../../hooks/usePendingPayouts';
import NamedLink from '../NamedLink/NamedLink';

import css from './PayoutGateBanner.module.css';

// XOLOLO: formateo rápido MXN sin decimales (centavos → pesos enteros).
// No usamos Intl.NumberFormat con currency porque ese formato prepone
// "MX$" o similar según locale del browser; preferimos "$1,234 MXN"
// consistente en toda la app (igual que XoloPayoutPreview).
const formatPendingAmount = (subunits, currency) => {
  if (!Number.isFinite(subunits) || subunits <= 0) return null;
  const pesos = Math.round(subunits / 100);
  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pesos);
  return `$${formatted} ${currency || 'MXN'}`;
};

// XOLOLO Track #27: banner persistente visible al seller cuando le
// faltan requisitos para recibir sus pagos (Stripe Connect + docs
// legales). Reemplaza al viejo PayoutDocsWarning: ahora cubre AMBOS
// blockers (banco + docs) y vive en más lugares (Dashboard, InboxPage,
// TransactionPage del seller).
//
// Política de negocio (reconfirmada 2026-10):
//   - Seller publica sin Stripe Connect ni documentos legales (fricción
//     mínima para que empiece).
//   - Primer venta: el dinero del buyer cobra normalmente, pero queda
//     retenido en Xololo.
//   - Para liberarlo al seller, debe pasar este gate.
//
// Falla cerrado: sin currentUser, sin data, o canReceivePayout=true →
// no renderiza nada. Preferimos NO mostrar banner a mostrar uno
// equivocado (falso positivo asusta al seller sin razón).
//
// Props:
//   variant: 'default' (dashboard/account) | 'urgent' (inbox/tx — rojo)
//   className / rootClassName: estilos del root.

const PayoutGateBanner = props => {
  const { variant = 'default', className, rootClassName } = props;
  const currentUser = useSelector(state => state.user?.currentUser || null);
  const hasUser = !!currentUser?.id;
  const { settled, canReceivePayout, blockers } = usePayoutGate(hasUser);
  // XOLOLO: pedimos el monto retenido sólo cuando el banner va a renderizar
  // (hay user y el gate ya respondió). Si el gate está cerrado, el fetch
  // de pending es innecesario — ahorra 1 request en la mayoría de visitas.
  const needsPending = hasUser && settled && !canReceivePayout;
  const { pendingCount, pendingAmountSubunits, currency } = usePendingPayouts(needsPending);

  if (!hasUser || !settled) return null;
  if (canReceivePayout) return null;
  if (!blockers?.length) return null;

  const isUrgent = variant === 'urgent';
  const pendingAmount = formatPendingAmount(pendingAmountSubunits, currency);
  const hasPending = pendingCount > 0 && pendingAmount;

  // XOLOLO: la copy se eleva a urgente automáticamente cuando ya hay
  // dinero retenido, incluso si el caller pasó variant='default'. Un
  // seller con $450 esperando no está en modo "informativo".
  const effectivelyUrgent = isUrgent || hasPending;

  return (
    <div
      className={classNames(
        rootClassName || css.root,
        effectivelyUrgent ? css.urgent : css.informational,
        className
      )}
      role="alert"
    >
      <div className={css.header}>
        <span className={css.icon} aria-hidden="true">
          {effectivelyUrgent ? '⏳' : '⚠️'}
        </span>
        <div className={css.copy}>
          <p className={css.title}>
            {hasPending
              ? `Tienes ${pendingAmount} esperando — completa estos pasos para recibirlo`
              : effectivelyUrgent
              ? 'Tienes dinero esperando — completa estos pasos para recibirlo'
              : 'Antes de recibir tu primer pago'}
          </p>
          <p className={css.subtitle}>
            {hasPending
              ? `${pendingCount} ${
                  pendingCount === 1 ? 'venta' : 'ventas'
                } con pago retenido en Xololo. Lo liberamos automáticamente cuando termines tu setup.`
              : effectivelyUrgent
              ? 'Xololo guarda el pago de forma segura hasta que termines tu setup.'
              : 'Cuando llegue tu primera venta, Xololo retiene el dinero hasta que completes:'}
          </p>
        </div>
      </div>

      <ul className={css.steps}>
        {blockers.map(step => (
          <li key={step.key} className={css.step}>
            <span className={css.stepLabel}>{step.label}</span>
            <NamedLink name={step.routeName} className={css.cta}>
              {step.key === 'stripe' ? 'Conectar banco' : 'Subir documentos'}
              <span aria-hidden="true"> →</span>
            </NamedLink>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PayoutGateBanner;
