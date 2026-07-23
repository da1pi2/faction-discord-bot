const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { STATUS_ROLES, statusFromLocalHour } = require('../config/time'); // <-- Import aggiornato
const { getUserTimezone } = require('../data/db'); // <-- Import aggiornato
const { currentUtcHour, toLocalHour, formatHour } = require('../utils/timeUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show your current region and status, or another member\'s')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('User whose profile to view (optional)').setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    
    // Leggiamo l'offset dal DB al posto di getMemberRegionKey
    const offset = getUserTimezone(targetUser.id);

    if (offset === null) {
      await interaction.reply({
        content: `⚠️ ${targetUser.id === interaction.user.id ? 'You have' : `${targetUser.username} has`} not set a timezone yet. Use \`/timezone\`.`,
        ephemeral: true,
      });
      return;
    }

    const utcHour = currentUtcHour();
    const localHour = toLocalHour(utcHour, offset);
    
    const statusKey = statusFromLocalHour(localHour);
    const status = STATUS_ROLES[statusKey];

    // Formattazione per mostrare "+" davanti ai numeri positivi (es. UTC+1)
    const sign = offset > 0 ? '+' : '';

    const embed = new EmbedBuilder()
      .setTitle(targetUser.id === interaction.user.id ? '👤 Your Profile' : `👤 ${targetUser.username}'s Profile`)
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Timezone', value: `UTC${sign}${offset}`, inline: true },
        { name: 'Estimated local time', value: formatHour(localHour), inline: true },
        { name: 'Current status', value: `${status.emoji} ${status.label}`, inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
