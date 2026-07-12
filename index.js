require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { syncGuildActivityRoles } = require('./utils/roleManager');
const { logSnapshot } = require('./data/db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // necessario per leggere i ruoli dei membri
  ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

client.once('clientReady', async () => {
  console.log(`✅ Bot connesso come ${client.user.tag}`);

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
    const errorReply = { content: '❌ Si e verificato un errore eseguendo il comando.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorReply).catch(() => {});
    } else {
      await interaction.reply(errorReply).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);