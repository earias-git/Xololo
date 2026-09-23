import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';
import { NamedLink } from '../../components';

import css from './AccountProgressClock.module.css';

// XOLOLO: reloj/checklist de avance en la configuración de la cuenta.
// Pedido explícito: earias quiere ver de un vistazo qué le falta a un
// seller nuevo para quedar completamente configurado. Vive en la
// pantalla de entrada de "Mi cuenta" (ProfileSettingsPage, primer tab).
//
// La mayoría de los pasos se derivan de `currentUser` sin fetches
// nuevos. "Suscripción" (Track C) y "Documentos legales" (Track B) son
// la excepción: ese dato vive en metadata, que el cliente no puede
// leer de su propio currentUser (sólo vía Integration API en el
// server), así que se resuelven con fetches livianos a
// /api/seller-subscription y /api/seller-legal-docs.
//
// Diseño deliberado: NO es un gate — es sólo un indicador informativo.
// Ningún paso bloquea a otro.

const STEPS = [
  {
    key: 'profile',
    label: 'Datos personales',
    check: user => {
      const p = user?.attributes?.profile || {};
      return !!(p.firstName && p.lastName && p.displayName);
    },
    routeName: 'ProfileSettingsPage',
  },
  {
    key: 'contact',
    label: 'Contacto verificado',
    check: user => {
      const a = user?.attributes || {};
      return !!a.email && a.emailVerified === true;
    },
    routeName: 'ContactDetailsPage',
  },
  {
    key: 'payouts',
    label: 'Cobros configurados',
    check: user => user?.attributes?.stripeConnected === true,
    routeName: 'StripePayoutPage',
  },
  {
    key: 'store',
    label: 'Mi tienda',
    check: user => !!user?.attributes?.profile?.publicData?.slug,
    routeName: 'ManageStorePage',
  },
];

const SUBSCRIPTION_STEP = {
  key: 'subscription',
  label: 'Suscripción activa',
  routeName: 'SubscriptionPage',
};

const LEGAL_DOCS_STEP = {
  key: 'legalDocs',
  label: 'Documentos legales',
  routeName: 'LegalDocsPage',
};

const isLegalDocsStepDone = legalDocsStatus => {
  if (!legalDocsStatus?.personType || !legalDocsStatus.requiredSlots?.length) return false;
  const docs = legalDocsStatus.docs || {};
  return legalDocsStatus.requiredSlots.every(slot => !!docs[slot.key]);
};

const useLightFetch = (path, enabled) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`${apiBaseUrl()}${path}`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(d => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return data;
};

const AccountProgressClock = ({ currentUser, className, rootClassName }) => {
  const hasUser = !!currentUser?.id;
  const legalDocsStatus = useLightFetch('/api/seller-legal-docs', hasUser);
  const subscriptionStatus = useLightFetch('/api/seller-subscription', hasUser);

  if (!hasUser) return null;

  const results = [
    ...STEPS.map(step => ({ ...step, done: step.check(currentUser) })),
    { ...SUBSCRIPTION_STEP, done: subscriptionStatus?.status === 'active' },
    { ...LEGAL_DOCS_STEP, done: isLegalDocsStepDone(legalDocsStatus) },
  ];
  const doneCount = results.filter(r => r.done).length;
  const total = results.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  return (
    <section className={classNames(rootClassName || css.root, className)}>
      <div className={css.header}>
        <h3 className={css.title}>
          {allDone ? '¡Tu cuenta está lista! 🎉' : 'Completa tu cuenta'}
        </h3>
        <span className={css.pct}>{doneCount}/{total}</span>
      </div>
      <div className={css.barTrack}>
        <div className={css.barFill} style={{ width: `${pct}%` }} />
      </div>
      {!allDone ? (
        <ul className={css.list}>
          {results.map(r => (
            <li key={r.key} className={classNames(css.item, r.done && css.itemDone)}>
              <span className={css.icon} aria-hidden>
                {r.done ? '✓' : '○'}
              </span>
              <span className={css.label}>{r.label}</span>
              {!r.done ? (
                <NamedLink name={r.routeName} className={css.link}>
                  Completar →
                </NamedLink>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

export default AccountProgressClock;
