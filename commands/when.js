const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { REGIONS, STATUS_ROLES } = require('../config/regions');
const { getRegionCounts } = require('../utils/roleManager');
const { statusForRegionAtUtcHour, formatHour } = require('../utils/timeUtils');

// Punteggio pesato: Peak conta di piu, Day meno, Night quasi zero.
const WEIGHTS = { peak: 1.0, day: 0.5, night: 0.1 };

function computeAvailability(regionCounts, utcHour) {
  const byStatus = { day: 0, peak: 0, night: 0 };
  let totalMembers = 0;
  let weightedScore = 0;

  for (const key of Object.keys(REGIONS)) {
    const count = regionCounts[key] || 0;
    if (count === 0) continue;
    totalMembers += count;
    const status = statusForRegionAtUtcHour(utcHour, REGIONS[key].offset);
    byStatus[status] += count;
    weightedScore += count * WEIGHTS[status];
  }

  const maxPossibleScore = totalMembers * WEIGHTS.peak;
  const scorePercent = maxPossibleScore > 0 ? Math.round((weightedScore / maxPossibleScore) * 100) : 0;

  return { byStatus, scorePercent, totalMembers };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('when')
    .setDescription('Estimate how many members would be available at a given UTC hour')
    .addIntegerOption((opt) =>
      opt
        .setName('utc_hour')
        .setDescription('UTC hour (0-23)')
        .setMinValue(0)
        .setMaxValue(23)
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const utcHour = interaction.options.getInteger('utc_hour');
    const regionCounts = await getRegionCounts(interaction.guild);
    const { byStatus, scorePercent } = computeAvailability(regionCounts, utcHour);

    const embed = new EmbedBuilder()
      .setTitle(`🕒 Event time: ${formatHour(utcHour)} UTC`)
      .setColor(0x3498db)
      .addFields(
        { name: `${STATUS_ROLES.peak.emoji} Peak`, value: `${byStatus.peak} players`, inline: true },
        { name: `${STATUS_ROLES.day.emoji} Day`, value: `${byStatus.day} players`, inline: true },
        { name: `${STATUS_ROLES.night.emoji} Night`, value: `${byStatus.night} players`, inline: true },
        { name: 'Score', value: `${scorePercent}%` }
      );

    await interaction.editReply({ embeds: [embed] });
  },

  computeAvailability, // esportata per riuso in /besttime
};
