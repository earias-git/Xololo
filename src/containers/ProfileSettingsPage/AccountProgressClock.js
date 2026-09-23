import React from 'react';
import classNames from 'classnames';

import { NamedLink } from '../../components';

import css from './AccountProgressClock.module.css';

// XOLOLO: reloj/checklist de avance en la configuración de la cuenta.
// Pedido explícito: earias quiere ver de un vistazo qué le falta a un
// seller nuevo para quedar completamente configurado. Vive en la
// pantalla de entrada de "Mi cuenta" (ProfileSettingsPage, primer tab).
//
// v1 sólo trackea pasos que YA existen y se pueden derivar de
// `currentUser` sin fetches nuevos (nada de Suscripción/Documentos
// legales todavía — esos llegan con Track C/B de
// docs/SUBSCRIPTIONS_V1.md y se agregan aquí cuando existan).
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

const AccountProgressClock = ({ currentUser, className, rootClassName }) => {
  if (!currentUser?.id) return null;

  const results = STEPS.map(step => ({ ...step, done: step.check(currentUser) }));
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
