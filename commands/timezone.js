const { SlashCommandBuilder } = require('discord.js');
const { setUserTimezone } = require('../data/db');
const { syncGuildActivityRoles } = require('../utils/roleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Set your UTC timezone offset (e.g., +1, -5)')
    .addNumberOption((opt) =>
      opt
        .setName('offset')
        .setDescription('Your offset from UTC (e.g., 1 for Italy/CET, -4 for EST)')
        .setRequired(true)
        .setMinValue(-12)
        .setMaxValue(14)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const offset = interaction.options.getNumber('offset');
    
    // Salva nel DB
    setUserTimezone(interaction.user.id, offset);
    
    // Forza un sync per aggiornare immediatamente il suo ruolo
    // (potremmo aggiornare solo il suo per risparmiare API calls, ma il sync globale è rapido)
    await syncGuildActivityRoles(interaction.guild);

    const sign = offset > 0 ? '+' : '';
    await interaction.editReply({ 
      content: `✅ Timezone saved successfully: **UTC${sign}${offset}**.\nYour status (Day/Peak/Night) has been updated.` 
    });
  },
};