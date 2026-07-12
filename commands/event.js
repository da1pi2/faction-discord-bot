const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Timer in memoria: semplice ma NON sopravvive a un riavvio del bot.
// Per un'alleanza di 50 persone va bene; se serve persistenza vera,
// andrebbero salvati gli eventi programmati su SQLite e ricaricati all'avvio.
const scheduledEvents = [];

function parseTimeToday(timeStr) {
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(timeStr.trim());
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23) return null;

  const now = new Date();
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0)
  );
  // Se l'orario e gia passato oggi, lo pianifica per domani
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Crea un evento programmato con promemoria automatico')
    .addStringOption((opt) => opt.setName('name').setDescription('Nome evento').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('time').setDescription('Ora UTC nel formato HH:MM (es. 18:00)').setRequired(true)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('name');
    const timeStr = interaction.options.getString('time');
    const targetDate = parseTimeToday(timeStr);

    if (!targetDate) {
      await interaction.reply({
        content: '❌ Formato ora non valido. Usa HH:MM in UTC, es. `18:00`.',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.channel;
    const msUntilEvent = targetDate.getTime() - Date.now();
    const msUntilReminder = msUntilEvent - 30 * 60 * 1000;

    const embed = new EmbedBuilder()
      .setTitle('📅 Evento programmato')
      .setColor(0xe67e22)
      .addFields(
        { name: 'Nome', value: name, inline: true },
        { name: 'Orario', value: `${timeStr} UTC`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });

    // Promemoria 30 minuti prima (solo se c'e ancora tempo)
    if (msUntilReminder > 0) {
      const reminderTimer = setTimeout(() => {
        channel.send(`🐉 **${name}**\nStarts in 30 minutes.`).catch(() => {});
      }, msUntilReminder);
      scheduledEvents.push(reminderTimer);
    }

    // Notifica all'orario dell'evento
    const startTimer = setTimeout(() => {
      channel.send(`🐉 **${name} started!**`).catch(() => {});
    }, Math.max(msUntilEvent, 0));
    scheduledEvents.push(startTimer);
  },
};
