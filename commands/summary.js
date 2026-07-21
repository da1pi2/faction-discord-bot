const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { summarizeChannelMessages } = require('../utils/openrouter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Riassume i messaggi recenti del canale con AI')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('hours')
        .setDescription('Quante ore indietro analizzare (default 7)')
        .setMinValue(1)
        .setMaxValue(72)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('language')
        .setDescription('Lingua del riassunto (default italiano)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('public')
        .setDescription('Mostra il risultato a tutti nel canale invece che solo a te')
        .setRequired(false)
    ),

  async execute(interaction) {
    const hours = interaction.options.getInteger('hours') ?? 7;
    const language = interaction.options.getString('language') ?? 'italiano';
    const isPublic = interaction.options.getBoolean('public') ?? false;
    const clampSummary = (text) => (text.length > 3900 ? `${text.slice(0, 3897).trimEnd()}...` : text);

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.reply({
        content: '❌ Questo comando funziona solo in un canale testuale.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: !isPublic });

    try {
      const result = await summarizeChannelMessages({
        channel: interaction.channel,
        guildName: interaction.guild?.name || 'Discord server',
        channelName: interaction.channel.name || 'canale',
        hours,
        language,
      });

      const embed = new EmbedBuilder()
        .setTitle(`🧠 Riassunto ultime ${hours} ore`)
        .setColor(0x5865f2)
        .setDescription(clampSummary(result.summary))
        .addFields(
          { name: 'Lingua', value: language, inline: true },
          { name: 'Messaggi analizzati', value: String(result.messagesCount), inline: true },
          { name: 'Autori coinvolti', value: String(result.authorsCount), inline: true },
          { name: 'Modello', value: result.model, inline: false }
        );

      await interaction.editReply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Errore durante /summary:', error);
      await interaction.editReply({
        content:
          '❌ Non sono riuscito a creare il riassunto. Controlla che `OPENROUTER_API_KEY` sia impostata nel file `.env` e che il bot abbia accesso alla cronologia del canale.',
      });
    }
  },
};