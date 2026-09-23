import React from 'react';
import classNames from 'classnames';

import { NamedLink } from '../../components';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';

import css from './AccountProgressClock.module.css';

// XOLOLO: reloj/checklist de avance en la configuración de la cuenta.
// Pedido explícito: earias quiere ver de un vistazo qué le falta a un
// seller nuevo para quedar completamente configurado. Vive en la
// pantalla de entrada de "Mi cuenta" (ProfileSettingsPage, primer tab).
//
// La lógica del checklist vive en el hook useOnboardingStatus
// (src/hooks/useOnboardingStatus.js) — compartida con
// RequireSellerOnboarding, que SÍ usa este mismo checklist para
// bloquear (redirigir) a un seller nuevo que intenta publicar sin
// terminar. Este componente en cambio es deliberadamente informativo
// — nunca bloquea nada por sí mismo.

const AccountProgressClock = ({ currentUser, className, rootClassName }) => {
  const { hasUser, results, doneCount, total, pct, allDone } = useOnboardingStatus(currentUser);

  if (!hasUser) return null;

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
