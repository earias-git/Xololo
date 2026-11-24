import React from 'react';
import { Field, useForm } from 'react-final-form';
import classNames from 'classnames';

import { THEMES, themeToFormPatch } from '../../../util/xololoStorefrontThemes';

import css from './ThemeSelector.module.css';

// XOLOLO Web Studio PR 3 — selector de tema base del storefront.
//
// Al elegir un tema, hace `form.change` sobre:
//   - storefrontTheme (id del tema)
//   - brandPrimaryColor y brandSecondaryColor (colores del tema)
// No toca logo ni banners — el seller ya puede haberlos subido.
//
// El campo subyacente `storefrontTheme` se persiste como parte del
// branding (ver BRANDING_FIELDS en xololoStorefrontDraft) — así el
// cambio también va al borrador, nunca directo a producción.
//
// "Custom" (ningún tema seleccionado) es un estado legítimo: el seller
// que no quiere usar presets simplemente no elige. No pintamos un chip
// "ninguno", lo representamos como que ningún tile tiene `on`.

const ThemeTile = ({ theme, selected, onSelect }) => {
  // Tile compacto: franja tripartita de colores + nombre + un line clamp
  // de 2 para la descripción. Mantiene la caja BAJA — en grids de 4 col
  // desktop el tile queda ~180-260px wide pero su altura no explota.
  // Lista "fitFor" se removió del tile para no sumar alto; sigue como
  // tooltip/aria descriptivo.
  return (
    <button
      type="button"
      className={classNames(css.tile, { [css.tileSelected]: selected })}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Elegir tema ${theme.name} — ${theme.description}. Para ${theme.fitFor}.`}
      title={`${theme.description}\nPara: ${theme.fitFor}`}
    >
      <span className={css.tilePreview} aria-hidden="true">
        <span
          className={css.tileSwatch}
          style={{ background: theme.brandPrimaryColor }}
        />
        <span
          className={css.tileSwatch}
          style={{ background: '#ffffff', borderLeft: '1px solid rgba(0,0,0,0.05)' }}
        />
        <span
          className={css.tileSwatch}
          style={{ background: theme.brandSecondaryColor }}
        />
      </span>
      <span className={css.tileBody}>
        <span className={css.tileName}>
          {theme.name}
          {selected ? <span className={css.tileCheck} aria-hidden="true">✓</span> : null}
        </span>
        <span className={css.tileDesc}>{theme.description}</span>
      </span>
    </button>
  );
};

const ThemeSelector = () => {
  const form = useForm();

  const applyTheme = themeId => {
    const patch = themeToFormPatch(themeId);
    if (!patch) return;
    // Final Form: aplicar cada campo del patch individualmente.
    for (const [field, value] of Object.entries(patch)) {
      form.change(field, value);
    }
  };

  // Suscribimos a `storefrontTheme` para resaltar el tile correcto.
  // Usamos Field con subscription acotada — re-renderea sólo si cambia
  // el id del tema, no cada vez que el seller toca un color.
  return (
    <Field name="storefrontTheme" subscription={{ value: true }}>
      {({ input: { value: selectedId } }) => (
        <div className={css.root}>
          <div className={css.head}>
            <span className={css.eyebrow}>Tema base</span>
            <p className={css.hint}>
              Un punto de arranque opinado. Elige el que mejor va con lo que vendes y luego
              ajusta los colores si quieres.
            </p>
          </div>
          <div className={css.grid}>
            {THEMES.map(t => (
              <ThemeTile
                key={t.id}
                theme={t}
                selected={selectedId === t.id}
                onSelect={() => applyTheme(t.id)}
              />
            ))}
          </div>
          {selectedId ? (
            <button
              type="button"
              className={css.clearBtn}
              onClick={() => form.change('storefrontTheme', null)}
            >
              Quitar tema (colores actuales se conservan)
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
};

export default ThemeSelector;
