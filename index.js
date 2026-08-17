require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { 
  AttachmentBuilder, 
  Client, 
  GatewayIntentBits, 
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { syncGuildActivityRoles } = require('./utils/roleManager');
const { 
  logSnapshot, 
  dbEvents, 
  createBackup, 
  getUserTimezone, 
  clearUserAvailabilities, 
  addUserAvailability,
  getUserAvailabilities,
  deleteUserAvailabilityById,
  getAllEvents,
  getEventRsvps,
  deleteEvent,
  getEvent,
  setEventRsvp
} = require('./data/db');
const { clampCoordinate, MAX_X, MAX_Y, renderMapWithMarkers } = require('./utils/mapRenderer');
const { scheduleEventTimers } = require('./commands/event');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
  ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FUNZIONE DI BACKUP DISCORD ---
let isBackingUp = false;
async function performDiscordBackup(reason = 'Aggiornamento database') {
  if (isBackingUp) return;
  isBackingUp = true;
  
  try {
    const backupChannelId = process.env.BACKUP_CHANNEL_ID;
    if (!backupChannelId) {
      isBackingUp = false;
      return;
    }

    const channel = await client.channels.fetch(backupChannelId).catch(() => null);
    if (!channel) {
      isBackingUp = false;
      return;
    }

    const messages = await channel.messages.fetch({ limit: 10 });
    const oldBackups = messages.filter(m => m.author.id === client.user.id);
    for (const [, msg] of oldBackups) {
      await msg.delete().catch(() => {});
    }

    const backupPath = path.join(__dirname, 'data', 'temp_backup.sqlite');
    await createBackup(backupPath);

    const dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const attachment = new AttachmentBuilder(backupPath, { name: `dragonfire-db-${dateStr}.sqlite` });
    
    await channel.send({ 
      content: `📦 **Automatic Database Backup**\n🛠️ Last operation: *${reason}*\n🕒 Updated at: ${new Date().toUTCString()}`, 
      files: [attachment] 
    });

    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    console.error('Error during Discord backup update:', error);
  } finally {
    isBackingUp = false;
  }
}
// ----------------------------------

client.once('clientReady', async () => {
  console.log(`✅ Bot connesso come ${client.user.tag}`);

  const activeEvents = getAllEvents();
  for (const ev of activeEvents) {
    const targetDate = new Date(ev.target_date);
    if (targetDate.getTime() <= Date.now()) {
      deleteEvent(ev.id);
    } else {
      scheduleEventTimers(client, ev);
    }
  }

  // let backupTimeout = null;
  // let latestReason = 'Automatic update on bot startup';
  
  // dbEvents.on('update', (reason) => {
  //   if (reason) latestReason = reason;
  //   if (backupTimeout) clearTimeout(backupTimeout);
  //   backupTimeout = setTimeout(() => {
  //     performDiscordBackup(latestReason);
  //   }, 5000); 
  // });

  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch();
      console.log(`👥 Membri caricati per "${guild.name}"`);
    } catch (err) {
      console.error(`Errore fetch membri su ${guild.name}:`, err);
    }
    await sleep(1000);
  }

  for (const [, guild] of client.guilds.cache) {
    try {
      const summary = await syncGuildActivityRoles(guild);
      logSnapshot(summary);
      console.log(`🔄 Sync iniziale completato per "${guild.name}"`);
    } catch (err) {
      console.error(`Errore sync iniziale su ${guild.name}:`, err);
    }
  }

  cron.schedule('*/15 * * * *', async () => {
    for (const [, guild] of client.guilds.cache) {
      try {
        const summary = await syncGuildActivityRoles(guild);
        logSnapshot(summary);
        console.log(`🔄 [${new Date().toISOString()}] Ruoli aggiornati per "${guild.name}"`);
      } catch (err) {
        console.error(`Errore durante il sync periodico su ${guild.name}:`, err);
      }
    }
  });

  // Esegue il backup su Discord ogni 6 ore
  cron.schedule('0 */3 * * *', async () => {
    await performDiscordBackup('Backup programmato ogni 3 ore');
  });
});

