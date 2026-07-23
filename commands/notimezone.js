const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllTimezones } = require('../data/db'); // <-- Nuovo import

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notimezone')
    .setDescription('Lists members who have not selected a timezone'),

  async execute(interaction) {
    await interaction.deferReply();

    // Recuperiamo tutti i fusi orari salvati e creiamo un Set di ID utente per una ricerca rapida
    const savedTimezones = getAllTimezones();
    const usersWithTz = new Set(savedTimezones.map(row => row.user_id));

    const missing = [];
    for (const [, member] of interaction.guild.members.cache) {
      if (member.user.bot) continue;
      if (!usersWithTz.has(member.id)) 
        missing.push(member.toString());
    }

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Members without a timezone')
      .setColor(0xe74c3c)
      .setDescription(missing.length > 0 ? missing.join('\n') : '✅ Everyone has selected a timezone!')
      .setFooter({ text: `${missing.length} member(s) missing a timezone` });

    await interaction.editReply({ embeds: [embed] });
  },
};