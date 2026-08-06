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
    console.log(`⏳ Registrazione globale di ${commands.length} comandi slash...`);

    // Registrazione globale: i comandi saranno disponibili in tutti i server
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('✅ Comandi globali registrati con successo. (Potrebbe volerci qualche istante per propagarsi su tutti i server).');
  } catch (err) {
    console.error('Errore durante la registrazione dei comandi:', err);
  }
})();
