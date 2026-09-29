import React from 'react';
import '@testing-library/jest-dom';

import { fakeIntl } from '../../../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../../../util/testHelpers';

import EditListingDeliveryForm from './EditListingDeliveryForm';

const { screen, userEvent } = testingLibrary;

const noop = () => null;

describe('EditListingDeliveryForm', () => {
  it('submit button activates once a Xololo shipping method is enabled', async () => {
    const user = userEvent.setup();
    const saveActionMsg = 'Save location';
    render(
      <EditListingDeliveryForm
        intl={fakeIntl}
        dispatch={noop}
        onSubmit={noop}
        saveActionMsg={saveActionMsg}
        marketplaceCurrency="USD"
        updated={false}
        updateInProgress={false}
        disabled={false}
        ready={false}
      />
    );

    // Submit disabled until at least one v2 method is enabled.
    expect(screen.getByRole('button', { name: saveActionMsg })).toBeDisabled();

    // Enable pickup (always $0, no extra required fields).
    await user.click(screen.getByLabelText(/Recolección en mi domicilio/i));

    expect(screen.getByRole('button', { name: saveActionMsg })).toBeEnabled();
  });
});
