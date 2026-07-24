const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getUserTimezone, setUserAvailability } = require('../data/db');
const { syncGuildActivityRoles } = require('../utils/roleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setavailability')
    .setDescription('Admin: Set or clear the availability slot for another member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set availability slot for a user')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The member whose availability you want to set').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('start').setDescription('Start hour in local time (0-23)').setRequired(true).setMinValue(0).setMaxValue(23)
        )
        .addIntegerOption((opt) =>
          opt.setName('end').setDescription('End hour in local time (0-23)').setRequired(true).setMinValue(0).setMaxValue(23)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Clear availability slot for a user')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The member whose availability you want to clear').setRequired(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');

    if (targetUser.bot) {
      await interaction.editReply({ content: '❌ Cannot set availability for bot users.' });
      return;
    }

    // Verifica che l'utente abbia già un fuso orario configurato nel DB
    const userTz = getUserTimezone(targetUser.id);
    if (!userTz) {
      await interaction.editReply({
        content: `⚠️ **${targetUser.username}** has not set a timezone yet. Set their timezone first with \`/settimezone\`.`,
      });
      return;
    }

    if (subcommand === 'set') {
      const start = interaction.options.getInteger('start');
      const end = interaction.options.getInteger('end');

      setUserAvailability(targetUser.id, start, end);
      await syncGuildActivityRoles(interaction.guild);

      await interaction.editReply({
        content: `✅ Updated availability slot for **${targetUser.username}**: **${String(start).padStart(2, '0')}:00 - ${String(end).padStart(2, '0')}:00** (Local time).\nTheir activity roles have been updated automatically.`,
      });
    } else if (subcommand === 'clear') {
      setUserAvailability(targetUser.id, null, null);
      await syncGuildActivityRoles(interaction.guild);

      await interaction.editReply({
        content: `✅ Cleared custom availability slot for **${targetUser.username}**. They are back to standard Day/Night status.`,
      });
    }
  },
};