const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { 
  getUserTimezone, 
  addUserAvailability, 
  clearUserAvailabilities, 
  getUserAvailabilities, 
  getAllAvailabilities 
} = require('../data/db');
const { syncGuildActivityRoles } = require('../utils/roleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('availability')
    .setDescription('Manage your custom availability slots (local time)')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add an available time slot')
        .addIntegerOption((opt) => opt.setName('start').setDescription('Start hour (0-23)').setRequired(true).setMinValue(0).setMaxValue(23))
        .addIntegerOption((opt) => opt.setName('end').setDescription('End hour (0-23)').setRequired(true).setMinValue(0).setMaxValue(23))
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Clear all your custom availability slots')
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List all members with custom availability slots')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      await interaction.deferReply();
      const list = getAllAvailabilities();

      if (list.length === 0) {
        await interaction.editReply({ content: '⚠️ No custom availability slots set yet.' });
        return;
      }

      // Raggruppa gli slot per utente per un'uscita pulita
      const grouped = {};
      for (const row of list) {
        if (!grouped[row.user_id]) {
          grouped[row.user_id] = { offset: row.utc_offset, slots: [] };
        }
        grouped[row.user_id].slots.push(`\`${String(row.available_start).padStart(2, '0')}:00 - ${String(row.available_end).padStart(2, '0')}:00\``);
      }

      const lines = [];
      for (const [userId, data] of Object.entries(grouped)) {
        const member = interaction.guild.members.cache.get(userId);
        const name = member ? member.displayName : `<@${userId}>`;
        const sign = data.offset > 0 ? '+' : '';
        lines.push(`• **${name}** (UTC${sign}${data.offset}): ${data.slots.join(', ')}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Member Availability Slots')
        .setColor(0x2ecc71)
        .setDescription(lines.join('\n'));

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const userTz = getUserTimezone(interaction.user.id);
    if (!userTz) {
      await interaction.editReply({ content: '⚠️ You need to set a timezone first using `/timezone`.' });
      return;
    }

    if (subcommand === 'add') {
      const start = interaction.options.getInteger('start');
      const end = interaction.options.getInteger('end');

      addUserAvailability(interaction.user.id, start, end);
      await syncGuildActivityRoles(interaction.guild);

      const userSlots = getUserAvailabilities(interaction.user.id);
      const slotsFormatted = userSlots.map(s => `\`${String(s.available_start).padStart(2, '0')}:00 - ${String(s.available_end).padStart(2, '0')}:00\``).join(', ');

      await interaction.editReply({
        content: `✅ Added slot: **${String(start).padStart(2, '0')}:00 - ${String(end).padStart(2, '0')}:00**.\nYour current active slots: ${slotsFormatted}`,
      });
    } else if (subcommand === 'clear') {
      clearUserAvailabilities(interaction.user.id);
      await syncGuildActivityRoles(interaction.guild);

      await interaction.editReply({
        content: '✅ All your custom availability slots have been cleared.',
      });
    }
  },
};