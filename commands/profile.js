const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { REGIONS, STATUS_ROLES } = require('../config/regions');
const { getMemberRegionKey } = require('../utils/roleManager');
const { currentUtcHour, toLocalHour, formatHour } = require('../utils/timeUtils');
const { statusFromLocalHour } = require('../config/regions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Mostra la tua regione e stato attuale, o quella di un altro membro')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Utente di cui vedere il profilo (opzionale)').setRequired(false)
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
        { name: 'La tua regione', value: `${region.emoji} ${region.label}`, inline: true },
        { name: 'Ora locale stimata', value: formatHour(localHour), inline: true },
        { name: 'Stato attuale', value: `${status.emoji} ${status.label}`, inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
