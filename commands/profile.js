const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { REGIONS, STATUS_ROLES } = require('../config/regions');
const { getMemberRegionKey } = require('../utils/roleManager');
const { currentUtcHour, toLocalHour, formatHour } = require('../utils/timeUtils');
const { statusFromLocalHour } = require('../config/regions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show your current region and status, or another member\'s')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('User whose profile to view (optional)').setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id); // sostituisce interaction.member
    const regionKey = getMemberRegionKey(member);

    if (!regionKey) {
    await interaction.reply({
      content: `⚠️ ${targetUser.id === interaction.user.id ? 'You have' : `${targetUser.username} has`} not selected a region yet.`,
      ephemeral: true,
    });
    return;
  }

    const region = REGIONS[regionKey];
    const utcHour = currentUtcHour();
    const localHour = toLocalHour(utcHour, region.offset);
    const statusKey = statusFromLocalHour(localHour);
    const status = STATUS_ROLES[statusKey];

    const embed = new EmbedBuilder()
      .setTitle(targetUser.id === interaction.user.id ? '👤 Your Profile' : `👤 ${targetUser.username}'s Profile`)
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Your region', value: `${region.emoji} ${region.label}`, inline: true },
        { name: 'Estimated local time', value: formatHour(localHour), inline: true },
        { name: 'Current status', value: `${status.emoji} ${status.label}`, inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
