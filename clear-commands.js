require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Eliminazione dei comandi slash dal server originale...');

    // Passando un array vuoto [], diciamo a Discord di cancellare tutti i comandi di quel server
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );

    console.log('✅ Comandi del vecchio server eliminati con successo!');
    console.log('💡 Ora i membri vedranno solo i comandi globali (potrebbe servire un riavvio di Discord).');
  } catch (err) {
    console.error('Errore durante la pulizia dei comandi:', err);
  }
})();