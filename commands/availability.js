const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Admin: Send a persistent button panel for members to set their availability')
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

    if (subcommand === 'panel') {
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('avail_toggle_0_4').setLabel('00:00 - 04:00').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('avail_toggle_4_8').setLabel('04:00 - 08:00').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('avail_toggle_8_12').setLabel('08:00 - 12:00').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('avail_toggle_12_16').setLabel('12:00 - 16:00').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('avail_toggle_16_20').setLabel('16:00 - 20:00').setStyle(ButtonStyle.Primary)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('avail_toggle_20_0').setLabel('20:00 - 00:00').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('avail_clear').setLabel('🗑️ Clear All').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setTitle('📅 Set Your Availability')
        .setColor(0x3498db)
        .setDescription('Click the buttons below to **toggle (add/remove)** the times you are usually available to play.\n\n*All times are relative to your **local timezone** (make sure you used `/timezone` first).*');

      await interaction.reply({ content: '✅ Panel created.', ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: [row1, row2] });
      return;
    }

    // Per i comandi singoli (add / clear manuale)
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