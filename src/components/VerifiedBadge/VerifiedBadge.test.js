import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render } from '../../util/testHelpers';

import VerifiedBadge from './VerifiedBadge';

// XOLOLO 2026-11-23 smoke: blindaje del contrato del badge.
// - No renderiza nada si el seller no está verificado.
// - Renderiza marca + label cuando `verified={true}` o cuando el
//   seller tiene `publicData.xololoVerified === true`.
// - Mantiene el aria-label "Xololo Verified" (estable para a11y).
//
// Si alguien cambia estas conductas sin ADR, este test falla.

describe('VerifiedBadge', () => {
  it('returns nothing when neither `verified` prop nor seller flag is truthy', () => {
    const tree = render(<VerifiedBadge />);
    expect(tree.container).toBeEmptyDOMElement();
  });

  it('returns nothing when seller is present but xololoVerified is false', () => {
    const seller = {
      attributes: { profile: { publicData: { xololoVerified: false } } },
    };
    const tree = render(<VerifiedBadge seller={seller} />);
    expect(tree.container).toBeEmptyDOMElement();
  });

  it('renders when explicit verified={true}', () => {
    const tree = render(<VerifiedBadge verified={true} />);
    const badge = tree.getByLabelText('Xololo Verified');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Verified');
  });

  it('renders when seller publicData.xololoVerified === true', () => {
    const seller = {
      attributes: { profile: { publicData: { xololoVerified: true } } },
    };
    const tree = render(<VerifiedBadge seller={seller} />);
    expect(tree.getByLabelText('Xololo Verified')).toBeInTheDocument();
  });

  it('hides label text when showLabel={false}', () => {
    const tree = render(<VerifiedBadge verified={true} showLabel={false} />);
    const badge = tree.getByLabelText('Xololo Verified');
    expect(badge).toBeInTheDocument();
    expect(badge).not.toHaveTextContent('Verified');
  });

  it('includes the official X mark as an image', () => {
    const tree = render(<VerifiedBadge verified={true} />);
    const img = tree.container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/xololo-logo-mobile/);
  });
});
