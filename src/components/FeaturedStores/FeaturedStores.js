import React from 'react';
import classNames from 'classnames';

import css from './FeaturedStores.module.css';

// XOLOLO: 3 tarjetas de storefronts destacados. Cada card muestra la foto
// de portada, el subdominio del seller (empresa.xololo.mx), el nombre, la
// descripción corta y un link para visitar la tienda.

const FeaturedStores = props => {
  const { title, seeAllHref, stores, className, rootClassName } = props;
  if (!stores?.length) return null;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label={title || 'Tiendas destacadas Xololo'}
    >
      <div className={css.container}>
        <div className={css.header}>
          <h2 className={css.title}>{title || 'Tiendas destacadas Xololo'}</h2>
          {seeAllHref ? (
            <a href={seeAllHref} className={css.seeAll}>
              Ver todas las tiendas →
            </a>
          ) : null}
        </div>
        <ul className={css.grid}>
          {stores.map(store => (
            <li key={store.id} className={css.item}>
              <a
                href={store.href || `https://${store.subdomain}`}
                className={css.card}
                rel={store.href?.startsWith('http') ? 'noopener' : undefined}
              >
                <div
                  className={css.cover}
                  style={{
                    backgroundImage: `url(${store.cover})`,
                    backgroundPosition: store.coverPosition || 'center',
                  }}
                />
                <div className={css.body}>
                  <span className={css.subdomain}>{store.subdomain}</span>
                  <span className={css.name}>{store.name}</span>
                  {store.description ? (
                    <p className={css.description}>{store.description}</p>
                  ) : null}
                  <span className={css.visit}>Visitar tienda →</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default FeaturedStores;
