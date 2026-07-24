const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { STATUS_ROLES } = require('../config/time');
const { getUserTimezone, getUserAvailabilities } = require('../data/db');
const { currentUtcHour, toLocalHour, formatHour, statusForOffsetAtUtcHour } = require('../utils/timeUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show your current region and status, or another member\'s')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('User whose profile to view (optional)').setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    
    const userTz = getUserTimezone(targetUser.id);

    if (!userTz) {
      await interaction.reply({
        content: `⚠️ ${targetUser.id === interaction.user.id ? 'You have' : `${targetUser.username} has`} not set a timezone yet. Use \`/timezone\`.`,
        ephemeral: true,
      });
      return;
    }

    const utcHour = currentUtcHour();
    const localHour = toLocalHour(utcHour, userTz.utc_offset);
    
    const userSlots = getUserAvailabilities(targetUser.id);
    const statusKey = statusForOffsetAtUtcHour(utcHour, userTz.utc_offset, userSlots);
    const status = STATUS_ROLES[statusKey];

    const sign = userTz.utc_offset > 0 ? '+' : '';

    const embed = new EmbedBuilder()
      .setTitle(targetUser.id === interaction.user.id ? '👤 Your Profile' : `👤 ${targetUser.username}'s Profile`)
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Timezone', value: `UTC${sign}${userTz.utc_offset}`, inline: true },
        { name: 'Estimated local time', value: formatHour(localHour), inline: true },
        { name: 'Current status', value: `${status.emoji} ${status.label}`, inline: true }
      );

    if (userSlots && userSlots.length > 0) {
      const slotsFormatted = userSlots.map(s => `\`${String(s.available_start).padStart(2, '0')}:00 - ${String(s.available_end).padStart(2, '0')}:00\``).join(', ');
      embed.addFields({
         name: 'Custom Availability',
         value: `${slotsFormatted} (Local time)`
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};