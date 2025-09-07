import React from 'react';
import './Card.css';

export const Card = ({ title, actions, className = '', children }) => {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="cardHeader">
          {title ? <h3 className="cardTitle">{title}</h3> : <span />}
          {actions ? <div className="cardActions">{actions}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
};


