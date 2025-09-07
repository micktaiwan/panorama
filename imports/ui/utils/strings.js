export const normalizeString = (s) => {
  const base = String(s || '').trim().toLowerCase();
  return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
};

export const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
