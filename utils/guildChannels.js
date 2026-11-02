async function fetchGuildChannel(client, guildId, channelId) {
  if (!guildId || !channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel && channel.guildId === guildId ? channel : null;
}
module.exports = { fetchGuildChannel };
