const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { toUnixTimestamp } = require('../utils/timeUtils');

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
  // If the time has already passed today, schedule it for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create a scheduled event with automatic reminders')
    .addStringOption((opt) => opt.setName('name').setDescription('Event name').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('time').setDescription('UTC time in HH:MM format (e.g. 18:00)').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('Event description (optional)').setRequired(false)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('name');
    const timeStr = interaction.options.getString('time');
    const description = interaction.options.getString('description'); // may be null
    
    const targetDate = parseTimeToday(timeStr);

    if (!targetDate) {
      await interaction.reply({
        content: '❌ Invalid time format. Use UTC HH:MM, e.g. 18:00.',
        ephemeral: true,
      });
      return;
    }

    const unixSec = toUnixTimestamp(targetDate);

    if (!targetDate) {
      await interaction.reply({
        content: '❌ Invalid time format. Use UTC HH:MM, e.g. 18:00.',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.channel;
    const msUntilEvent = targetDate.getTime() - Date.now();
    const msUntilReminder = msUntilEvent - 30 * 60 * 1000;

    const embed = new EmbedBuilder()
      .setTitle('📅 Event Scheduled')
      .setColor(0xe67e22)
      .addFields(
        { name: 'Event', value: name, inline: true },
        { name: 'Local Time for You', value: `<t:${unixSec}:F>`, inline: false },
        { name: 'Starts In', value: `<t:${unixSec}:R>`, inline: true }
      );
      
    if (description) embed.addFields({ name: 'Description', value: description });
    await interaction.reply({ embeds: [embed] });

    // Reminder 30 minutes before, only if there is still time
    if (msUntilReminder > 0) {
      const reminderTimer = setTimeout(() => {
        channel.send(`🐉 **${name}**${description ? `\n${description}` : ''}\nStarts in 30 minutes.`)
      }, msUntilReminder);
      scheduledEvents.push(reminderTimer);
    }

    // Notify at the event start time
    const startTimer = setTimeout(() => {
      channel.send(`🐉 **${name} started!**${description ? `\n${description}` : ''}`)
    }, Math.max(msUntilEvent, 0));
    scheduledEvents.push(startTimer);
  },
};
