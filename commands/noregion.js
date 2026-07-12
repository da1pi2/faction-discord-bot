const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMemberRegionKey } = require('../utils/roleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('noregion')
    .setDescription('Lists members who have not selected a region'),

  async execute(interaction) {
    await interaction.deferReply();

    const missing = [];
    for (const [, member] of interaction.guild.members.cache) {
      if (member.user.bot) continue;
      if (!getMemberRegionKey(member)) missing.push(member.toString());
    }

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Members without a region')
      .setColor(0xe74c3c)
      .setDescription(missing.length > 0 ? missing.join('\n') : '✅ Everyone has selected a region!')
      .setFooter({ text: `${missing.length} member(s) missing a region` });

    await interaction.editReply({ embeds: [embed] });
  },
};