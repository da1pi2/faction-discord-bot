

// Ruoli di stato temporanei gestiti dal bot.
const STATUS_ROLES = {
  day: { emoji: '☀️', label: 'Day', roleName: '☀️ Day' },
  peak: { emoji: '🔥', label: 'Peak Time', roleName: '🔥 Peak Time' },
  night: { emoji: '🌙', label: 'Night', roleName: '🌙 Night' },
};

// Fasce orarie locali (ora locale del membro, 0-23.99) -> stato.
// 08:00-18:00 Day, 18:00-23:00 Peak, 23:00-08:00 Night
function statusFromLocalHour(localHour) {
  if (localHour >= 8 && localHour < 18) return 'day';
  if (localHour >= 18 && localHour < 23) return 'peak';
  return 'night';
}

module.exports = {STATUS_ROLES, statusFromLocalHour };
