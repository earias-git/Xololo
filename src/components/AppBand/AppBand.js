import React from 'react';
import classNames from 'classnames';

import css from './AppBand.module.css';

// XOLOLO: banda promocional que invita a descargar la app móvil. Muestra el
// pitch y dos badges (App Store / Google Play) a la izquierda y una figura
// de teléfono estilizada a la derecha. Los links de las tiendas se pueden
// cambiar desde las props; por ahora apuntan a `#` porque la app aún no
// está publicada.
const AppBand = props => {
  const {
    appStoreHref = '#',
    playStoreHref = '#',
    className,
    rootClassName,
  } = props;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label="Descarga la app de Xololo"
    >
      <div className={css.container}>
        <div className={css.band}>
          <div className={css.copy}>
            <p className={css.eyebrow}>Descarga la app</p>
            <h2 className={css.title}>
              Gestiona tus compras, ventas y reservas desde donde estés
            </h2>
            <p className={css.description}>
              Notificaciones al instante, pagos protegidos y soporte por
              WhatsApp integrado.
            </p>
            <div className={css.badges}>
              <a
                className={css.storeBadge}
                href={appStoreHref}
                aria-label="Descargar en la App Store"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className={css.storeIcon}
                >
                  <path d="M16.5 12.5c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.5.8-3.2 2-1.4 2.3-.3 5.8 1 7.7.7.9 1.4 2 2.5 2 1 0 1.4-.6 2.6-.6 1.2 0 1.5.6 2.6.6 1.1 0 1.8-1 2.4-2 .8-1 1.1-2.1 1.1-2.1s-2.2-.9-2.2-3zm-2-6c.5-.6 1-1.5.9-2.5-.8 0-1.8.6-2.4 1.2-.5.6-1 1.5-.9 2.4.9.1 1.8-.5 2.4-1.1z" />
                </svg>
                <span className={css.storeCopy}>
                  <span className={css.storeSmall}>Descárgalo en el</span>
                  <span className={css.storeBig}>App Store</span>
                </span>
              </a>
              <a
                className={css.storeBadge}
                href={playStoreHref}
                aria-label="Disponible en Google Play"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className={css.storeIcon}
                >
                  <path d="M4 3.6v16.8c0 .6.7 1 1.2.6l12.3-8.4c.5-.3.5-1 0-1.3L5.2 3c-.5-.3-1.2 0-1.2.6z" />
                </svg>
                <span className={css.storeCopy}>
                  <span className={css.storeSmall}>Disponible en</span>
                  <span className={css.storeBig}>Google Play</span>
                </span>
              </a>
            </div>
          </div>
          <div className={css.visual} aria-hidden="true">
            <div className={css.phone} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default AppBand;
