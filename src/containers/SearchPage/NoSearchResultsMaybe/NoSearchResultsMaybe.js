import React from 'react';
import { FormattedMessage } from '../../../util/reactIntl';
import { NamedLink } from '../../../components';

import css from './NoSearchResultsMaybe.module.css';

const NoSearchResultsMaybe = props => {
  const { listingsAreLoaded, totalItems, location, resetAll, showCreateListingsLink } = props;
  const hasNoResult = listingsAreLoaded && totalItems === 0;
  const hasSearchParams = location.search?.length > 0;

  // XOLOLO 2026-11-14: mensaje específico cuando el usuario llegó por
  // el atajo "Segunda mano" (href=/s?pub_condition=used) y aún no hay
  // listings publicados como usados. Evita que la card parezca rota
  // ("filtro sale en blanco" reportado).
  const search = location.search || '';
  const isSecondHandFilter = /pub_condition=used/.test(search);

  const createListingLinkMaybe = showCreateListingsLink ? (
    <NamedLink className={css.createListingLink} name="NewListingPage">
      <FormattedMessage id="SearchPage.createListing" />
    </NamedLink>
  ) : null;

  return hasNoResult ? (
    <div className={css.noSearchResults}>
      {isSecondHandFilter ? (
        <FormattedMessage id="SearchPage.noResultsSecondHand" />
      ) : (
        <FormattedMessage id="SearchPage.noResults" />
      )}
      <br />
      {hasSearchParams ? (
        <button className={css.resetAllFiltersButton} onClick={e => resetAll(e)}>
          <FormattedMessage id={'SearchPage.resetAllFilters'} />
        </button>
      ) : null}
      <p>{createListingLinkMaybe}</p>
    </div>
  ) : null;
};

export default NoSearchResultsMaybe;
