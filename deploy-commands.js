require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`⏳ Registrazione di ${commands.length} comandi slash...`);

    // Registrazione su una singola guild: istantanea, ideale in fase di sviluppo.
    // Per registrare i comandi globalmente su tutti i server (richiede fino a 1h
    // di propagazione) usa Routes.applicationCommands(CLIENT_ID) invece.
    console.log(JSON.stringify(commands.find(c => c.name === 'profile'), null, 2));
    
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Comandi registrati con successo.');
  } catch (err) {
    console.error('Errore durante la registrazione dei comandi:', err);
  }
})();
