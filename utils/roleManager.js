const { STATUS_ROLES } = require('../config/time');
const { getAllTimezones, getUserAvailabilities } = require('../data/db');
const { currentUtcHour, statusForOffsetAtUtcHour } = require('./timeUtils');

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
  
  const allTz = getAllTimezones();
  const tzMap = new Map(allTz.map(row => [row.user_id, row]));

  const summary = {
    utcHour,
    byStatus: { available: 0, day: 0, night: 0 },
    unassigned: 0,
  };

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const tzData = tzMap.get(member.id);

    if (!tzData) {
      summary.unassigned += 1;
      for (const key of Object.keys(STATUS_ROLES)) {
        if (member.roles.cache.has(statusRoles[key].id)) {
          await member.roles.remove(statusRoles[key]).catch(() => {});
        }
      }
      continue;
    }

    // MODIFICA QUI: Recuperiamo l'array di slot dal DB e lo passiamo
    const userSlots = getUserAvailabilities(member.id);
    const status = statusForOffsetAtUtcHour(utcHour, tzData.utc_offset, userSlots); 
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

async function getGuildMembersTimezones(guild) {
  const allTz = getAllTimezones();
  const tzMap = new Map(allTz.map(row => [row.user_id, row]));
  const activeMembers = [];

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const tzData = tzMap.get(member.id);
    if (tzData) {
      // MODIFICA QUI: Costruiamo l'oggetto includendo gli slot reali
      const userSlots = getUserAvailabilities(member.id);
      activeMembers.push({
        utc_offset: tzData.utc_offset,
        slots: userSlots
      });
    }
  }
  return activeMembers;
}

module.exports = {
  ensureStatusRolesExist,
  syncGuildActivityRoles,
  getGuildMembersTimezones,
};