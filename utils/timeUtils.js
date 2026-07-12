const { statusFromLocalHour } = require('../config/regions');

// Ora UTC corrente come numero decimale (es. 14.5 = 14:30 UTC)
function currentUtcHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

// Converte un'ora UTC (decimale) nell'ora locale di una regione dato l'offset
function toLocalHour(utcHour, offset) {
  let local = (utcHour + offset) % 24;
  if (local < 0) local += 24;
  return local;
}

// Dato un utcHour e un offset regione, restituisce 'day' | 'peak' | 'night'
function statusForRegionAtUtcHour(utcHour, offset) {
  return statusFromLocalHour(toLocalHour(utcHour, offset));
}

function formatHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

module.exports = { currentUtcHour, toLocalHour, statusForRegionAtUtcHour, formatHour };