// Ascolta tutti i messaggi per rilevare coordinate
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const coordRegex = /(?:\(\s*(\d{1,4})\s*,\s*(\d{1,4})\s*\))|(?:x\s*[:=]?\s*(\d{1,4})[,\s]+y\s*[:=]?\s*(\d{1,4}))/gi;
  let match;
  const foundCoords = [];

  while ((match = coordRegex.exec(message.content)) !== null) {
    let x, y;
    if (match[1] && match[2]) {
      x = parseInt(match[1], 10);
      y = parseInt(match[2], 10);
    } else if (match[3] && match[4]) {
      x = parseInt(match[3], 10);
      y = parseInt(match[4], 10);
    }

    if (x !== undefined && y !== undefined) {
      foundCoords.push({ x, y });
    }
  }

  if (foundCoords.length > 0) {
    const { x, y } = foundCoords[0]; 
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`map_prompt_${message.author.id}_${x}_${y}`)
        .setLabel(`🗺️ Generate Map (${x}, ${y})`)
        .setStyle(ButtonStyle.Secondary)
    );

    const promptMsg = await message.reply({
      content: `📍 I have detected the coordinate **(${x}, ${y})**.\nDo you want to view it on the map? *(This message will self-destruct in 15s if ignored)*`,
      components: [row],
      allowedMentions: { repliedUser: false }
    }).catch(() => null);

    if (promptMsg) {
      setTimeout(() => {
        promptMsg.delete().catch(() => {});
      }, 15000);
    }
  }
});

client.on('interactionCreate', async (interaction) => {

  // Gestione Bottoni Globali
  if (interaction.isButton()) {
    
    // 1. Gestione Pannello Availability (nuovo!)
   if (interaction.customId.startsWith('rsvp_yes_') || interaction.customId.startsWith('rsvp_no_')) {
      await interaction.deferUpdate();

      const parts = interaction.customId.split('_');
      const action = parts[1]; // 'yes' o 'no'
      const eventId = parts[2];
      
      const ev = getEvent(eventId);
      
      if (!ev) {
        return interaction.followUp({ content: '⚠️ This event has been cancelled or already ended.', ephemeral: true });
      }

      setEventRsvp(eventId, interaction.user.id, action);
      
      const rsvps = getEventRsvps(eventId);
      const yesSet = rsvps.filter(r => r.status === 'yes').map(r => r.user_id);
      const noSet = rsvps.filter(r => r.status === 'no').map(r => r.user_id);

      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
      const yesIndex = updatedEmbed.data.fields.findIndex(f => f.name.startsWith('✅'));
      const noIndex = updatedEmbed.data.fields.findIndex(f => f.name.startsWith('❌'));

      if (yesIndex !== -1) {
        updatedEmbed.data.fields[yesIndex].name = `✅ Available (${yesSet.length})`;
        updatedEmbed.data.fields[yesIndex].value = yesSet.length > 0 ? yesSet.map(id => `<@${id}>`).join('\n') : 'None yet';
      }
      if (noIndex !== -1) {
        updatedEmbed.data.fields[noIndex].name = `❌ Unavailable (${noSet.length})`;
        updatedEmbed.data.fields[noIndex].value = noSet.length > 0 ? noSet.map(id => `<@${id}>`).join('\n') : 'None yet';
      }

      // Aggiorna solo i campi testuali dell'embed senza toccare i file allegati
      await interaction.editReply({ embeds: [updatedEmbed] });
      return;
    }

    // 2. Gestione Prompt Mappa Automatica
    if (interaction.customId.startsWith('map_prompt_')) {
      const parts = interaction.customId.split('_');
      const targetUserId = parts[2];
      const xStr = parts[3];
      const yStr = parts[4];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({ content: '❌ This map prompt is not for you!', ephemeral: true });
      }

      await interaction.message.delete().catch(() => {});
      await interaction.deferReply();

      try {
        const x = clampCoordinate(parseInt(xStr, 10), MAX_X);
        const y = clampCoordinate(parseInt(yStr, 10), MAX_Y);

        const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: 'location' }]);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'map.png' });

        await interaction.editReply({ 
          files: [attachment], 
          content: `📍 Map requested by <@${interaction.user.id}> for coordinate **(${x}, ${y})**:` 
        });
      } catch (err) {
        console.error('Error generating automatic map:', err);
        await interaction.editReply({ content: '❌ Error occurred while generating the map.' });
      }
      return;
    }
  }

  // Gestione Comandi Slash
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Errore eseguendo /${interaction.commandName}:`, err);
      const errorReply = { content: '❌ An error occurred while executing the command.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorReply).catch(() => {});
      } else {
        await interaction.reply(errorReply).catch(() => {});
      }
    }
  } 
  
  // Gestione Menu Autocomplete
  else if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      if (typeof command.autocomplete === 'function') {
        await command.autocomplete(interaction);
      }
    } catch (err) {
      console.error(`Errore Autocomplete per /${interaction.commandName}:`, err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);