import React from 'react';
import { useSelector } from 'react-redux';

import { useOnboardingStatus, LEGAL_DOCS_STEP } from '../../hooks/useOnboardingStatus';
import NamedLink from '../NamedLink/NamedLink';

import css from './PayoutDocsWarning.module.css';

// XOLOLO 2026-10-06: banner persistente visible en Dashboard cuando el
// seller ya puede publicar pero aún no sube sus documentos legales.
// La política: publicar sí, pero el primer PAYOUT se retiene hasta
// que los docs estén completos (gate real pendiente de implementar,
// ver task #18b).
//
// Falla cerrado (no muestra): si no hay user, el fetch de legalDocs
// falla, o están completos. Nunca aparece para un buyer puro.
const PayoutDocsWarning = () => {
  const currentUser = useSelector(state => state.user?.currentUser || null);
  const { hasUser, loading, failed, results } = useOnboardingStatus(currentUser);

  if (!hasUser || loading || failed) return null;

  const legalDocsStep = results.find(r => r.key === LEGAL_DOCS_STEP.key);
  if (!legalDocsStep || legalDocsStep.done) return null;

  return (
    <div className={css.root} role="status">
      <span className={css.icon} aria-hidden>
        ⚠️
      </span>
      <div className={css.content}>
        <p className={css.title}>
          <strong>Documentos legales pendientes.</strong> Puedes publicar y vender normalmente,
          pero necesitas completarlos para recibir tu primer pago.
        </p>
        <NamedLink name={LEGAL_DOCS_STEP.routeName} className={css.cta}>
          Subir documentos →
        </NamedLink>
      </div>
    </div>
  );
};

export default PayoutDocsWarning;
