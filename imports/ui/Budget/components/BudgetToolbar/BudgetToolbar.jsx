import React from 'react';
import './BudgetToolbar.css';

export const BudgetToolbar = ({ children, className = '' }) => {
  return (
    <div className={`budgetToolbar ${className}`}>
      {children}
    </div>
  );
};

export default BudgetToolbar;


