const { SlashCommandBuilder } = require('discord.js');
const { REGIONS, STATUS_ROLES } = require('../config/regions');

// Mappa alias comodi -> chiave interna
const STATUS_ALIASES = { peak: 'peak', day: 'day', night: 'night' };
const REGION_ALIASES = {
  americas: 'Americas',
  europe: 'Europe',
  africa: 'Africa',
  middleeast: 'MiddleEast',
  india: 'India',
  asia: 'Asia',
  oceania: 'Oceania',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Notifica solo i membri di una categoria specifica')
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('peak / day / night oppure nome regione (es. europe)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Messaggio opzionale da aggiungere').setRequired(false)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString('category').toLowerCase().replace(/\s+/g, '');
    const extraMessage = interaction.options.getString('message');
    const guild = interaction.guild;

    let roleName = null;
    if (STATUS_ALIASES[raw]) {
      roleName = STATUS_ROLES[STATUS_ALIASES[raw]].roleName;
    } else if (REGION_ALIASES[raw]) {
      roleName = REGIONS[REGION_ALIASES[raw]].roleName;
    }

    if (!roleName) {
      await interaction.reply({
        content:
          '❌ Categoria non valida. Usa: `peak`, `day`, `night` oppure una regione (`europe`, `americas`, `asia`, `africa`, `middleeast`, `india`, `oceania`).',
        ephemeral: true,
      });
      return;
    }

    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      await interaction.reply({
        content: `⚠️ Il ruolo "${roleName}" non esiste ancora su questo server (esegui /status almeno una volta).`,
        ephemeral: true,
      });
      return;
    }

    const content = `${role} ${extraMessage ? extraMessage : 'Chiamata a raccolta!'}`;
    await interaction.reply({
      content,
      allowedMentions: { roles: [role.id] },
    });
  },
};
