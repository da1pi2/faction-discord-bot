// commands/settimezone.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setUserTimezone } = require('../data/db');
const { syncGuildActivityRoles } = require('../utils/roleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settimezone')
    .setDescription('Admin: Set or correct the UTC timezone offset for another member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The member whose timezone you want to update')
        .setRequired(true)
    )
    .addNumberOption((opt) =>
      opt
        .setName('offset')
        .setDescription('UTC offset (e.g. 1 for Italy/CET, -4 for EST)')
        .setRequired(true)
        .setMinValue(-12)
        .setMaxValue(14)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const offset = interaction.options.getNumber('offset');

    if (targetUser.bot) {
      await interaction.editReply({
        content: '❌ Cannot set a timezone for bot users.',
      });
      return;
    }

    // Aggiorna il fuso orario nel database
    setUserTimezone(targetUser.id, offset);

    // Sincronizza i ruoli di attività (Day / Peak / Night) del server
    await syncGuildActivityRoles(interaction.guild);

    const sign = offset > 0 ? '+' : '';
    await interaction.editReply({
      content: `✅ Updated timezone for **${targetUser.username}** to **UTC${sign}${offset}**.\nTheir activity roles have been updated automatically.`,
    });
  },
};