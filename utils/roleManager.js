const { REGIONS, STATUS_ROLES } = require('../config/regions');
const { currentUtcHour, statusForRegionAtUtcHour } = require('./timeUtils');

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
        reason: 'Ruolo di stato attivita alleanza (creato automaticamente)',
      });
    }
    roleMap[key] = role;
  }
  return roleMap;
}

// Trova quale regione ha selezionato un membro guardando i suoi ruoli attuali.
// Se un membro ha piu ruoli regione (caso raro/errore utente), usa il primo trovato.
function getMemberRegionKey(member) {
  for (const key of Object.keys(REGIONS)) {
    const { roleName } = REGIONS[key];
    if (member.roles.cache.some((r) => r.name === roleName)) {
      return key;
    }
  }
  return null;
}

// Sincronizza i ruoli di stato di TUTTI i membri del server in base all'ora UTC attuale.
// Ritorna un riepilogo utile per logging/status.
async function syncGuildActivityRoles(guild) {
  const statusRoles = await ensureStatusRolesExist(guild);
  const utcHour = currentUtcHour();

  // NOTA: non richiamiamo guild.members.fetch() qui. Il fetch completo va fatto
  // una sola volta all'avvio (vedi index.js); dopo, con l'intent GuildMembers
  // attivo, la cache resta aggiornata da sola via eventi gateway (join/leave/
  // cambio ruolo). Rifetchare ad ogni sync causa rate limit (opcode 8).

  const summary = {
    utcHour,
    byStatus: { day: 0, peak: 0, night: 0 },
    byRegion: {},
    unassigned: 0,
  };

  for (const key of Object.keys(REGIONS)) summary.byRegion[key] = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const regionKey = getMemberRegionKey(member);
    if (!regionKey) {
      summary.unassigned += 1;
      // Rimuove eventuali ruoli di stato residui se l'utente ha tolto la regione
      for (const key of Object.keys(STATUS_ROLES)) {
        if (member.roles.cache.has(statusRoles[key].id)) {
          await member.roles.remove(statusRoles[key]).catch(() => {});
        }
      }
      continue;
    }

    summary.byRegion[regionKey] += 1;

    const offset = REGIONS[regionKey].offset;
    const status = statusForRegionAtUtcHour(utcHour, offset); // 'day' | 'peak' | 'night'
    summary.byStatus[status] += 1;

    // Aggiunge il ruolo corretto e rimuove gli altri due, solo se serve
    // (cosi evitiamo chiamate API inutili su membri il cui stato non e cambiato)
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

// Conta solo quanti membri sono in ogni regione, SENZA toccare i ruoli di stato.
// Usato da /when e /besttime che devono solo leggere, non modificare.
async function getRegionCounts(guild) {
  // Nessun fetch qui: si usa la cache popolata una volta sola all'avvio (index.js)
  // e mantenuta aggiornata dagli eventi gateway grazie all'intent GuildMembers.
  const counts = {};
  for (const key of Object.keys(REGIONS)) counts[key] = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const regionKey = getMemberRegionKey(member);
    if (regionKey) counts[regionKey] += 1;
  }
  return counts;
}

module.exports = {
  ensureStatusRolesExist,
  getMemberRegionKey,
  syncGuildActivityRoles,
  getRegionCounts,
};
