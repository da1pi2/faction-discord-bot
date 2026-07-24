const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuildMembersTimezones } = require('../utils/roleManager');
const { formatHour } = require('../utils/timeUtils');
const { computeAvailability } = require('./when');
const { getHistoricalAverageByHour } = require('../data/db');

const MIN_SAMPLES_FOR_HISTORY = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('besttime')
    .setDescription('Calculate the best time for alliance events'),

  async execute(interaction) {
    await interaction.deferReply();

    const membersData = await getGuildMembersTimezones(interaction.guild);

    const hourlyScores = [];
    for (let h = 0; h < 24; h++) {
      const { scorePercent, byStatus } = computeAvailability(membersData, h);
      hourlyScores.push({ hour: h, scorePercent, byStatus });
    }
    
    hourlyScores.sort((a, b) => b.scorePercent - a.scorePercent);
    const top3 = hourlyScores.slice(0, 3);

    const embed = new EmbedBuilder()
      .setTitle('📊 Best Event Time Analysis')
      .setColor(0x9b59b6)
      .setDescription('Theoretical estimate based on current regional and custom availability.');

    for (const entry of top3) {
      embed.addFields({
        name: `${formatHour(entry.hour)} UTC — Score: ${entry.scorePercent}%`,
        value: `✅ Avail: ${entry.byStatus.available} | ☀️ Day: ${entry.byStatus.day} | 🌙 Night: ${entry.byStatus.night}`,
      });
    }

    // const history = getHistoricalAverageByHour();
    // const totalSamples = history.reduce((sum, r) => sum + r.samples, 0);

    // if (totalSamples >= MIN_SAMPLES_FOR_HISTORY && history.length > 0) {
    //   const best = history[0];
    //   embed.addFields({
    //     name: '[BETA] 📈 Historical Data (based on real activity)',
    //     value: `Best observed time: **${best.hour_bucket}:00 UTC**\nAverage active members: **${Math.round(best.avg_active)}**\n(${totalSamples} recordings saved)`,
    //   });
    // } else {
    //   embed.addFields({
    //     name: '[BETA] 📈 Historical Data',
    //     value: `Still collecting data (${totalSamples}/${MIN_SAMPLES_FOR_HISTORY}). The bot records automatically every 15 minutes: come back in a few days for an analysis based on real activity.`,
    //   });
    // }

    await interaction.editReply({ embeds: [embed] });
  },
};