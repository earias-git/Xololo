import { getHandleSubmitSignup } from './AuthenticationPage.helpers';

describe('getHandleSubmitSignup (XOLOLO sellerMode)', () => {
  const makeHandler = () => {
    const submitSignup = jest.fn();
    const handle = getHandleSubmitSignup({
      submitSignup,
      userFields: [],
      userTypes: [],
    });
    return { handle, submitSignup };
  };

  const baseValues = {
    userType: null,
    email: 'enri@test.mx',
    password: 'super-secret-pass',
    fname: 'Enrique',
    lname: 'Arias',
  };

  it('does NOT attach casual data when sellerMode is not casual', () => {
    const { handle, submitSignup } = makeHandler();
    handle({ ...baseValues, sellerMode: 'store' });
    const payload = submitSignup.mock.calls[0][0];
    expect(payload.publicData?.sellerMode).toBeUndefined();
    expect(payload.protectedData?.xololoTaxProfile).toBeUndefined();
  });

  it('does NOT attach casual data when sellerMode is empty (choose later)', () => {
    const { handle, submitSignup } = makeHandler();
    handle({ ...baseValues, sellerMode: '' });
    const payload = submitSignup.mock.calls[0][0];
    expect(payload.publicData?.sellerMode).toBeUndefined();
    expect(payload.protectedData?.xololoTaxProfile).toBeUndefined();
  });

  it('persists sellerMode=casual_reseller + particular tax profile when casual', () => {
    const { handle, submitSignup } = makeHandler();
    handle({ ...baseValues, sellerMode: 'casual_reseller' });
    const payload = submitSignup.mock.calls[0][0];

    expect(payload.publicData.sellerMode).toBe('casual_reseller');
    expect(payload.protectedData.xololoTaxProfile.personType).toBe('individual');
    expect(payload.protectedData.xololoTaxProfile.hasRfc).toBe(false);
    expect(payload.protectedData.xololoTaxProfile.declaredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it('does NOT leak sellerMode into protectedData as a user-field', () => {
    // Regression guard: the handler destructures sellerMode out so it
    // cannot end up inside pickUserFieldsData / getExtendedDataMaybe.
    const { handle, submitSignup } = makeHandler();
    handle({ ...baseValues, sellerMode: 'casual_reseller' });
    const payload = submitSignup.mock.calls[0][0];
    expect(payload.sellerMode).toBeUndefined();
  });

  it('forwards the basic signup fields unchanged', () => {
    const { handle, submitSignup } = makeHandler();
    handle({ ...baseValues, sellerMode: 'casual_reseller' });
    const payload = submitSignup.mock.calls[0][0];
    expect(payload.email).toBe('enri@test.mx');
    expect(payload.password).toBe('super-secret-pass');
    expect(payload.firstName).toBe('Enrique');
    expect(payload.lastName).toBe('Arias');
  });
});
