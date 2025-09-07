import React, { useState } from 'react';
import './Tooltip.css';

export const Tooltip = ({ content, children, placement = 'top', size = 'normal' }) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={`tooltip tooltip-${placement} ${size === 'large' ? 'tooltip-lg' : ''}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <span
        className={`tooltipContent ${visible ? 'visible' : ''}`}
        role="tooltip"
      >
        {content}
        <span className="tooltipArrow" />
      </span>
    </span>
  );
};


