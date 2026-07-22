const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { summarizeChannelMessages } = require('../utils/openrouter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Summarize recent channel or thread messages with AI')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('hours')
        .setDescription('How many hours back to analyze (default 7)')
        .setMinValue(1)
        .setMaxValue(72)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('language')
        .setDescription('Summary language (default English)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('public')
        .setDescription('Show the result to everyone in the channel instead of only you')
        .setRequired(false)
    ),

  async execute(interaction) {
    const hours = interaction.options.getInteger('hours') ?? 7;
    const language = interaction.options.getString('language') ?? 'English';
    const isPublic = interaction.options.getBoolean('public') ?? false;
    const clampSummary = (text) => (text.length > 3900 ? `${text.slice(0, 3897).trimEnd()}...` : text);

    // Controlliamo esplicitamente se è un canale di testo testuale o un thread
    const isText = interaction.channel?.isTextBased?.() || false;
    const isThread = interaction.channel?.isThread?.() || false;

    if (!interaction.channel || (!isText && !isThread)) {
      await interaction.reply({
        content: '❌ This command only works in a text channel or thread.',
        ephemeral: true,
      });
      return;
    }

    // Costruiamo un nome canale descrittivo da passare all'LLM per dargli contesto
    let contextChannelName = interaction.channel.name || 'channel';
    if (isThread) {
      const parentName = interaction.channel.parent?.name || 'unknown';
      contextChannelName = `Thread: "${interaction.channel.name}" (in #${parentName})`;
    } else {
      contextChannelName = `#${interaction.channel.name}`;
    }

    await interaction.deferReply({ ephemeral: !isPublic });

    try {
      const result = await summarizeChannelMessages({
        channel: interaction.channel,
        guildName: interaction.guild?.name || 'Discord server',
        channelName: contextChannelName,
        hours,
        language,
      });

      const embed = new EmbedBuilder()
        .setTitle(`🧠 Summary for the last ${hours} hours`)
        .setColor(0x5865f2)
        .setDescription(clampSummary(result.summary))
        .addFields(
          { name: 'Language', value: language, inline: true },
          { name: 'Messages analyzed', value: String(result.messagesCount), inline: true },
          { name: 'Authors involved', value: String(result.authorsCount), inline: true }
        );

      await interaction.editReply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Errore durante /summary:', error);
      await interaction.editReply({
        content:
          '❌ I could not create the summary. Check that `OPENROUTER_API_KEY` is set in your `.env` file and that the bot can access the channel history.',
      });
    }
  },
};