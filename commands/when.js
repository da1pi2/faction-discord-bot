const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { STATUS_ROLES } = require('../config/time'); // <-- Import aggiornato
const { getOffsetCounts } = require('../utils/roleManager'); // <-- Import aggiornato
const { statusForOffsetAtUtcHour, formatHour } = require('../utils/timeUtils'); // <-- Import aggiornato

// Punteggio pesato: Peak conta di piu, Day meno, Night quasi zero.
const WEIGHTS = { peak: 1.0, day: 0.5, night: 0.1 };

function computeAvailability(offsetCounts, utcHour) {
  const byStatus = { day: 0, peak: 0, night: 0 };
  let totalMembers = 0;
  let weightedScore = 0;

  // offsetCounts è un oggetto tipo { "-5": 10, "1": 25, "8": 5 }
  for (const [offsetStr, count] of Object.entries(offsetCounts)) {
    if (count === 0) continue;
    
    totalMembers += count;
    const offset = parseFloat(offsetStr); // Convertiamo la chiave in numero
    const status = statusForOffsetAtUtcHour(utcHour, offset);
    
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
    // Usiamo getOffsetCounts al posto di getRegionCounts
    const offsetCounts = await getOffsetCounts(interaction.guild); 
    const { byStatus, scorePercent } = computeAvailability(offsetCounts, utcHour);
    
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
