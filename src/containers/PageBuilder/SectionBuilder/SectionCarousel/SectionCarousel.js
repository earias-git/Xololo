import React, { useEffect } from 'react';
import classNames from 'classnames';

import Field, { hasDataInFields } from '../../Field';
import BlockBuilder from '../../BlockBuilder';

import SectionContainer from '../SectionContainer';
import css from './SectionCarousel.module.css';

const KEY_CODE_ARROW_LEFT = 37;
const KEY_CODE_ARROW_RIGHT = 39;

// XOLOLO: carousels with more blocks than visible columns rotate on their own,
// like the promotional banner carousels on marketplaces such as Mercado Libre.
const AUTOPLAY_INTERVAL_MS = 5000;
// How close to the end (in px) counts as "at the end", so autoplay loops back to the start
// instead of getting stuck once native scroll clamping stops further movement.
const END_OF_SCROLL_THRESHOLD_PX = 8;

// The number of columns (numColumns) affects styling and responsive images
const COLUMN_CONFIG = [
  { css: css.oneColumn, responsiveImageSizes: '(max-width: 767px) 100vw, 1200px' },
  { css: css.twoColumns, responsiveImageSizes: '(max-width: 767px) 100vw, 600px' },
  { css: css.threeColumns, responsiveImageSizes: '(max-width: 767px) 100vw, 400px' },
  { css: css.fourColumns, responsiveImageSizes: '(max-width: 767px) 100vw, 290px' },
];
const getIndex = numColumns => numColumns - 1;
const getColumnCSS = numColumns => {
  const config = COLUMN_CONFIG[getIndex(numColumns)];
  return config ? config.css : COLUMN_CONFIG[0].css;
};
const getResponsiveImageSizes = numColumns => {
  const config = COLUMN_CONFIG[getIndex(numColumns)];
  return config ? config.responsiveImageSizes : COLUMN_CONFIG[0].responsiveImageSizes;
};

/**
 * @typedef {Object} BlockConfig
 * @property {string} blockId
 * @property {string} blockName
 * @property {'defaultBlock' | 'footerBlock' | 'socialMediaLink'} blockType
 */

/**
 * @typedef {Object} FieldComponentConfig
 * @property {ReactNode} component
 * @property {Function} pickValidProps
 */

/**
 * Section component that's able to show blocks in a carousel.
 * The number blocks visible is defined by "numColumns" prop.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to components own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {Object} props.defaultClasses
 * @param {string} props.defaultClasses.sectionDetails
 * @param {string} props.defaultClasses.title
 * @param {string} props.defaultClasses.description
 * @param {string} props.defaultClasses.ctaButton
 * @param {string} props.sectionId id of the section
 * @param {'carousel'} props.sectionType
 * @param {number?} props.numColumns
 * @param {Object?} props.title
 * @param {Object?} props.description
 * @param {Object?} props.appearance
 * @param {Object?} props.callToAction
 * @param {Array<BlockConfig>?} props.blocks array of block configs
 * @param {boolean?} props.isInsideContainer
 * @param {Object} props.options extra options for the section component (e.g. custom fieldComponents)
 * @param {Object<string,FieldComponentConfig>?} props.options.fieldComponents custom fields
 * @returns {JSX.Element} Section for article content
 */
