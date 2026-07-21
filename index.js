require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { AttachmentBuilder, Client, GatewayIntentBits, Collection } = require('discord.js');
const { syncGuildActivityRoles } = require('./utils/roleManager');
const { logSnapshot, dbEvents, createBackup } = require('./data/db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // necessario per leggere i ruoli dei membri
    GatewayIntentBits.GuildMessages, // necessario per /summary (leggere cronologia canale)
    GatewayIntentBits.MessageContent, // necessario per /summary (contenuto testuale dei messaggi)
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

    // 1. Trova e cancella i messaggi precedenti del bot nel canale di backup
    const messages = await channel.messages.fetch({ limit: 10 });
    const oldBackups = messages.filter(m => m.author.id === client.user.id);
    for (const [, msg] of oldBackups) {
      await msg.delete().catch(() => {});
    }

    // 2. Crea il backup in locale
    const backupPath = path.join(__dirname, 'data', 'temp_backup.sqlite');
    await createBackup(backupPath);

    // 3. Invia il nuovo backup
    const dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const attachment = new AttachmentBuilder(backupPath, { name: `dragonfire-db-${dateStr}.sqlite` });
    
    await channel.send({ 
      content: `📦 **Backup automatico del database**\n🛠️ Ultima operazione: *${reason}*\n🕒 Aggiornato al: ${new Date().toUTCString()}`, 
      files: [attachment] 
    });

    // 4. Pulisci il file temporaneo
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    console.error('Errore durante l\'aggiornamento del backup Discord:', error);
  } finally {
    isBackingUp = false;
  }
}
// ----------------------------------

client.once('clientReady', async () => {
  console.log(`✅ Bot connesso come ${client.user.tag}`);

  // --- LISTENER PER IL BACKUP CON DEBOUNCE ---
  let backupTimeout = null;
  let latestReason = 'Aggiornamento avvio bot';
  
  dbEvents.on('update', (reason) => {
    if (reason) {
      latestReason = reason;
    }
    // Se ci sono stati aggiornamenti recenti, azzera il timer (evita spam)
    if (backupTimeout) clearTimeout(backupTimeout);
    // Attende 5 secondi di inattività sul DB prima di caricare il file su Discord
    backupTimeout = setTimeout(() => {
      performDiscordBackup(latestReason);
    }, 5000); 
  });
  // -------------------------------------------

  // Fetch completo dei membri UNA SOLA VOLTA per server, in sequenza (non in
  // parallelo) per evitare di saturare il rate limit gateway sull'opcode 8
  // (richiesta lista membri). Dopo questo fetch iniziale, la cache resta
  // aggiornata da sola grazie all'intent GuildMembers: non va piu rifatto.
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch();
      console.log(`👥 Membri caricati per "${guild.name}"`);
    } catch (err) {
      console.error(`Errore fetch membri su ${guild.name}:`, err);
    }
    await sleep(1000); // piccola pausa tra un server e l'altro
  }

  // Sync iniziale + snapshot per ogni server in cui e presente il bot
  for (const [, guild] of client.guilds.cache) {
    try {
      const summary = await syncGuildActivityRoles(guild);
      logSnapshot(summary);
      console.log(`🔄 Sync iniziale completato per "${guild.name}"`);
    } catch (err) {
      console.error(`Errore sync iniziale su ${guild.name}:`, err);
    }
  }

  // Ogni 15 minuti: ricalcola i ruoli di stato e salva uno snapshot storico
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
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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
});

client.login(process.env.DISCORD_TOKEN);