import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import * as validators from '../../../../util/validators';
import { formatMoney } from '../../../../util/currency';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { FIXED, isBookingProcess } from '../../../../transactions/transaction';

// Import shared components
import {
  Button,
  FieldRadioButton,
  FieldSelect,
  Form,
  FieldCurrencyInput,
  TaxClassificationField,
} from '../../../../components';
import XoloPayoutPreview from '../../../../components/XoloPayoutPreview/XoloPayoutPreview';
import { getClassificationByCode } from '../../../../util/xololoTaxClassification';
import {
  LISTING_CONDITIONS,
  LISTING_CONDITION_OPTIONS,
  SELLER_MODES,
  getUsedGoodsNotice,
  resolveUsedGoodsOverride,
} from '../../../../util/xololoSellerMode';
import {
  NOTICE as USED_CONDITION_NOTICE,
  USED_CONDITION_OPTIONS,
} from '../../../../util/xololoUsedCondition';

import BookingPriceVariants from './BookingPriceVariants';
import StartTimeInterval from './StartTimeInverval';

// Import modules from this directory
import css from './EditListingPricingForm.module.css';

const { Money } = sdkTypes;

const getPriceValidators = (listingMinimumPriceSubUnits, marketplaceCurrency, intl) => {
  const priceRequiredMsgId = { id: 'EditListingPricingForm.priceRequired' };
  const priceRequiredMsg = intl.formatMessage(priceRequiredMsgId);
  const priceRequired = validators.required(priceRequiredMsg);

  const minPriceRaw = new Money(listingMinimumPriceSubUnits, marketplaceCurrency);
  const minPrice = formatMoney(intl, minPriceRaw);
  const priceTooLowMsgId = { id: 'EditListingPricingForm.priceTooLow' };
  const priceTooLowMsg = intl.formatMessage(priceTooLowMsgId, { minPrice });
  const minPriceRequired = validators.moneySubUnitAmountAtLeast(
    priceTooLowMsg,
    listingMinimumPriceSubUnits
  );

  return listingMinimumPriceSubUnits
    ? validators.composeValidators(priceRequired, minPriceRequired)
    : priceRequired;
};

const ErrorMessages = props => {
  const { fetchErrors } = props;
  const { updateListingError, showListingsError } = fetchErrors || {};

  return (
    <>
      {updateListingError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingPricingForm.updateFailed" />
        </p>
      ) : null}
      {showListingsError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingPricingForm.showListingFailed" />
        </p>
      ) : null}
    </>
  );
};

/**
 * The EditListingPricingForm component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.formId] - The form id
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} props.unitType - The unitType from listing.attributes.publicData
 * @param {Object} [props.listingTypeConfig] - The listing type config that matches with listingType on publicData.
 * @param {Object} [props.listingTypeConfig.priceVariations] - The price variations config.
 * @param {boolean} props.listingTypeConfig.priceVariations.enabled - Whether the price variations are enabled.
 * @param {Object} [props.listingTypeConfig.transactionType] - The transaction type config.
 * @param {string} props.listingTypeConfig.transactionType.process - The transaction process config.
 * @param {string} props.marketplaceCurrency - The marketplace currency
 * @param {number} [props.listingMinimumPriceSubUnits] - The listing minimum price sub units
 * @param {boolean} [props.autoFocus] - Whether the input should be focused
 * @param {boolean} [props.disabled] - Whether the form is disabled
 * @param {boolean} [props.ready] - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {boolean} [props.invalid] - Whether the form is invalid
 * @param {boolean} [props.pristine] - Whether the form is pristine
 * @param {string} props.saveActionMsg - The save action message
 * @param {boolean} [props.updated] - Whether the form is updated
 * @param {boolean} [props.updateInProgress] - Whether the form is updating
 * @param {Object} [props.fetchErrors] - The fetch errors
 * @returns {JSX.Element}
 */
