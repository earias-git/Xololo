import React, { useState } from 'react';
import { Form as FinalForm, Field } from 'react-final-form';
import classNames from 'classnames';

import { Form, PrimaryButton, FieldTextInput, FieldSelect } from '../../../components';

import ImageUploadField from './ImageUploadField';
import css from './ManageStoreForm.module.css';

// XOLOLO: form controls to edit the seller's storefront branding.
// Todos los inputs escriben en publicData. La validación es cliente
// (opcional) — el server valida al persistir.

const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'staging', 'dev', 'test',
  'mail', 'blog', 'docs', 'help', 'my', 'account', 'stripe',
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Paleta curada de colores primarios. 16 tonos organizados en 4 familias
// para que el seller pueda ver de un vistazo qué opción le queda a su
// marca sin tener que pensar en códigos HEX.
const PRIMARY_PALETTE = [
  // Verdes / naturaleza
  '#1f8f52', '#0f7a3f', '#2ea44f', '#3fb56b',
  // Naranja / cálidos
  '#c8720f', '#e05a1a', '#f0932b', '#eb984e',
  // Azul / confianza
  '#1e3a8a', '#2563eb', '#0891b2', '#0ea5e9',
  // Morado / rosa
  '#7c3aed', '#a855f7', '#db2777', '#e11d48',
];

// Paleta secundaria — tonos más suaves y complementarios para acentos,
// bandas y fondos. Mismo orden que la primaria para que sea intuitivo
// combinar.
const SECONDARY_PALETTE = [
  '#6bcb8c', '#a8e6b8', '#7dd3a2', '#c4f0d4',
  '#e4a856', '#f5b96f', '#fbcf94', '#ffe0b0',
  '#93c5fd', '#bfdbfe', '#a5f3fc', '#bae6fd',
  '#c4b5fd', '#e9d5ff', '#fbcfe8', '#fecdd3',
];

const validateSlug = value => {
  if (!value) return 'Slug requerido para tu tienda.';
  const v = String(value).toLowerCase().trim();
  if (!SLUG_PATTERN.test(v)) return 'Solo letras minúsculas, números y guiones. 2-40 caracteres.';
  if (RESERVED_SLUGS.has(v)) return 'Este slug está reservado. Elige otro.';
  return undefined;
};

const validateHex = value => {
  if (!value) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(String(value).trim())) return 'Formato HEX: #RRGGBB';
  return undefined;
};

const validateUrl = value => {
  if (!value) return undefined;
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Debe ser una URL http:// o https://';
    return undefined;
  } catch {
    return 'URL inválida';
  }
};

const validateWhatsapp = value => {
  if (!value) return undefined;
  const clean = String(value).replace(/[^\d]/g, '');
  if (clean.length < 10 || clean.length > 15) return 'Entre 10 y 15 dígitos, sin espacios ni "+"';
  return undefined;
};

