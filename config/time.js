// Ruoli di stato temporanei gestiti dal bot.
const STATUS_ROLES = {
  available: { emoji: '✅', label: 'Available Now', roleName: '✅ Available Now' },
  day: { emoji: '☀️', label: 'Day', roleName: '☀️ Day' },
  night: { emoji: '🌙', label: 'Night', roleName: '🌙 Night' },
};

// Logica semplificata: Available (se in slot), Day (8-23 locali), Night (23-8 locali)
function statusFromLocalHour(localHour, slots = []) {
  if (slots && slots.length > 0) {
    const isAvailable = slots.some((slot) => {
      const { available_start: start, available_end: end } = slot;
      return start <= end
        ? (localHour >= start && localHour < end)
        : (localHour >= start || localHour < end);
    });

    if (isAvailable) return 'available';
  }

  if (localHour >= 8 && localHour < 23) return 'day';
  return 'night';
}

module.exports = { STATUS_ROLES, statusFromLocalHour };