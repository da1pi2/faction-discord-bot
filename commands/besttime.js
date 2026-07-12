const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRegionCounts } = require('../utils/roleManager');
const { formatHour } = require('../utils/timeUtils');
const { computeAvailability } = require('./when');
const { getHistoricalAverageByHour } = require('../data/db');

const MIN_SAMPLES_FOR_HISTORY = 20; // circa 5 ore di dati con check ogni 15 min

module.exports = {
  data: new SlashCommandBuilder()
    .setName('besttime')
    .setDescription("Calcola il miglior orario per gli eventi dell'alleanza"),

  async execute(interaction) {
    await interaction.deferReply();

    const regionCounts = await getRegionCounts(interaction.guild);

    // Calcola il punteggio teorico per tutte le 24 ore UTC
    const hourlyScores = [];
    for (let h = 0; h < 24; h++) {
      const { scorePercent, byStatus } = computeAvailability(regionCounts, h);
      hourlyScores.push({ hour: h, scorePercent, byStatus });
    }
    hourlyScores.sort((a, b) => b.scorePercent - a.scorePercent);
    const top3 = hourlyScores.slice(0, 3);

    const embed = new EmbedBuilder()
      .setTitle('📊 Best Event Time Analysis')
      .setColor(0x9b59b6)
      .setDescription('Calcolo teorico basato sulla distribuzione regionale attuale.');

    for (const entry of top3) {
      embed.addFields({
        name: `${formatHour(entry.hour)} UTC — Score: ${entry.scorePercent}%`,
        value: `🔥 Peak: ${entry.byStatus.peak} | ☀️ Day: ${entry.byStatus.day} | 🌙 Night: ${entry.byStatus.night}`,
      });
    }

    // Se abbiamo abbastanza dati storici, aggiungiamo anche quelli
    const history = getHistoricalAverageByHour();
    const totalSamples = history.reduce((sum, r) => sum + r.samples, 0);

    if (totalSamples >= MIN_SAMPLES_FOR_HISTORY && history.length > 0) {
      const best = history[0];
      embed.addFields({
        name: '📈 Dato storico (basato su attivita reale)',
        value: `Miglior orario osservato: **${best.hour_bucket}:00 UTC**\nMedia membri attivi: **${Math.round(best.avg_active)}**\n(${totalSamples} rilevazioni salvate)`,
      });
    } else {
      embed.addFields({
        name: '📈 Dato storico',
        value: `Ancora pochi dati raccolti (${totalSamples}/${MIN_SAMPLES_FOR_HISTORY}). Il bot registra automaticamente ogni 15 minuti: torna a controllare tra qualche giorno per un'analisi basata sull'attivita reale.`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
