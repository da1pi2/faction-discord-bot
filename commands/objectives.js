const { AttachmentBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { addObjective, clearObjectives, deleteObjective, listObjectives, updateObjective } = require('../data/db');
const { MAX_X, MAX_Y, clampCoordinate, parseCoordinatePair, renderMapWithMarkers } = require('../utils/mapRenderer');

function buildObjectivesDescription(objectives) {
  if (objectives.length === 0) {
    return 'No objectives saved yet.';
  }

  return objectives.map((objective) => `• **${objective.name}**: ${objective.x}, ${objective.y}`).join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('objectives')
    .setDescription('Manage persistent map objectives')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a new objective marker')
        .addStringOption((opt) => opt.setName('name').setDescription('Objective name').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('coordinates')
            .setDescription('Coordinates in the form (x, y)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('x').setDescription('X coordinate').setMinValue(0).setMaxValue(MAX_X).setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('y').setDescription('Y coordinate').setMinValue(0).setMaxValue(MAX_Y).setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('update')
        .setDescription('Update an existing objective marker')
        .addStringOption((opt) => opt.setName('name').setDescription('Objective name').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('coordinates')
            .setDescription('Coordinates in the form (x, y)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('x').setDescription('X coordinate').setMinValue(0).setMaxValue(MAX_X).setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('y').setDescription('Y coordinate').setMinValue(0).setMaxValue(MAX_Y).setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove an objective marker')
        .addStringOption((opt) => opt.setName('name').setDescription('Objective name').setRequired(true))
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List all saved objectives'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('show')
        .setDescription('Render the map with all saved objectives')
        .addBooleanOption((opt) =>
          opt
            .setName('public')
            .setDescription('Show the image to everyone in the channel')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName('clear').setDescription('Remove all saved objectives')),

  async execute(interaction) {
    const action = interaction.options.getSubcommand();

    if (action === 'add') {
      const name = interaction.options.getString('name').trim();
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');

      if (rawX === null || rawY === null) {
        await interaction.reply({
          content: '❌ Provide either `coordinates` in the form `(1348, 1551)` or both `x` and `y`.',
          ephemeral: true,
        });
        return;
      }

      const x = clampCoordinate(rawX, MAX_X);
      const y = clampCoordinate(rawY, MAX_Y);

      try {
        addObjective(name, x, y);
      } catch (error) {
        if (error && typeof error.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
          await interaction.reply({
            content: `⚠️ Objective **${name}** already exists. Use /objectives update to move it.`,
            ephemeral: true,
          });
          return;
        }
        throw error;
      }

      await interaction.reply({
        content: `✅ Objective **${name}** saved at x: ${x}, y: ${y}.`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'update') {
      const name = interaction.options.getString('name').trim();
      const coordinatesInput = interaction.options.getString('coordinates');
      const parsedCoordinates = parseCoordinatePair(coordinatesInput);
      const rawX = parsedCoordinates?.x ?? interaction.options.getInteger('x');
      const rawY = parsedCoordinates?.y ?? interaction.options.getInteger('y');

      if (rawX === null || rawY === null) {
        await interaction.reply({
          content: '❌ Provide either `coordinates` in the form `(1348, 1551)` or both `x` and `y`.',
          ephemeral: true,
        });
        return;
      }

      const x = clampCoordinate(rawX, MAX_X);
      const y = clampCoordinate(rawY, MAX_Y);

      const result = updateObjective(name, x, y);

      if (result.changes === 0) {
        await interaction.reply({
          content: `⚠️ Objective **${name}** was not found. Use /objectives add to create it first.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `✅ Objective **${name}** updated to x: ${x}, y: ${y}.`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'remove') {
      const name = interaction.options.getString('name').trim();
      const result = deleteObjective(name);

      await interaction.reply({
        content: result.changes > 0 ? `✅ Objective **${name}** removed.` : `⚠️ Objective **${name}** was not found.`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'clear') {
      const result = clearObjectives();
      await interaction.reply({
        content: `✅ Cleared ${result.changes} saved objective(s).`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'list') {
      const objectives = listObjectives();
      const embed = new EmbedBuilder()
        .setTitle('📍 Saved Objectives')
        .setColor(0x3498db)
        .setDescription(buildObjectivesDescription(objectives));

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (action === 'show') {
      const isPublic = interaction.options.getBoolean('public') ?? false;
      await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

      const objectives = listObjectives();
      if (objectives.length === 0) {
        await interaction.editReply({ content: '⚠️ No objectives saved yet.' });
        return;
      }

      const { imageBuffer } = await renderMapWithMarkers(objectives);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'dragonfire-objectives.webp' });

      await interaction.editReply({
        content: `📍 Showing ${objectives.length} saved objective(s).`,
        files: [attachment],
      });
    }
  },
};