const SectionCarousel = props => {
  const {
    sectionId,
    className,
    rootClassName,
    defaultClasses,
    numColumns = 1,
    title,
    description,
    appearance,
    callToAction,
    blocks = [],
    options,
  } = props;
  const sliderContainerId = `${props.sectionId}-container`;
  const sliderId = `${props.sectionId}-slider`;
  const numberOfBlocks = blocks?.length;
  const hasBlocks = numberOfBlocks > 0;

  useEffect(() => {
    const setCarouselWidth = () => {
      if (hasBlocks) {
        const windowWidth = window.innerWidth;
        const elem = window.document.getElementById(sliderContainerId);
        const scrollbarWidth = window.innerWidth - document.body.clientWidth;
        const elementWidth =
          elem.clientWidth >= windowWidth - scrollbarWidth ? windowWidth : elem.clientWidth;
        const carouselWidth = elementWidth - scrollbarWidth;

        elem.style.setProperty('--carouselWidth', `${carouselWidth}px`);
      }
    };
    setCarouselWidth();

    window.addEventListener('resize', setCarouselWidth);
    return () => window.removeEventListener('resize', setCarouselWidth);
  }, []);

  const isAtEnd = slider => {
    return slider.scrollLeft + slider.clientWidth >= slider.scrollWidth - END_OF_SCROLL_THRESHOLD_PX;
  };

  const advanceSlide = () => {
    const slider = window.document.getElementById(sliderId);
    if (!slider) {
      return;
    }
    const slideWidth = numColumns * slider?.firstChild?.clientWidth;
    slider.scrollLeft = isAtEnd(slider) ? 0 : slider.scrollLeft + slideWidth;
  };

  // XOLOLO: autoplay for carousels that have more blocks than fit in view at once.
  // Paused while the pointer or keyboard focus is inside the carousel, and skipped
  // entirely when the visitor prefers reduced motion.
  useEffect(() => {
    const canAutoplay = hasBlocks && numberOfBlocks > numColumns;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (!canAutoplay || prefersReducedMotion) {
      return undefined;
    }

    const container = window.document.getElementById(sliderContainerId);
    let intervalId = null;

    const start = () => {
      stop();
      intervalId = window.setInterval(advanceSlide, AUTOPLAY_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    start();
    container?.addEventListener('mouseenter', stop);
    container?.addEventListener('mouseleave', start);
    container?.addEventListener('focusin', stop);
    container?.addEventListener('focusout', start);

    return () => {
      stop();
      container?.removeEventListener('mouseenter', stop);
      container?.removeEventListener('mouseleave', start);
      container?.removeEventListener('focusin', stop);
      container?.removeEventListener('focusout', start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBlocks, numberOfBlocks, numColumns]);

  // If external mapping has been included for fields
  // E.g. { h1: { component: MyAwesomeHeader } }
  const fieldComponents = options?.fieldComponents;
  const fieldOptions = { fieldComponents };

  const hasHeaderFields = hasDataInFields([title, description, callToAction], fieldOptions);

  const onSlideLeft = e => {
    var slider = window.document.getElementById(sliderId);
    const slideWidth = numColumns * slider?.firstChild?.clientWidth;
    slider.scrollLeft = slider.scrollLeft - slideWidth;
    // Fix for Safari
    e.target.focus();
  };

  const onSlideRight = e => {
    advanceSlide();
    // Fix for Safari
    e.target.focus();
  };

  const onKeyDown = e => {
    if (e.keyCode === KEY_CODE_ARROW_LEFT) {
      // Prevent changing cursor position in input
      e.preventDefault();
      onSlideLeft(e);
    } else if (e.keyCode === KEY_CODE_ARROW_RIGHT) {
      // Prevent changing cursor position in input
      e.preventDefault();
      onSlideRight(e);
    }
  };

  return (
    <SectionContainer
      id={sectionId}
      className={className}
      rootClassName={rootClassName}
      appearance={appearance}
      options={fieldOptions}
    >
      {hasHeaderFields ? (
        <header className={defaultClasses.sectionDetails}>
          <Field data={title} className={defaultClasses.title} options={fieldOptions} />
          <Field data={description} className={defaultClasses.description} options={fieldOptions} />
          <Field data={callToAction} className={defaultClasses.ctaButton} options={fieldOptions} />
        </header>
      ) : null}
      {hasBlocks ? (
        <div className={css.carouselContainer} id={sliderContainerId}>
          <div
            className={classNames(css.carouselArrows, {
              [css.notEnoughBlocks]: numberOfBlocks <= numColumns,
            })}
          >
            <button className={css.carouselArrowPrev} onClick={onSlideLeft} onKeyDown={onKeyDown}>
              ‹
            </button>
            <button className={css.carouselArrowNext} onClick={onSlideRight} onKeyDown={onKeyDown}>
              ›
            </button>
          </div>
          <div className={getColumnCSS(numColumns)} id={sliderId}>
            <BlockBuilder
              rootClassName={css.block}
              ctaButtonClass={defaultClasses.ctaButton}
              blocks={blocks}
              sectionId={sectionId}
              responsiveImageSizes={getResponsiveImageSizes(numColumns)}
              options={options}
            />
          </div>
        </div>
      ) : null}
    </SectionContainer>
  );
};

export default SectionCarousel;
