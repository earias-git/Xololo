import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import css from './HeroCarousel.module.css';

const AUTOPLAY_INTERVAL_MS = 6000;

// XOLOLO: hero carrusel del landing page.
// Muestra un solo slide a ancho completo con la imagen de fondo, el texto
// encima y hasta dos CTAs. Rota automáticamente a menos que el visitante
// prefiera reduced motion; se pausa al pasar el mouse o al enfocar con
// teclado, y expone flechas prev/next y bullets para navegación manual.
const HeroCarousel = props => {
  const { slides, className, rootClassName } = props;
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef(null);
  const numSlides = slides?.length || 0;

  const goTo = useCallback(
    idx => {
      if (!numSlides) return;
      const next = ((idx % numSlides) + numSlides) % numSlides;
      setActiveIdx(next);
    },
    [numSlides]
  );

  const goNext = useCallback(() => goTo(activeIdx + 1), [goTo, activeIdx]);
  const goPrev = useCallback(() => goTo(activeIdx - 1), [goTo, activeIdx]);

  // Autoplay
  useEffect(() => {
    if (numSlides <= 1) return undefined;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) return undefined;

    const container = containerRef.current;
    let intervalId = null;
    let paused = false;

    const tick = () => {
      if (!paused) setActiveIdx(prev => (prev + 1) % numSlides);
    };

    const start = () => {
      if (intervalId == null) intervalId = window.setInterval(tick, AUTOPLAY_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const pause = () => {
      paused = true;
    };
    const resume = () => {
      paused = false;
    };

    start();
    container?.addEventListener('mouseenter', pause);
    container?.addEventListener('mouseleave', resume);
    container?.addEventListener('focusin', pause);
    container?.addEventListener('focusout', resume);

    return () => {
      stop();
      container?.removeEventListener('mouseenter', pause);
      container?.removeEventListener('mouseleave', resume);
      container?.removeEventListener('focusin', pause);
      container?.removeEventListener('focusout', resume);
    };
  }, [numSlides]);

  if (!numSlides) {
    return null;
  }

  const renderCta = (cta, idx) => {
    const buttonClass = classNames(css.cta, {
      [css.ctaPrimary]: cta.variant !== 'ghost',
      [css.ctaGhost]: cta.variant === 'ghost',
    });
    // External absolute URL -> plain <a>; otherwise use NamedLink for internal SPA nav.
    // For simplicity we route everything through a plain <a> so search paths (/s?...) work.
    return (
      <a key={idx} className={buttonClass} href={cta.href}>
        {cta.label}
      </a>
    );
  };

  return (
    <section
      ref={containerRef}
      className={classNames(rootClassName || css.root, className)}
      aria-roledescription="carousel"
      aria-label="Xololo hero"
    >
      <div className={css.viewport}>
        {slides.map((slide, idx) => {
          const isActive = idx === activeIdx;
          return (
            <div
              key={slide.id || idx}
              className={classNames(css.slide, { [css.slideActive]: isActive })}
              role="group"
              aria-roledescription="slide"
              aria-label={`${idx + 1} de ${numSlides}`}
              aria-hidden={!isActive}
              style={{ backgroundImage: `url(${slide.background})` }}
            >
              <div className={css.overlay} aria-hidden="true" />
              <div className={css.content}>
                {slide.eyebrow ? <p className={css.eyebrow}>{slide.eyebrow}</p> : null}
                <h1 className={css.title}>{slide.title}</h1>
                {slide.description ? <p className={css.description}>{slide.description}</p> : null}
                {slide.ctas && slide.ctas.length ? (
                  <div className={css.ctas}>{slide.ctas.map(renderCta)}</div>
                ) : null}
                {slide.note ? <p className={css.note}>{slide.note}</p> : null}
              </div>
            </div>
          );
        })}
      </div>

      {numSlides > 1 ? (
        <>
          <button
            type="button"
            className={classNames(css.arrow, css.arrowPrev)}
            onClick={goPrev}
            aria-label="Slide anterior"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={classNames(css.arrow, css.arrowNext)}
            onClick={goNext}
            aria-label="Slide siguiente"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className={css.dots} role="tablist" aria-label="Elegir slide">
            {slides.map((slide, idx) => (
              <button
                key={slide.id || idx}
                type="button"
                role="tab"
                aria-selected={idx === activeIdx}
                aria-label={`Ir al slide ${idx + 1}`}
                className={classNames(css.dot, { [css.dotActive]: idx === activeIdx })}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
};

export default HeroCarousel;
