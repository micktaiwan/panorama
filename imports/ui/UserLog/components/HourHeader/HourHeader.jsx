import React from 'react';
import PropTypes from 'prop-types';
import './HourHeader.css';

export const HourHeader = ({ label }) => {
  return <div className="UserLog__hourHeader">{label}</div>;
};

HourHeader.propTypes = {
  label: PropTypes.string.isRequired,
};



