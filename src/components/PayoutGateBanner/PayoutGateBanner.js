import React from 'react';
import classNames from 'classnames';
import { useSelector } from 'react-redux';

import { usePayoutGate } from '../../hooks/usePayoutGate';
import NamedLink from '../NamedLink/NamedLink';

import css from './PayoutGateBanner.module.css';

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

  if (!hasUser || !settled) return null;
  if (canReceivePayout) return null;
  if (!blockers?.length) return null;

  const isUrgent = variant === 'urgent';

  return (
    <div
      className={classNames(
        rootClassName || css.root,
        isUrgent ? css.urgent : css.informational,
        className
      )}
      role="alert"
    >
      <div className={css.header}>
        <span className={css.icon} aria-hidden="true">
          {isUrgent ? '⏳' : '⚠️'}
        </span>
        <div className={css.copy}>
          <p className={css.title}>
            {isUrgent
              ? 'Tienes dinero esperando — completa estos pasos para recibirlo'
              : 'Antes de recibir tu primer pago'}
          </p>
          <p className={css.subtitle}>
            {isUrgent
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
