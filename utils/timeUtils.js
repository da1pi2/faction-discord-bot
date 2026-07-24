const { statusFromLocalHour } = require('../config/time');

function currentUtcHour() {
  const now = new Date();
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

function toLocalHour(utcHour, offset) {
  let local = (utcHour + offset) % 24;
  if (local < 0) local += 24;
  return local;
}

// Aggiornata per inoltrare i parametri dello slot custom
function statusForOffsetAtUtcHour(utcHour, offset, slots = []) {
  return statusFromLocalHour(toLocalHour(utcHour, offset), slots);
}

function formatHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

module.exports = { currentUtcHour, toLocalHour, statusForOffsetAtUtcHour, formatHour };