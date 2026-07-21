const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { MAX_X, MAX_Y, clampCoordinate, parseCoordinatePair, renderMapWithMarkers } = require('../utils/mapRenderer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('Place a location marker on the Dragonfire map')
    .addStringOption((opt) =>
      opt
        .setName('coordinates')
        .setDescription('Coordinates in the form (x, y)')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('x')
        .setDescription('X coordinate on the map')
        .setMinValue(0)
        .setMaxValue(MAX_X)
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('y')
        .setDescription('Y coordinate on the map')
        .setMinValue(0)
        .setMaxValue(MAX_Y)
        .setRequired(false)
    )
    // NUOVA OPZIONE: Scelta del tipo di marker
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Marker type to use')
        .setRequired(false)
        .addChoices(
          { name: 'Location (Default)', value: 'location' },
          { name: 'Defend', value: 'defend' }
        )
    )
    .addBooleanOption((opt) =>
      opt
        .setName('public')
        .setDescription('Show the image to everyone in the channel')
        .setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

    try {
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');
      // RECUPERA IL TIPO (fallback a location se l'utente non lo imposta)
      const markerType = interaction.options.getString('type') ?? 'location';

      if (rawX === null || rawY === null) {
        await interaction.editReply({
          content: '❌ Provide either `coordinates` in the form `(1348, 1551)` or both `x` and `y`.',
        });
        return;
      }

      const x = clampCoordinate(rawX, MAX_X);
      const y = clampCoordinate(rawY, MAX_Y);

      // PASSA IL TIPO nell'oggetto marker
      const { imageBuffer } = await renderMapWithMarkers([{ x, y, type: markerType }]);

      const attachment = new AttachmentBuilder(imageBuffer, { name: 'dragonfire-location.webp' });

      await interaction.editReply({
        content: `Marker placed at (${x}, ${y})`,
        files: [attachment],
      });
    } catch (error) {
      console.error('Error generating map marker image:', error);
      await interaction.editReply({
        content: '❌ I could not generate the map image for those coordinates.',
      });
    }
  },
};