export const EditListingPricingForm = props => (
  <FinalForm
    mutators={{ ...arrayMutators }}
    {...props}
    render={formRenderProps => {
      const {
        formId = 'EditListingPricingForm',
        form: formApi,
        autoFocus,
        className,
        rootClassName,
        disabled,
        ready,
        handleSubmit,
        marketplaceCurrency,
        unitType,
        listingTypeConfig,
        isPriceVariationsInUse,
        listingMinimumPriceSubUnits = 0,
        invalid,
        pristine,
        saveActionMsg,
        updated,
        updateInProgress = false,
        fetchErrors,
        initialValues: formInitialValues,
        values: formValues,
        categoryId,
        sellerTaxProfile,
        sellerMode,
      } = formRenderProps;

      const isCasual = sellerMode === SELLER_MODES.CASUAL_RESELLER;

      const intl = useIntl();
      const priceValidators = getPriceValidators(
        listingMinimumPriceSubUnits,
        marketplaceCurrency,
        intl
      );

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress;
      const { transactionType } = listingTypeConfig || {};
      const { process } = transactionType || {};
      const isBooking = isBookingProcess(process);

      const isFixedLengthBooking = isBooking && unitType === FIXED;
      const isBookingPriceVariationsInUse = isBooking && isPriceVariationsInUse;
      const isUsingPriceVariants = isFixedLengthBooking || isBookingPriceVariationsInUse;

      return (
        <Form onSubmit={handleSubmit} className={classes}>
          <ErrorMessages fetchErrors={fetchErrors} />

          {isUsingPriceVariants ? (
            <BookingPriceVariants
              formId={formId}
              formApi={formApi}
              autoFocus={autoFocus}
              className={css.input}
              marketplaceCurrency={marketplaceCurrency}
              unitType={unitType}
              isPriceVariationsInUse={isBookingPriceVariationsInUse}
              initialLengthOfPriceVariants={formInitialValues?.priceVariants?.length || 0}
              listingMinimumPriceSubUnits={listingMinimumPriceSubUnits}
            />
          ) : (
            <FieldCurrencyInput
              id={`${formId}price`}
              name="price"
              className={css.input}
              autoFocus={autoFocus}
              label={intl.formatMessage(
                { id: 'EditListingPricingForm.pricePerProduct' },
                { unitType }
              )}
              placeholder={intl.formatMessage({
                id: 'EditListingPricingForm.priceInputPlaceholder',
              })}
              currencyConfig={appSettings.getCurrencyFormatting(marketplaceCurrency)}
              validate={priceValidators}
            />
          )}

          {/* XOLOLO: condición del artículo. Oculta para casual (siempre
              'used' forzado); visible para store para alternar nuevo/usado. */}
          {!isCasual ? (
            <fieldset className={css.conditionFieldset}>
              <legend className={css.conditionLegend}>Condición del artículo</legend>
              <div className={css.conditionRow}>
                {LISTING_CONDITION_OPTIONS.map(opt => (
                  <FieldRadioButton
                    key={opt.key}
                    id={`${formId}_condition_${opt.key}`}
                    name="condition"
                    value={opt.key}
                    label={opt.label}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* XOLOLO: nivel de estado del artículo usado. */}
          {formValues?.condition === 'used' ? (
            <>
              <FieldSelect
                id={`${formId}.usedCondition`}
                name="usedCondition"
                className={css.input}
                label="Nivel de estado del artículo usado"
              >
                <option value="">Selecciona cómo está tu artículo…</option>
                {USED_CONDITION_OPTIONS.map(opt => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </FieldSelect>
              <p className={css.usedConditionNotice}>{USED_CONDITION_NOTICE}</p>
            </>
          ) : null}

          {/* XOLOLO: clasificación fiscal especial — oculta para casual. */}
          {!isCasual ? <TaxClassificationField formId={formId} values={formValues} /> : null}

          {/* XOLOLO: preview del payout del seller. Client-only,
              se auto-oculta hasta que hay precio. categoryId resuelve
              el default fiscal (ivaMode + taxActivity) vía
              xololoTaxCategories; sin categoría, usa el default
              conservador 16% + enajenacion. */}
          {(() => {
            // Precedencia de override fiscal:
            //  1) Clasificación especial declarada manualmente (en revisión)
            //  2) Resolución automática por condición usado + particular
            //  3) Default de la categoría (lo computa el preview)
            const hasSpecial = !!formValues?.hasTaxSpecialClassification;
            const manual = hasSpecial
              ? getClassificationByCode(formValues?.taxClassificationCode)
              : null;
            const auto = !manual
              ? resolveUsedGoodsOverride({
                  condition: formValues?.condition,
                  personType: sellerTaxProfile?.personType,
                })
              : null;
            const override = manual || auto;
            const notice = getUsedGoodsNotice({
              condition: formValues?.condition,
              personType: sellerTaxProfile?.personType,
            });
            return (
              <XoloPayoutPreview
                price={formValues?.price}
                currency={marketplaceCurrency}
                heading="Cuánto recibirás por esta venta"
                categoryId={categoryId}
                ivaMode={override?.ivaMode}
                taxActivity={override?.taxActivity}
                ivaArticle={override?.ivaArticle}
                personType={sellerTaxProfile?.personType}
                hasRfc={sellerTaxProfile?.hasRfc}
                usedGoodsNotice={notice}
              />
            );
          })()}

          {isFixedLengthBooking ? (
            <StartTimeInterval
              name="startTimeInterval"
              idPrefix={`${formId}_startTimeInterval`}
              formValues={formValues}
              pristine={pristine}
            />
          ) : null}

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            {saveActionMsg}
          </Button>
        </Form>
      );
    }}
  />
);

export default EditListingPricingForm;
