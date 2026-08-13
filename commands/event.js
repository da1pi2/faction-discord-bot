const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  AttachmentBuilder
} = require('discord.js');
const { toUnixTimestamp } = require('../utils/timeUtils');
const { getGuildMembersTimezones } = require('../utils/roleManager');
const { computeAvailability } = require('./when');
const { parseCoordinatePair, clampCoordinate, MAX_X, MAX_Y, renderMapWithMarkers } = require('../utils/mapRenderer');

const eventTimers = new Map();

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

async function buildAvailabilityString(guild, targetDate) {
  const utcHour = targetDate.getUTCHours();
  const membersData = await getGuildMembersTimezones(guild);
  const { byStatus, scorePercent } = computeAvailability(membersData, utcHour);
  return `✅ ${byStatus.available} | ☀️ ${byStatus.day} | 🌙 ${byStatus.night} — Score: **${scorePercent}%**`;
}

function scheduleEventTimers(client, eventRow) {
  if (eventTimers.has(eventRow.id)) {
    const existing = eventTimers.get(eventRow.id);
    if (existing.reminder) clearTimeout(existing.reminder);
    if (existing.start) clearTimeout(existing.start);
  }

  const targetDate = new Date(eventRow.target_date);
  const msUntilEvent = targetDate.getTime() - Date.now();
  const msUntilReminder = msUntilEvent - 30 * 60 * 1000;
  const eventId = eventRow.id;

  const timers = { reminder: null, start: null };

  if (msUntilReminder > 0) {
    timers.reminder = setTimeout(async () => {
      try {
        const channel = await client.channels.fetch(eventRow.channel_id);
        if (channel) channel.send(`🐉 **${eventRow.name}** starts in 30 minutes!`).catch(console.error);
      } catch(e) { console.error('Error in reminder timer:', e); }
    }, msUntilReminder);
  }

  timers.start = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(eventRow.channel_id);
      if (channel) {
        const { getEventRsvps, deleteEvent } = require('../data/db');
        const rsvps = getEventRsvps(eventId);
        const yesIds = rsvps.filter(r => r.status === 'yes').map(r => `<@${r.user_id}>`);
        const mentions = yesIds.length > 0 ? yesIds.join(' ') : '';
        channel.send(`🐉 **${eventRow.name} started!**\n${mentions}`).catch(console.error);
        deleteEvent(eventId);
      }
      eventTimers.delete(eventId);
    } catch(e) { console.error('Error in start timer:', e); }
  }, Math.max(msUntilEvent, 0));

  eventTimers.set(eventId, timers);
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
        .addStringOption((opt) =>
          opt.setName('coordinates').setDescription('Coordinates in the form (x, y)').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('x').setDescription('X coordinate').setMinValue(0).setMaxValue(MAX_X).setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('y').setDescription('Y coordinate').setMinValue(0).setMaxValue(MAX_Y).setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Change the time or location of an existing event')
        .addStringOption((opt) => opt.setName('id').setDescription('Select the event to modify').setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName('time').setDescription('New UTC time in HH:MM format').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('coordinates').setDescription('New coordinates in the form (x, y)').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('x').setDescription('New X coordinate').setMinValue(0).setMaxValue(MAX_X).setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('y').setDescription('New Y coordinate').setMinValue(0).setMaxValue(MAX_Y).setRequired(false)
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
        .addStringOption((opt) => opt.setName('id').setDescription('Select the event to remove').setRequired(true).setAutocomplete(true))
    ),

  scheduleEventTimers,

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const { getAllEvents } = require('../data/db');
    const events = getAllEvents();
    
    const choices = events.map(ev => ({ name: `${ev.name} (ID: ${ev.id})`, value: ev.id }));
    const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue));
    await interaction.respond(filtered.slice(0, 25));
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { getEvent, getAllEvents, deleteEvent, updateEventDetails, addEvent } = require('../data/db');

    if (subcommand === 'list') {
      const events = getAllEvents();
      if (events.length === 0) {
        return interaction.reply({ content: '⚠️ No scheduled events at the moment.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Scheduled Events')
        .setColor(0x3498db);

      const lines = [];
      for (const ev of events) {
        lines.push(`**${ev.name}** (ID: \`${ev.id}\`) — <t:${toUnixTimestamp(new Date(ev.target_date))}:f>`);
      }
      
      embed.setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'remove') {
      const eventId = interaction.options.getString('id').toUpperCase();
      const ev = getEvent(eventId);

      if (!ev) {
        return interaction.reply({ content: `❌ Event not found. It might have already ended or been cancelled.`, ephemeral: true });
      }

      if (eventTimers.has(eventId)) {
        const timers = eventTimers.get(eventId);
        if (timers.reminder) clearTimeout(timers.reminder);
        if (timers.start) clearTimeout(timers.start);
        eventTimers.delete(eventId);
      }

      deleteEvent(eventId);

      if (ev.channel_id && ev.message_id) {
        try {
          const channel = await interaction.client.channels.fetch(ev.channel_id);
          const message = await channel.messages.fetch(ev.message_id);
          if (message) {
            const disabledRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`rsvp_yes_${eventId}`).setLabel('Available').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(true),
              new ButtonBuilder().setCustomId(`rsvp_no_${eventId}`).setLabel('Unavailable').setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(true)
            );

            const cancelledEmbed = EmbedBuilder.from(message.embeds[0])
              .setTitle(`🚫 CANCELLED: ${ev.name}`)
              .setColor(0xe74c3c);

            await message.edit({ embeds: [cancelledEmbed], components: [disabledRow], attachments: [] }).catch(() => {});
          }
        } catch(e) {}
      }

      return interaction.reply({ content: `✅ Event **${ev.name}** has been cancelled.`, ephemeral: true });
    }

    if (subcommand === 'edit') {
      const eventId = interaction.options.getString('id').toUpperCase();
      const timeStr = interaction.options.getString('time');
      
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');

      const ev = getEvent(eventId);

      if (!ev) {
        return interaction.reply({ content: `❌ Event not found. It might have already ended or been cancelled.`, ephemeral: true });
      }

      const targetDate = parseTimeToday(timeStr);
      if (!targetDate) {
        return interaction.reply({ content: '❌ Invalid time format. Use UTC HH:MM, e.g. 18:00.', ephemeral: true });
      }
      
      if (targetDate.getTime() <= Date.now()) {
        return interaction.reply({ content: '❌ The new time must be in the future.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const newDateStr = targetDate.toISOString();
      updateEventDetails(eventId, newDateStr, rawX, rawY);
      scheduleEventTimers(interaction.client, { ...ev, target_date: newDateStr });

      let attachment;
      if (rawX !== null && rawY !== null) {
        try {
          const x = clampCoordinate(rawX, MAX_X);
          const y = clampCoordinate(rawY, MAX_Y);
          const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: 'attack' }]);
          
          attachment = new AttachmentBuilder(imageBuffer, { name: 'map.png' });
        } catch (error) {
          console.error('Error generating map image for edit:', error);
        }
      }

      try {
        const channel = await interaction.client.channels.fetch(ev.channel_id);
        const message = await channel.messages.fetch(ev.message_id);
        
        const oldEmbed = EmbedBuilder.from(message.embeds[0]);
        const yesField = oldEmbed.data.fields.find(f => f.name.startsWith('✅')) || { name: '✅ Available (0)', value: 'None yet', inline: true };
        const noField = oldEmbed.data.fields.find(f => f.name.startsWith('❌')) || { name: '❌ Unavailable (0)', value: 'None yet', inline: true };
        
        const availString = await buildAvailabilityString(interaction.guild, targetDate);
        const unixSec = toUnixTimestamp(targetDate);
        const utcTimeString = `${String(targetDate.getUTCHours()).padStart(2, '0')}:${String(targetDate.getUTCMinutes()).padStart(2, '0')} UTC`;

        oldEmbed.setFields(
          { name: 'Time (Local)', value: `<t:${unixSec}:F>`, inline: false },
          { name: 'Time (UTC)', value: `**${utcTimeString}**`, inline: true },
          { name: 'Starts In', value: `<t:${unixSec}:R>`, inline: true },
          { name: 'Event ID', value: `\`${eventId}\``, inline: true },
          { name: '📊 Theoretical Availability', value: availString, inline: false },
          yesField,
          noField
        );

        const messagePayload = { embeds: [oldEmbed], attachments: [] };

        if (attachment) {
          oldEmbed.setImage('attachment://map.png');
          messagePayload.files = [attachment];
        }

        await message.edit(messagePayload);
      } catch (e) {
        console.error('Could not edit original message:', e);
      }
      return interaction.editReply({ content: `✅ Event **${ev.name}** updated successfully.` });
    }

    if (subcommand === 'add') {
      const name = interaction.options.getString('name');
      const timeStr = interaction.options.getString('time');
      const description = interaction.options.getString('description');
      
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');

      const targetDate = parseTimeToday(timeStr);

      if (!targetDate) {
        return interaction.reply({
          content: '❌ Invalid time format. Use UTC HH:MM, e.g. 18:00.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      const unixSec = toUnixTimestamp(targetDate);
      const eventId = generateId();
      const utcTimeString = `${String(targetDate.getUTCHours()).padStart(2, '0')}:${String(targetDate.getUTCMinutes()).padStart(2, '0')} UTC`;
      const availString = await buildAvailabilityString(interaction.guild, targetDate);

      let attachment;
      if (rawX !== null && rawY !== null) {
        try {
          const x = clampCoordinate(rawX, MAX_X);
          const y = clampCoordinate(rawY, MAX_Y);
          const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: 'attack' }]);
          
          attachment = new AttachmentBuilder(imageBuffer, { name: 'map.png' });
        } catch (error) {
          console.error('Error generating map image:', error);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`📅 Event: ${name}`)
        .setColor(0xe67e22)
        .addFields(
          { name: 'Time (Local)', value: `<t:${unixSec}:F>`, inline: false },
          { name: 'Time (UTC)', value: `**${utcTimeString}**`, inline: true },
          { name: 'Starts In', value: `<t:${unixSec}:R>`, inline: true },
          { name: 'Event ID', value: `\`${eventId}\``, inline: true },
          { name: '📊 Theoretical Availability', value: availString, inline: false }
        );
        
      if (description) embed.setDescription(description);

      embed.addFields(
        { name: '✅ Available (0)', value: 'None yet', inline: true },
        { name: '❌ Unavailable (0)', value: 'None yet', inline: true }
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rsvp_yes_${eventId}`).setLabel('Available').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`rsvp_no_${eventId}`).setLabel('Unavailable').setStyle(ButtonStyle.Danger).setEmoji('❌')
      );

      const payload = { 
        content: '@everyone\n🆕 **New Event Created!**',
        embeds: [embed], 
        components: [row],
        allowedMentions: { parse: ['everyone'] },
        attachments: []
      };
      
      if (attachment) {
        embed.setImage('attachment://map.png');
        payload.files = [attachment];
      }

      const response = await interaction.editReply(payload);

      const eventRow = {
        id: eventId,
        name,
        target_date: targetDate.toISOString(),
        description: description || '',
        x: rawX,
        y: rawY,
        channel_id: interaction.channelId,
        message_id: response.id
      };
      
      addEvent(eventRow);
      scheduleEventTimers(interaction.client, eventRow);
    }
  },
};