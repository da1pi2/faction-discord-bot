// commands/timezones.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllTimezones } = require('../data/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezones')
    .setDescription('Lists all members who have set a timezone offset'),

  async execute(interaction) {
    await interaction.deferReply();

    const savedTimezones = getAllTimezones();

    if (savedTimezones.length === 0) {
      await interaction.editReply({
        content: '⚠️ No members have set their timezone yet.',
      });
      return;
    }

    // Ordiniamo per offset UTC (dal negativo al positivo)
    savedTimezones.sort((a, b) => a.utc_offset - b.utc_offset);

    const lines = [];
    for (const row of savedTimezones) {
      const member = interaction.guild.members.cache.get(row.user_id);
      const name = member ? member.displayName : `<@${row.user_id}>`;
      const sign = row.utc_offset > 0 ? '+' : '';
      lines.push(`• **${name}**: UTC${sign}${row.utc_offset}`);
    }

    // Dividiamo la lista in blocchi se supera i limiti di caratteri dell'embed
    const CHUNK_SIZE = 25;
    const embeds = [];

    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      const chunk = lines.slice(i, i + CHUNK_SIZE);
      const embed = new EmbedBuilder()
        .setTitle(i === 0 ? '🌐 Member Timezones' : '🌐 Member Timezones (Cont.)')
        .setColor(0x3498db)
        .setDescription(chunk.join('\n'))
        .setFooter({ text: `Total configured members: ${savedTimezones.length}` });

      embeds.push(embed);
    }

    await interaction.editReply({ embeds });
  },
};