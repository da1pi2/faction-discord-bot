const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatMessageLine(message) {
  const timestamp = new Date(message.createdTimestamp).toISOString().slice(11, 16);
  const author = message.author.bot ? `${message.author.username} [bot]` : message.author.username;
  const content = message.content?.trim();
  const attachments = message.attachments.size
    ? ` [allegati: ${[...message.attachments.values()].map((file) => file.name || 'file').join(', ')}]`
    : '';

  if (!content && !attachments) {
    return `[${timestamp}] ${author}: [messaggio senza testo]`;
  }

  const cleaned = truncate((content || '[contenuto non disponibile]') + attachments, 260);
  return `[${timestamp}] ${author}: ${cleaned}`;
}

async function fetchRecentMessages(channel, hours, maxMessages = 300) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const collected = [];
  let before;

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    const messages = [...batch.values()];
    for (const message of messages) {
      if (message.createdTimestamp < cutoff) break;
      collected.push(message);
      if (collected.length >= maxMessages) return collected;
    }

    const oldest = messages[batch.size - 1];
    if (!oldest || oldest.createdTimestamp < cutoff || batch.size < 100) break;
    before = oldest.id;
  }

  return collected;
}

async function summarizeChannelMessages({ channel, guildName, channelName, hours, language }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY non configurata nel file .env');
  }

  const messages = await fetchRecentMessages(channel, hours);
  console.log(`[summary] messaggi trovati nelle ultime ${hours}h: ${messages.length}`); // debug temporaneo

  if (messages.length === 0) {
    return {
      summary: 'Non ho trovato messaggi sufficienti nel periodo richiesto.',
      messagesCount: 0,
      authorsCount: 0,
      model: DEFAULT_MODEL,
    };
  }

  const authors = new Set();
  const transcript = messages
    .map((message) => {
      authors.add(message.author.id);
      return formatMessageLine(message);
    })
    .join('\n');

  const systemPrompt = [
    'Sei un assistente che riassume conversazioni Discord in modo accurato e conciso.',
    `Scrivi il riassunto in ${language}.`,
    'Non inventare dettagli mancanti.',
    'Metti in evidenza: temi principali, decisioni prese, domande aperte, azioni da fare e informazioni importanti.',
    'Se il contenuto e scarso o rumoroso, dillo chiaramente.',
    'Rispondi solo con il riassunto finale, senza preamboli o spiegazioni sul processo.',
  ].join(' ');

  const userPrompt = [
    `Server: ${guildName}`,
    `Canale: ${channelName}`,
    `Finestra temporale: ultime ${hours} ore`,
    '',
    'Messaggi:',
    transcript,
  ].join('\n');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://localhost',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Discord Summary Bot',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter ha risposto con ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const summary = payload?.choices?.[0]?.message?.content?.trim();

  if (!summary) {
    throw new Error('OpenRouter non ha restituito un riassunto valido');
  }

  return {
    summary,
    messagesCount: messages.length,
    authorsCount: authors.size,
    model: payload.model || DEFAULT_MODEL,
  };
}

module.exports = {
  summarizeChannelMessages,
};