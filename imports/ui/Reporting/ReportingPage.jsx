import React, { useState } from 'react';
import './ReportingPage.css';
import { ActivitySummary } from '/imports/ui/components/ActivitySummary/ActivitySummary.jsx';

export const ReportingPage = () => {
  const [projFilters, setProjFilters] = useState(() => {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem('reporting_proj_filters');
    if (!raw) return {};
    return JSON.parse(raw) || {};
  });

  const handleFiltersChange = (filters) => {
    const next = filters || {};
    setProjFilters(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reporting_proj_filters', JSON.stringify(next));
    }
  };

  return (
    <div className="reportingPage">
      <ActivitySummary
        projectFilters={projFilters}
        showProjectFilter={true}
        title="Activity Summary"
        onFiltersChange={handleFiltersChange}
      />
    </div>
  );
};


