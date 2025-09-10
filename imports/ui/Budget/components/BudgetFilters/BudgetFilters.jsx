import React from 'react';

export const BudgetFilters = ({
  departmentEnabled = true,
  teamEnabled = false,
  searchEnabled = true,
  departmentValue,
  onDepartmentChange,
  teamValue,
  onTeamChange,
  searchValue,
  onSearchChange,
}) => {
  return (
    <>
      {departmentEnabled ? (
        <label>
          <span className="mr4">Filter:</span>
          <select className="budgetSelect" value={departmentValue} onChange={(e) => onDepartmentChange && onDepartmentChange(e.target.value)}>
            <option value="all">All</option>
            <option value="techOnly">Tech</option>
            <option value="product">Product</option>
            <option value="other">Other</option>
            <option value="parked">Parked</option>
            <option value="review">To review</option>
          </select>
        </label>
      ) : null}
      {teamEnabled ? (
        <label>
          <span className="mr4">Team:</span>
          <select className="budgetSelect" value={teamValue} onChange={(e) => onTeamChange && onTeamChange(e.target.value)}>
            <option value="all">All teams</option>
            <option value="lemapp">LEMAPP</option>
            <option value="sre">SRE</option>
            <option value="data">DATA</option>
            <option value="pony">PONY</option>
            <option value="cto">CTO</option>
            <option value="review">To review</option>
          </select>
        </label>
      ) : null}
      {searchEnabled ? (
        <input className="budgetSearch" placeholder="Search vendor" value={searchValue} onChange={(e) => onSearchChange && onSearchChange(e.target.value)} />
      ) : null}
    </>
  );
};

export default BudgetFilters;


