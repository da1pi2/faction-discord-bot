const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { STATUS_ROLES } = require('../config/time'); 
const { syncGuildActivityRoles } = require('../utils/roleManager');
const { formatHour } = require('../utils/timeUtils');
const { logSnapshot } = require('../data/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the current alliance activity status'),

  async execute(interaction) {
    await interaction.deferReply();

    const summary = await syncGuildActivityRoles(interaction.guild);
    logSnapshot(summary);

    const embed = new EmbedBuilder()
      .setTitle('🌍 Alliance Status')
      .setColor(0x2ecc71)
      .addFields(
        {
          name: `${STATUS_ROLES.available.emoji} Available`,
          value: `${summary.byStatus.available} players`,
          inline: true,
        },
        {
          name: `${STATUS_ROLES.day.emoji} Day`,
          value: `${summary.byStatus.day} players`,
          inline: true,
        },
        {
          name: `${STATUS_ROLES.night.emoji} Night`,
          value: `${summary.byStatus.night} players`,
          inline: true,
        }
      );

    if (summary.unassigned > 0) {
      embed.addFields({ 
        name: '⚠️ Missing timezone', 
        value: `${summary.unassigned} members (use /timezone)` 
      });
    }

    embed.setFooter({ text: `Last update: ${formatHour(summary.utcHour)} UTC` });

    await interaction.editReply({ embeds: [embed] });
  },
};