const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType,
  AttachmentBuilder
} = require('discord.js');
const { toUnixTimestamp } = require('../utils/timeUtils');
const { getGuildMembersTimezones } = require('../utils/roleManager');
const { computeAvailability } = require('./when');
const { parseCoordinatePair, clampCoordinate, MAX_X, MAX_Y, renderMapWithMarkers } = require('../utils/mapRenderer');

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

async function buildAvailabilityString(guild, targetDate) {
  const utcHour = targetDate.getUTCHours();
  const membersData = await getGuildMembersTimezones(guild);
  const { byStatus, scorePercent } = computeAvailability(membersData, utcHour);
  return `✅ ${byStatus.available} | ☀️ ${byStatus.day} | 🌙 ${byStatus.night} — Score: **${scorePercent}%**`;
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

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = [];
    
    for (const [id, ev] of activeEvents.entries()) {
      choices.push({ name: `${ev.name} (ID: ${id})`, value: id });
    }

    const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue));
    await interaction.respond(filtered.slice(0, 25));
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
      if (ev.collector) ev.collector.stop();
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

    if (subcommand === 'edit') {
      const eventId = interaction.options.getString('id').toUpperCase();
      const timeStr = interaction.options.getString('time');
      
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');

      const ev = activeEvents.get(eventId);

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

      ev.targetDate = targetDate;
      const unixSec = toUnixTimestamp(targetDate);
      const utcTimeString = `${String(targetDate.getUTCHours()).padStart(2, '0')}:${String(targetDate.getUTCMinutes()).padStart(2, '0')} UTC`;
      
      ev.timers.forEach(t => clearTimeout(t));
      ev.timers = [];
      
      const msUntilEvent = targetDate.getTime() - Date.now();
      const msUntilReminder = msUntilEvent - 30 * 60 * 1000;
      const channel = ev.message.channel;

      if (msUntilReminder > 0) {
        const reminderTimer = setTimeout(() => {
          if (!activeEvents.has(eventId)) return;
          channel.send(`🐉 **${ev.name}** starts in 30 minutes!`).catch(console.error);
        }, msUntilReminder);
        ev.timers.push(reminderTimer);
      }

      const startTimer = setTimeout(() => {
        if (!activeEvents.has(eventId)) return;
        const mentions = ev.yes.size > 0 ? Array.from(ev.yes).map(id => `<@${id}>`).join(' ') : '';
        channel.send(`🐉 **${ev.name} started!**\n${mentions}`).catch(console.error);
        if (ev.collector) ev.collector.stop();
        activeEvents.delete(eventId);
      }, Math.max(msUntilEvent, 0));
      
      ev.timers.push(startTimer);

      let attachment;
      if (rawX !== null && rawY !== null) {
        try {
          const x = clampCoordinate(rawX, MAX_X);
          const y = clampCoordinate(rawY, MAX_Y);
          const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: 'attack' }]);
          
          // Chiamato map.png per forzare Discord a nasconderlo come file standalone
          attachment = new AttachmentBuilder(imageBuffer, { name: 'map.png' });
        } catch (error) {
          console.error('Error generating map image for edit:', error);
        }
      }

      const oldEmbed = EmbedBuilder.from(ev.message.embeds[0]);
      const yesField = oldEmbed.data.fields.find(f => f.name.startsWith('✅')) || { name: '✅ Available (0)', value: 'None yet', inline: true };
      const noField = oldEmbed.data.fields.find(f => f.name.startsWith('❌')) || { name: '❌ Unavailable (0)', value: 'None yet', inline: true };
      
      const availString = await buildAvailabilityString(interaction.guild, targetDate);

      oldEmbed.setFields(
        { name: 'Time (Local)', value: `<t:${unixSec}:F>`, inline: false },
        { name: 'Time (UTC)', value: `**${utcTimeString}**`, inline: true },
        { name: 'Starts In', value: `<t:${unixSec}:R>`, inline: true },
        { name: 'Event ID', value: `\`${eventId}\``, inline: true },
        { name: '📊 Theoretical Availability', value: availString, inline: false },
        yesField,
        noField
      );

      const messagePayload = { embeds: [oldEmbed] };

      if (attachment) {
        oldEmbed.setImage('attachment://map.png');
        messagePayload.files = [attachment];
        messagePayload.attachments = []; 
      }

      await ev.message.edit(messagePayload);
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
      const msUntilEvent = targetDate.getTime() - Date.now();
      const msUntilReminder = msUntilEvent - 30 * 60 * 1000;
      
      const eventId = generateId();
      const utcTimeString = `${String(targetDate.getUTCHours()).padStart(2, '0')}:${String(targetDate.getUTCMinutes()).padStart(2, '0')} UTC`;
      const availString = await buildAvailabilityString(interaction.guild, targetDate);

      let attachment;
      if (rawX !== null && rawY !== null) {
        try {
          const x = clampCoordinate(rawX, MAX_X);
          const y = clampCoordinate(rawY, MAX_Y);
          const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: 'attack' }]);
          
          // Chiamato map.png per forzare Discord a nasconderlo come file standalone
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
      if (attachment) embed.setImage('attachment://map.png');

      embed.addFields(
        { name: '✅ Available (0)', value: 'None yet', inline: true },
        { name: '❌ Unavailable (0)', value: 'None yet', inline: true }
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rsvp_yes').setLabel('Available').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('rsvp_no').setLabel('Unavailable').setStyle(ButtonStyle.Danger).setEmoji('❌')
      );

      const payload = { embeds: [embed], components: [row] };
      if (attachment) payload.files = [attachment];

      const response = await interaction.editReply(payload);

      const eventData = {
        name,
        targetDate,
        message: response,
        yes: new Set(),
        no: new Set(),
        timers: [],
        collector: null
      };
      activeEvents.set(eventId, eventData);

      const collector = response.createMessageComponentCollector({ 
        componentType: ComponentType.Button 
      });
      eventData.collector = collector;

      collector.on('collect', async (i) => {
        if (!activeEvents.has(eventId)) {
          return i.reply({ content: '⚠️ This event has been cancelled or already ended.', ephemeral: true });
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
        
        if (eventData.collector) eventData.collector.stop();
        activeEvents.delete(eventId);
      }, Math.max(msUntilEvent, 0));
      
      eventData.timers.push(startTimer);
    }
  },
};