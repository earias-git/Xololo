import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { fetchOwnVariantSiblings } from '../EditListingPage.duck';

// XOLOLO (variantes · PR 5) — Hook ligero para cargar los listings
// hermanos de un grupo dentro del wizard.
//
// Usa sdk.ownListings via un thunk del duck para incluir drafts y
// cerrados que no salen en sdk.listings.query pública.
//
// Fallback-silent: si el fetch falla o el user no tiene permiso
// (colaborador sin acceso), el hook devuelve [] — no revienta el
// wizard.

export const useVariantSiblings = variantGroupId => {
  const [siblings, setSiblings] = useState([]);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!variantGroupId) {
      setSiblings([]);
      return;
    }
    let cancelled = false;
    dispatch(fetchOwnVariantSiblings(variantGroupId))
      .then(list => {
        if (!cancelled) setSiblings(list || []);
      })
      .catch(() => {
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [variantGroupId, dispatch]);

  return siblings;
};
