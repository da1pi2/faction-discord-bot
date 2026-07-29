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

/**
 * Converte una Date di JS in Unix timestamp in secondi
 */
function toUnixTimestamp(date) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Calcola il timestamp Unix per un'ora UTC di oggi (o domani se già passata)
 * @param {number} utcHour - Ora in UTC (es. 18 o 18.5)
 */
function getTodayUtcHourTimestamp(utcHour) {
  const now = new Date();
  const hours = Math.floor(utcHour);
  const minutes = Math.round((utcHour - hours) * 60);

  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0));
  
  return Math.floor(target.getTime() / 1000);
}

module.exports = { currentUtcHour, toLocalHour, statusForOffsetAtUtcHour, formatHour, toUnixTimestamp, getTodayUtcHourTimestamp };