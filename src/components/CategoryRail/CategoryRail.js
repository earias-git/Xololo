import React from 'react';
import classNames from 'classnames';

import css from './CategoryRail.module.css';

// XOLOLO: riel horizontal de categorías con íconos, inspirado en el layout
// de MercadoLibre. Reemplaza la sección "Categorias" del PageBuilder por un
// componente más compacto (tarjeta chica con ícono circular verde + nombre).
// El contenido vive en src/config/categories.js.
const CategoryRail = props => {
  const { categories, title, seeAllHref, className, rootClassName } = props;
  if (!categories?.length) return null;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label={title || 'Categorías'}
    >
      <div className={css.container}>
        <div className={css.header}>
          <h2 className={css.title}>{title || 'Explora por categoría'}</h2>
          {seeAllHref ? (
            <a href={seeAllHref} className={css.seeAll}>
              Ver todas →
            </a>
          ) : null}
        </div>
        <ul className={css.rail}>
          {categories.map(cat => (
            <li key={cat.id} className={css.item}>
              <a href={cat.href} className={css.tile}>
                <span className={css.iconRing}>{cat.icon}</span>
                <span className={css.label}>{cat.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default CategoryRail;
