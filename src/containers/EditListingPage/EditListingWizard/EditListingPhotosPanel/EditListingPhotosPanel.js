import React from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';

// Import shared components
import { H3, ListingLink, NamedLink } from '../../../../components';

// Import modules from this directory
import EditListingPhotosForm from './EditListingPhotosForm';
import css from './EditListingPhotosPanel.module.css';

const DETAILS_TAB = 'details';

const getInitialValues = params => {
  const { images = [] } = params;
  return { images };
};

/**
 * The EditListingPhotosPanel component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {Object} props.errors - The errors object
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Array} props.images - The images array
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {Function} props.onImageUpload - The image upload function
 * @param {string} props.submitButtonText - The submit button text
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Function} props.onSubmit - The submit function
 * @param {Function} props.onRemoveImage - The remove image function
 * @param {Object} props.listingImageConfig - The listing image config
 * @returns {JSX.Element}
 */
const EditListingPhotosPanel = props => {
  const {
    className,
    rootClassName,
    errors,
    disabled,
    ready,
    listing,
    onImageUpload,
    submitButtonText,
    panelUpdated,
    updateInProgress,
    onSubmit,
    onRemoveImage,
    listingImageConfig,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const rootClass = rootClassName || css.root;
  const classes = classNames(rootClass, className);
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingPhotosPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingPhotosPanel.createListingTitle',
        values: { lineBreak: <br /> },
        messageProps: {},
      };

  return (
    <main className={classes}>
      <UpdatePageTitle
        panelHeading={intl.formatMessage(
          { id: panelHeadingProps.id },
          { ...panelHeadingProps.messageProps }
        )}
      />
      <H3 as="h1">
        <FormattedMessage id={panelHeadingProps.id} values={{ ...panelHeadingProps.values }} />
      </H3>
      {/* <H3 as="h1">
        {isPublished ? (
          <FormattedMessage
            id="EditListingPhotosPanel.title"
            values={{ listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> }}
          />
        ) : (
          <FormattedMessage
            id="EditListingPhotosPanel.createListingTitle"
            values={{ lineBreak: <br /> }}
          />
        )}
      </H3> */}
      <EditListingPhotosForm
        className={css.form}
        disabled={disabled}
        ready={ready}
        fetchErrors={errors}
        initialValues={getInitialValues(props)}
        onImageUpload={onImageUpload}
        onSubmit={values => {
          const { addImage, ...updateValues } = values;
          onSubmit(updateValues);
        }}
        onRemoveImage={onRemoveImage}
        saveActionMsg={submitButtonText}
        updated={panelUpdated}
        updateInProgress={updateInProgress}
        listingImageConfig={listingImageConfig}
      />

      {/* XOLOLO Fase 2 — CTA para que la IA sugiera título/descripción
          basados en las fotos del listing. Visible SIEMPRE que el seller
          esté en Photos (tiene listing.id creado desde el paso Details),
          no sólo después del submit. Antes el CTA aparecía ~500ms antes
          del redirect de publicación — no era usable. Ahora persiste
          durante toda la edición y el seller decide si va a Detalles
          antes o después de guardar. Si aún no subió fotos, el CTA
          cambia copy a "Primero sube tus fotos" (ir a Detalles sin fotos
          no sirve a la IA, que analiza visualmente). */}
      {listing?.id
        ? (() => {
            const hasImages =
              (listing?.images?.length || 0) > 0 ||
              (listing?.relationships?.images?.data?.length || 0) > 0;
            return (
              <aside className={css.aiCta}>
                <div className={css.aiCtaLeft}>
                  <span className={css.aiCtaSparkle} aria-hidden="true">
                    ✨
                  </span>
                  <div>
                    <h4 className={css.aiCtaTitle}>¿Quieres mejorar tu texto con IA?</h4>
                    <p className={css.aiCtaDesc}>
                      {hasImages
                        ? 'Nuestra IA analiza tus fotos y te sugiere un título y descripción más atractivos. Toma ~20 segundos.'
                        : 'Sube al menos una foto arriba y guarda, después vuelve a Detalles y nuestra IA te sugerirá título y descripción basados en lo que ve.'}
                    </p>
                  </div>
                </div>
                <NamedLink
                  name="EditListingPage"
                  params={{
                    id: listing.id.uuid,
                    slug: listing.attributes.title
                      ? listing.attributes.title
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, '')
                      : 'draft',
                    type: isPublished ? 'edit' : 'draft',
                    tab: DETAILS_TAB,
                  }}
                  to={{ search: '?autoSuggest=1' }}
                  className={css.aiCtaBtn}
                >
                  {hasImages ? 'Mejorar en Detalles →' : 'Ir a Detalles →'}
                </NamedLink>
              </aside>
            );
          })()
        : null}
    </main>
  );
};

export default EditListingPhotosPanel;
