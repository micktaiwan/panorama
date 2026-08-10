import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import './Tooltip.css';

// Distance kept from the viewport edges before flipping or nudging the bubble
const MARGIN = 8;

const PLACEMENTS = ['top', 'bottom', 'right', 'left'];

// Which side would keep the bubble inside the viewport
const sideFor = (side, rect) => {
  if (side === 'top' && rect.top < MARGIN) return 'bottom';
  if (side === 'bottom' && rect.bottom > window.innerHeight - MARGIN) return 'top';
  if (side === 'right' && rect.right > window.innerWidth - MARGIN) return 'left';
  if (side === 'left' && rect.left < MARGIN) return 'right';
  return side;
};

const anchorX = (side, rect) => {
  if (side === 'right') return rect.right;
  if (side === 'left') return rect.left;
  return rect.left + (rect.width / 2);
};

const anchorY = (side, rect) => {
  if (side === 'top') return rect.top;
  if (side === 'bottom') return rect.bottom;
  return rect.top + (rect.height / 2);
};

export const Tooltip = ({ content, children, placement = 'top', size = 'normal', className = '' }) => {
  // The bubble is rendered in a portal with fixed positioning: an absolutely
  // positioned bubble gets clipped by the scrollable lists tooltips live in.
  const [anchor, setAnchor] = useState(null);
  const [side, setSide] = useState(placement);
  const [shift, setShift] = useState(0);
  const triggerRef = useRef(null);
  const bubbleRef = useRef(null);
  const flippedRef = useRef(false);

  const show = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    flippedRef.current = false;
    setSide(placement);
    setShift(0);
    setAnchor(rect);
  }, [placement]);

  const hide = useCallback(() => setAnchor(null), []);

  // A fixed bubble would drift away from its trigger on scroll/resize
  useEffect(() => {
    if (!anchor) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  // Correct the placement once the bubble has been measured: flip to the
  // opposite side, then nudge horizontally. Each correction settles in one
  // extra pass, and the flip happens at most once per hover.
  useLayoutEffect(() => {
    if (!anchor) return;
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!flippedRef.current) {
      const next = sideFor(side, rect);
      if (next !== side) {
        flippedRef.current = true;
        setSide(next);
        return;
      }
    }
    if (side !== 'top' && side !== 'bottom') return;
    const overflowRight = rect.right - (window.innerWidth - MARGIN);
    const overflowLeft = MARGIN - rect.left;
    if (overflowRight > 0) setShift(s => s - overflowRight);
    else if (overflowLeft > 0) setShift(s => s + overflowLeft);
  }, [anchor, side, shift]);

  // An empty content would show an empty bubble: stay out of the way instead
  const hasContent = content !== null && content !== undefined && content !== '';

  const bubble = (anchor && hasContent) ? createPortal(
    (
      <span
        ref={bubbleRef}
        className={`tooltipBubble tooltipBubble-${side}${size === 'large' ? ' tooltipBubble-lg' : ''}`}
        role="tooltip"
        style={{
          ['--tooltip-x']: `${anchorX(side, anchor) + shift}px`,
          ['--tooltip-y']: `${anchorY(side, anchor)}px`,
          ['--tooltip-shift']: `${shift}px`
        }}
      >
        {content}
        <span className="tooltipArrow" />
      </span>
    ),
    document.body
  ) : null;

  return (
    <span
      ref={triggerRef}
      className={`tooltipTrigger${className ? ` ${className}` : ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {bubble}
    </span>
  );
};

Tooltip.propTypes = {
  content: PropTypes.node,
  children: PropTypes.node,
  placement: PropTypes.oneOf(PLACEMENTS),
  size: PropTypes.oneOf(['normal', 'large']),
  className: PropTypes.string
};