const isValidHex = v => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());
const isValidUrl = v => {
  if (!v) return false;
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

// XOLOLO: componente de paleta con swatches — swap del selector de color.
// El seller ve una malla 4x4 de tonos aprobados, clickea el que le gusta
// y se pinta un check. También hay input HEX y color picker nativo para
// quien quiera un tono específico.
const PaletteField = ({ name, label, palette, defaultColor }) => {
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <Field name={name} validate={validateHex}>
      {({ input, meta }) => {
        const current = (input.value || '').toLowerCase();
        const isInPalette = palette.some(c => c.toLowerCase() === current);
        const previewColor = isValidHex(current) ? current : defaultColor;

        return (
          <div className={css.paletteWrap}>
            <div className={css.paletteHeader}>
              <label className={css.paletteLabel}>{label}</label>
              <div className={css.palettePreview}>
                <span
                  className={css.paletteSwatchPreview}
                  style={{ backgroundColor: previewColor }}
                  aria-hidden="true"
                />
                <code className={css.paletteHex}>{previewColor}</code>
              </div>
            </div>

            <div className={css.paletteGrid}>
              {palette.map(color => {
                const isSelected = current === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    className={classNames(css.paletteSwatch, {
                      [css.paletteSwatchSelected]: isSelected,
                    })}
                    style={{ backgroundColor: color }}
                    aria-label={`Elegir color ${color}`}
                    aria-pressed={isSelected}
                    onClick={() => input.onChange(color)}
                  >
                    {isSelected ? <span className={css.paletteCheck} aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className={css.customToggle}
              onClick={() => setCustomOpen(o => !o)}
            >
              {customOpen
                ? '− Cerrar color personalizado'
                : (isInPalette || !current
                    ? '+ Usar un color propio (HEX o picker)'
                    : '+ Editar mi color personalizado')}
            </button>

            {customOpen ? (
              <div className={css.customRow}>
                <input
                  type="color"
                  value={isValidHex(current) ? current : defaultColor}
                  onChange={e => input.onChange(e.target.value)}
                  className={css.colorPicker}
                  aria-label={`${label} — selector de color`}
                />
                <input
                  type="text"
                  {...input}
                  placeholder={defaultColor}
                  className={css.colorHexInput}
                  spellCheck={false}
                />
              </div>
            ) : null}

            {meta.touched && meta.error ? (
              <span className={css.fieldError}>{meta.error}</span>
            ) : null}
          </div>
        );
      }}
    </Field>
  );
};

// Preview vivo de la URL de la tienda ("tu-slug.xololo.mx ↗") mientras
// el seller teclea. Cuando el slug es válido queda linkeado y se abre
// en pestaña nueva.
const SlugPreview = ({ slug }) => {
  const clean = String(slug || '').toLowerCase().trim();
  const isValid = clean && SLUG_PATTERN.test(clean) && !RESERVED_SLUGS.has(clean);
  const isLocal =
    typeof window !== 'undefined' && /localhost/.test(window.location.hostname);
  const host = isLocal ? `${clean || 'tu-slug'}.localhost:3000` : `${clean || 'tu-slug'}.xololo.mx`;
  const href = isLocal ? `http://${host}` : `https://${host}`;

  return (
    <p className={css.hint}>
      Tu tienda quedará en{' '}
      {isValid ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={css.hintLink}>
          <code className={css.code}>{host}</code> ↗
        </a>
      ) : (
        <code className={css.code}>{host}</code>
      )}
    </p>
  );
};

const ManageStoreForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        className,
        handleSubmit,
        invalid,
        pristine,
        submitting,
        inProgress,
        ready,
        saveStoreError,
        values,
      } = formRenderProps;

      const submitInProgress = submitting || inProgress;
      const submitDisabled = invalid || pristine || submitInProgress;

      return (
        <Form className={classNames(className, css.form)} onSubmit={handleSubmit}>
          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>
              <span aria-hidden="true" className={css.sectionIcon}>🏷️</span>
              Identidad de tu tienda
            </legend>

            <FieldTextInput
              className={css.field}
              type="text"
              id="slug"
              name="slug"
              label="Slug — el subdominio de tu tienda"
              placeholder="mi-tienda"
              validate={validateSlug}
            />
            <SlugPreview slug={values?.slug} />

            <FieldTextInput
              className={css.field}
              type="text"
              id="shortDescription"
              name="shortDescription"
              label="Descripción corta"
              placeholder="Frase que aparece bajo el nombre de tu tienda"
              maxLength={120}
            />

            <FieldTextInput
              className={css.field}
              type="textarea"
              id="longDescription"
              name="longDescription"
              label="Sobre nosotros"
              placeholder="Cuéntanos quién eres, qué haces y por qué eliges Xololo"
              rows={5}
            />

            <FieldSelect
              className={css.field}
              id="primaryCategory"
              name="primaryCategory"
              label="Categoría principal de tu tienda"
            >
              <option value="">Selecciona una categoría</option>
              <option value="artesanias">Artesanías</option>
              <option value="hogar">Hogar</option>
              <option value="moda">Moda</option>
              <option value="belleza">Belleza</option>
              <option value="alimentos">Alimentos</option>
              <option value="tecnologia">Tecnología</option>
              <option value="mascotas">Mascotas</option>
              <option value="papeleria">Papelería</option>
              <option value="turismo">Turismo</option>
              <option value="servicios-pro">Servicios pro</option>
            </FieldSelect>
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>
              <span aria-hidden="true" className={css.sectionIcon}>🎨</span>
              Look de tu tienda
            </legend>

            <PaletteField
              name="brandPrimaryColor"
              label="Color primario — botones y encabezados"
              palette={PRIMARY_PALETTE}
              defaultColor="#1f8f52"
            />

            <PaletteField
              name="brandSecondaryColor"
              label="Color secundario — bandas y detalles"
              palette={SECONDARY_PALETTE}
              defaultColor="#6bcb8c"
            />

            <ImageUploadField
              name="logoUrl"
              kind="logo"
              label="Logo de tu tienda"
              hint="PNG con fondo transparente, alto ~200 px. Se muestra en el header de tu storefront."
            />

            <ImageUploadField
              name="bannerUrl"
              kind="banner"
              label="Banner publicitario"
              hint="Imagen horizontal (1600 x 400 px recomendado). Aparece bajo el header de tu storefront."
              aspectRatio="4 / 1"
            />
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>
              <span aria-hidden="true" className={css.sectionIcon}>📱</span>
              Contacto directo
            </legend>

            <FieldTextInput
              className={css.field}
              type="text"
              id="whatsapp"
              name="whatsapp"
              label="WhatsApp"
              placeholder="521XXXXXXXXXX"
              validate={validateWhatsapp}
            />
            <p className={css.hint}>
              Formato internacional sin “+” ni espacios. México: empieza con
              521 seguido del número a 10 dígitos.
            </p>

            <FieldTextInput
              className={css.field}
              type="text"
              id="instagram"
              name="instagram"
              label="Instagram — sin @"
              placeholder="mi_tienda"
            />
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>
              <span aria-hidden="true" className={css.sectionIcon}>📅</span>
              Disponibilidad
            </legend>

            <FieldSelect
              className={css.field}
              id="showCalendar"
              name="showCalendar"
              label="Mostrar sección de disponibilidad en tu storefront"
            >
              <option value="no">No mostrar</option>
              <option value="yes">Sí, mostrar calendario</option>
            </FieldSelect>
            <p className={css.hint}>
              Actívalo si vendes servicios con reserva por hora o por día.
              La sección aparece bajo el catálogo con las próximas fechas.
            </p>
          </fieldset>

          {saveStoreError ? (
            <p className={css.error}>
              No pudimos guardar los cambios. Intenta de nuevo o revisa que los
              datos sean válidos.
            </p>
          ) : null}
          {ready ? (
            <p className={css.success}>Cambios guardados. Tu storefront se actualizó.</p>
          ) : null}

          <PrimaryButton
            className={css.submit}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={ready}
          >
            Guardar cambios
          </PrimaryButton>
        </Form>
      );
    }}
  />
);

export default ManageStoreForm;
