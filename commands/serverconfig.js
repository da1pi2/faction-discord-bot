const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../data/db');
module.exports = {
  data: new SlashCommandBuilder().setName('serverconfig').setDescription('Configure this server channels')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o=>o.setName('status').setDescription('Bot status channel').addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o=>o.setName('backup').setDescription('Private channel for backups of this server only').addChannelTypes(ChannelType.GuildText))
    .addBooleanOption(o=>o.setName('disable_status').setDescription('Disable status announcements'))
    .addBooleanOption(o=>o.setName('disable_backup').setDescription('Disable Discord backups')),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({content:'Manage Server permission required.',ephemeral:true});
    const settings = getGuildSettings(interaction.guildId);
    for (const [option,key] of [['status','status_channel_id'],['backup','backup_channel_id']]) {
      const channel=interaction.options.getChannel(option);
      if (channel) {
        if(channel.guildId !== interaction.guildId) return interaction.reply({content:'Choose a channel in this server.',ephemeral:true});
        settings[key]=channel.id;
      }
      if(interaction.options.getBoolean(`disable_${option}`)) settings[key]=null;
    }
    setGuildSettings(interaction.guildId,settings);
    return interaction.reply({content:`Status channel: ${settings.status_channel_id ? `<#${settings.status_channel_id}>` : 'disabled'}\nBackup channel: ${settings.backup_channel_id ? `<#${settings.backup_channel_id}>` : 'disabled'}`,ephemeral:true});
  }
};
