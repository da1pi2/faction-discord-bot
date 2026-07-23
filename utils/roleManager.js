const { STATUS_ROLES } = require('../config/time');
const { getAllTimezones } = require('../data/db');
const { currentUtcHour, statusForOffsetAtUtcHour } = require('./timeUtils');

// Crea i ruoli di stato (Day/Peak/Night) sul server se non esistono ancora.
// Va chiamato una volta all'avvio del bot per ogni guild.
async function ensureStatusRolesExist(guild) {
  const roleMap = {};
  for (const key of Object.keys(STATUS_ROLES)) {
    const { roleName } = STATUS_ROLES[key];
    let role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      role = await guild.roles.create({
        name: roleName,
        mentionable: true,
        reason: 'Alliance activity status role (created automatically)',
      });
    }
    roleMap[key] = role;
  }
  return roleMap;
}

async function syncGuildActivityRoles(guild) {
  const statusRoles = await ensureStatusRolesExist(guild);
  const utcHour = currentUtcHour();
  
  // Carica tutti i fusi orari in memoria per non fare query in un ciclo loop
  const allTz = getAllTimezones();
  const tzMap = new Map(allTz.map(row => [row.user_id, row.utc_offset]));

  const summary = {
    utcHour,
    byStatus: { day: 0, peak: 0, night: 0 },
    unassigned: 0,
  };

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const offset = tzMap.get(member.id);

    if (offset === undefined) {
      summary.unassigned += 1;
      // Rimuovi ruoli se non ha più l'offset
      for (const key of Object.keys(STATUS_ROLES)) {
        if (member.roles.cache.has(statusRoles[key].id)) {
          await member.roles.remove(statusRoles[key]).catch(() => {});
        }
      }
      continue;
    }

    const status = statusForOffsetAtUtcHour(utcHour, offset); 
    summary.byStatus[status] += 1;

    for (const key of Object.keys(STATUS_ROLES)) {
      const hasRole = member.roles.cache.has(statusRoles[key].id);
      if (key === status && !hasRole) {
        await member.roles.add(statusRoles[key]).catch(() => {});
      } else if (key !== status && hasRole) {
        await member.roles.remove(statusRoles[key]).catch(() => {});
      }
    }
  }
  return summary;
}

// Nuovo metodo per recuperare i raggruppamenti (utile per /when e /besttime)
async function getOffsetCounts(guild) {
  const allTz = getAllTimezones();
  const tzMap = new Map(allTz.map(row => [row.user_id, row.utc_offset]));
  const counts = {}; // { "-5": 10, "1": 25, ... }

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const offset = tzMap.get(member.id);
    if (offset !== undefined) {
      counts[offset] = (counts[offset] || 0) + 1;
    }
  }
  return counts;
}

module.exports = {
  ensureStatusRolesExist,
  syncGuildActivityRoles,
  getOffsetCounts,
};
