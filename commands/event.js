const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const { toUnixTimestamp } = require('../utils/timeUtils');

const activeEvents = new Map();

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
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

function generateId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Manage scheduled events with reminders and RSVP')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Create a scheduled event with RSVP buttons')
        .addStringOption((opt) => opt.setName('name').setDescription('Event name').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('time').setDescription('UTC time in HH:MM format (e.g. 18:00)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('Event description (optional)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List all currently active events')
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Cancel an upcoming event')
        // ATTENZIONE: Aggiunto setAutocomplete(true)
        .addStringOption((opt) => opt.setName('id').setDescription('Select the event to remove').setRequired(true).setAutocomplete(true))
    ),

  // Gestione del menu a tendina in tempo reale
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = [];
    
    for (const [id, ev] of activeEvents.entries()) {
      choices.push({ name: `${ev.name} (ID: ${id})`, value: id });
    }

    // Filtra le scelte in base a ciò che l'utente sta digitando
    const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue));
    await interaction.respond(filtered.slice(0, 25)); // Discord supporta max 25 scelte
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      if (activeEvents.size === 0) {
        return interaction.reply({ content: '⚠️ No scheduled events at the moment.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Scheduled Events')
        .setColor(0x3498db);

      const lines = [];
      for (const [id, ev] of activeEvents.entries()) {
        lines.push(`**${ev.name}** (ID: \`${id}\`) — <t:${toUnixTimestamp(ev.targetDate)}:f>`);
      }
      
      embed.setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'remove') {
      const eventId = interaction.options.getString('id').toUpperCase();
      const ev = activeEvents.get(eventId);

      if (!ev) {
        return interaction.reply({ content: `❌ Event not found. It might have already ended or been cancelled.`, ephemeral: true });
      }

      ev.timers.forEach((t) => clearTimeout(t));
      activeEvents.delete(eventId);

      if (ev.message) {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rsvp_yes').setLabel('Available').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(true),
          new ButtonBuilder().setCustomId('rsvp_no').setLabel('Unavailable').setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(true)
        );

        const cancelledEmbed = EmbedBuilder.from(ev.message.embeds[0])
          .setTitle(`🚫 CANCELLED: ${ev.name}`)
          .setColor(0xe74c3c);

        await ev.message.edit({ embeds: [cancelledEmbed], components: [disabledRow] }).catch(() => {});
      }

      return interaction.reply({ content: `✅ Event **${ev.name}** has been cancelled.`, ephemeral: true });
    }

    if (subcommand === 'add') {
      const name = interaction.options.getString('name');
      const timeStr = interaction.options.getString('time');
      const description = interaction.options.getString('description');
      
      const targetDate = parseTimeToday(timeStr);

      if (!targetDate) {
        return interaction.reply({
          content: '❌ Invalid time format. Use UTC HH:MM, e.g. 18:00.',
          ephemeral: true,
        });
      }

      const unixSec = toUnixTimestamp(targetDate);
      const msUntilEvent = targetDate.getTime() - Date.now();
      const msUntilReminder = msUntilEvent - 30 * 60 * 1000;
      
      const eventId = generateId();
      const utcTimeString = `${String(targetDate.getUTCHours()).padStart(2, '0')}:${String(targetDate.getUTCMinutes()).padStart(2, '0')} UTC`;

      const embed = new EmbedBuilder()
        .setTitle(`📅 Event: ${name}`)
        .setColor(0xe67e22)
        .addFields(
          { name: 'Time (Local)', value: `<t:${unixSec}:F>`, inline: false },
          { name: 'Time (UTC)', value: `**${utcTimeString}**`, inline: true },
          { name: 'Starts In', value: `<t:${unixSec}:R>`, inline: true },
          { name: 'Event ID', value: `\`${eventId}\``, inline: true }
        );
        
      if (description) embed.setDescription(description);

      embed.addFields(
        { name: '✅ Available (0)', value: 'None yet', inline: true },
        { name: '❌ Unavailable (0)', value: 'None yet', inline: true }
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rsvp_yes').setLabel('Available').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('rsvp_no').setLabel('Unavailable').setStyle(ButtonStyle.Danger).setEmoji('❌')
      );

      const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

      const eventData = {
        name,
        targetDate,
        message: response,
        yes: new Set(),
        no: new Set(),
        timers: []
      };
      activeEvents.set(eventId, eventData);

      const collector = response.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: msUntilEvent 
      });

      collector.on('collect', async (i) => {
        if (!activeEvents.has(eventId)) {
          return i.reply({ content: '⚠️ This event has been cancelled.', ephemeral: true });
        }

        if (i.customId === 'rsvp_yes') {
          eventData.yes.add(i.user.id);
          eventData.no.delete(i.user.id);
        } else if (i.customId === 'rsvp_no') {
          eventData.no.add(i.user.id);
          eventData.yes.delete(i.user.id);
        }

        const updatedEmbed = EmbedBuilder.from(i.message.embeds[0]);
        const yesIndex = updatedEmbed.data.fields.findIndex(f => f.name.startsWith('✅'));
        const noIndex = updatedEmbed.data.fields.findIndex(f => f.name.startsWith('❌'));

        updatedEmbed.data.fields[yesIndex].name = `✅ Available (${eventData.yes.size})`;
        updatedEmbed.data.fields[yesIndex].value = eventData.yes.size > 0 
          ? Array.from(eventData.yes).map(id => `<@${id}>`).join('\n') 
          : 'None yet';

        updatedEmbed.data.fields[noIndex].name = `❌ Unavailable (${eventData.no.size})`;
        updatedEmbed.data.fields[noIndex].value = eventData.no.size > 0 
          ? Array.from(eventData.no).map(id => `<@${id}>`).join('\n') 
          : 'None yet';

        await i.update({ embeds: [updatedEmbed] });
      });

      collector.on('end', () => {
        // Disabilita solo i bottoni alla fine, NON cancella l'evento dalla mappa
        if (activeEvents.has(eventId)) {
          row.components.forEach(c => c.setDisabled(true));
          response.edit({ components: [row] }).catch(() => {});
        }
      });

      const channel = interaction.channel;

      if (msUntilReminder > 0) {
        const reminderTimer = setTimeout(() => {
          if (!activeEvents.has(eventId)) return;
          channel.send(`🐉 **${name}** starts in 30 minutes!`).catch(console.error);
        }, msUntilReminder);
        eventData.timers.push(reminderTimer);
      }

      const startTimer = setTimeout(() => {
        if (!activeEvents.has(eventId)) return;
        
        const mentions = eventData.yes.size > 0 
          ? Array.from(eventData.yes).map(id => `<@${id}>`).join(' ') 
          : '';
          
        channel.send(`🐉 **${name} started!**\n${mentions}`).catch(console.error);
        
        // CANCELLA DALLA MAPPA SOLO DOPO AVER MANDATO IL MESSAGGIO
        activeEvents.delete(eventId);
      }, Math.max(msUntilEvent, 0));
      
      eventData.timers.push(startTimer);
    }
  },
};