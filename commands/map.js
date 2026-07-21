const { AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { MAX_X, MAX_Y, clampCoordinate, renderMapWithMarkers } = require('../utils/mapRenderer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('Place a location marker on the Dragonfire map')
    .addIntegerOption((opt) =>
      opt
        .setName('x')
        .setDescription('X coordinate on the map')
        .setMinValue(0)
        .setMaxValue(MAX_X)
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('y')
        .setDescription('Y coordinate on the map')
        .setMinValue(0)
        .setMaxValue(MAX_Y)
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const x = clampCoordinate(interaction.options.getInteger('x'), MAX_X);
      const y = clampCoordinate(interaction.options.getInteger('y'), MAX_Y);

      const { imageBuffer } = await renderMapWithMarkers([{ x, y }]);

      const attachment = new AttachmentBuilder(imageBuffer, { name: 'dragonfire-location.webp' });

      await interaction.editReply({
        content: `Marker placed at x: ${x}, y: ${y}`,
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