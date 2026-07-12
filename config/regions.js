// Mappatura regione -> offset UTC approssimato.
// Un solo offset per regione (niente ruoli per ogni fuso specifico).
// Modifica questi valori in base a dove sono REALMENTE i tuoi membri,
// non in base alla geografia teorica.
const REGIONS = {
  Americas: { emoji: '🌎', label: 'Americas', roleName: 'Americas', offset: -5 },
  Europe: { emoji: '🇪🇺', label: 'Europe', roleName: 'Europe', offset: 1 },
  Africa: { emoji: '🌍', label: 'Africa', roleName: 'Africa', offset: 2 },
  MiddleEast: { emoji: '🇸🇦', label: 'Middle East', roleName: 'Middle East', offset: 3 },
  India: { emoji: '🇮🇳', label: 'India', roleName: 'India', offset: 5.5 },
  Asia: { emoji: '🌏', label: 'Asia', roleName: 'Asia', offset: 8 },
  Oceania: { emoji: '🇦🇺', label: 'Oceania', roleName: 'Oceania', offset: 10 },
};

// Ruoli di stato temporanei gestiti dal bot.
const STATUS_ROLES = {
  day: { emoji: '☀️', label: 'Day', roleName: 'Status: Day' },
  peak: { emoji: '🔥', label: 'Peak Time', roleName: 'Status: Peak Time' },
  night: { emoji: '🌙', label: 'Night', roleName: 'Status: Night' },
};

// Fasce orarie locali (ora locale del membro, 0-23.99) -> stato.
// 08:00-18:00 Day, 18:00-23:00 Peak, 23:00-08:00 Night
function statusFromLocalHour(localHour) {
  if (localHour >= 8 && localHour < 18) return 'day';
  if (localHour >= 18 && localHour < 23) return 'peak';
  return 'night';
}

module.exports = { REGIONS, STATUS_ROLES, statusFromLocalHour };
