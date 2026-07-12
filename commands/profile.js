const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { REGIONS, STATUS_ROLES } = require('../config/regions');
const { getMemberRegionKey } = require('../utils/roleManager');
const { currentUtcHour, toLocalHour, formatHour } = require('../utils/timeUtils');
const { statusFromLocalHour } = require('../config/regions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Mostra la tua regione e il tuo stato attivita attuale'),

  async execute(interaction) {
    const member = interaction.member;
    const regionKey = getMemberRegionKey(member);

    if (!regionKey) {
      await interaction.reply({
        content:
          '⚠️ Non hai ancora selezionato una regione. Usa le reaction role di Carl-bot per sceglierne una.',
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
      .setTitle('👤 Il tuo profilo')
      .setColor(0xf1c40f)
      .addFields(
        { name: 'La tua regione', value: `${region.emoji} ${region.label}`, inline: true },
        { name: 'Ora locale stimata', value: formatHour(localHour), inline: true },
        { name: 'Stato attuale', value: `${status.emoji} ${status.label}`, inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
