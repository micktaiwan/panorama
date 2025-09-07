export const fmtPlain = (cents) => (Number(cents || 0) / 100).toFixed(2);

export const fmtDisplay = (cents) =>
  new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents || 0) / 100);

export const fmtDisplayNoCents = (cents) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Math.round(Number(cents || 0) / 100)
  );

export const fmtCopyNoCents = (cents) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(
    Math.round(Number(cents || 0) / 100)
  );

export const yyyymm = (dateValue) => {
  if (!dateValue) return 'unknown';
  const stringValue = String(dateValue);
  if (/^\d{4}-\d{2}-\d{2}/.test(stringValue)) return stringValue.slice(0, 7);
  const dt = new Date(dateValue);
  if (!Number.isNaN(dt.getTime())) {
    const month = (dt.getMonth() + 1).toString().padStart(2, '0');
    return `${dt.getFullYear()}-${month}`;
  }
  return 'unknown';
};


