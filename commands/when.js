const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { STATUS_ROLES } = require('../config/time'); 
const { getGuildMembersTimezones } = require('../utils/roleManager'); 
const { statusForOffsetAtUtcHour, formatHour } = require('../utils/timeUtils');
const { getTodayUtcHourTimestamp } = require('../utils/timeUtils');

const WEIGHTS = { available: 1.0, day: 0.6, night: 0.1 };

function computeAvailability(membersData, utcHour) {
  const byStatus = { available: 0, day: 0, night: 0 };
  let totalMembers = 0;
  let weightedScore = 0;

  for (const data of membersData) {
    totalMembers++;
    // MODIFICA QUI: Usa data.slots
    const status = statusForOffsetAtUtcHour(utcHour, data.utc_offset, data.slots);
    byStatus[status]++;
    weightedScore += WEIGHTS[status];
  }

  const maxPossibleScore = totalMembers * WEIGHTS.available;
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
    const unixSec = getTodayUtcHourTimestamp(utcHour);
    const membersData = await getGuildMembersTimezones(interaction.guild); 
    const { byStatus, scorePercent } = computeAvailability(membersData, utcHour);
    
    const embed = new EmbedBuilder()
      .setTitle(`🕒 Alliance Availability at ${formatHour(utcHour)} UTC`)
      .setDescription(`Your local time: **<t:${unixSec}:t>** (<t:${unixSec}:R>)`)
      .setColor(0x3498db)
      .addFields(
        { name: `${STATUS_ROLES.available.emoji} Avail.`, value: `${byStatus.available} players`, inline: true },
        { name: `${STATUS_ROLES.day.emoji} Day`, value: `${byStatus.day} players`, inline: true },
        { name: `${STATUS_ROLES.night.emoji} Night`, value: `${byStatus.night} players`, inline: true },
        { name: 'Score', value: `${scorePercent}%` }
      );

    await interaction.editReply({ embeds: [embed] });
  },

  computeAvailability,
};