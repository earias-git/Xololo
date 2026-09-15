import React from 'react';
import { connect } from 'react-redux';
import { string } from 'prop-types';

import { selectStorefrontSlug } from '../../ducks/storefrontSubdomain.duck';

import css from './StorefrontPage.module.css';

// XOLOLO: placeholder inicial del storefront de un seller. Solo confirma
// que el server detectó el subdominio y lo pasó al cliente vía SSR. El
// contenido real (hero del seller, sobre nosotros, catálogo, reviews) se
// arma en S5 cuando existan los campos custom del user (S4).

const StorefrontPageComponent = ({ slug }) => {
  return (
    <main className={css.root}>
      <div className={css.container}>
        <p className={css.eyebrow}>Storefront (placeholder)</p>
        <h1 className={css.title}>{slug}.xololo.mx</h1>
        <p className={css.description}>
          El server detectó el subdominio y precargó el slug{' '}
          <code className={css.code}>{slug}</code> en el redux store.
        </p>
        <p className={css.description}>
          El diseño real de esta página se construye en S5. Aquí irá el hero
          del seller, su descripción, catálogo filtrable por categoría y sus
          reviews acumulados.
        </p>
      </div>
    </main>
  );
};

StorefrontPageComponent.propTypes = {
  slug: string.isRequired,
};

const mapStateToProps = state => ({
  slug: selectStorefrontSlug(state) || '',
});

const StorefrontPage = connect(mapStateToProps)(StorefrontPageComponent);

export default StorefrontPage;
