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
    ? ` [attachments: ${[...message.attachments.values()].map((file) => file.name || 'file').join(', ')}]`
    : '';

  if (!content && !attachments) {
    return `[${timestamp}] ${author}: [message without text]`;
  }

  const cleaned = truncate((content || '[content not available]') + attachments, 260);
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
    throw new Error('OPENROUTER_API_KEY is not configured in the .env file');
  }

  const messages = await fetchRecentMessages(channel, hours);
  console.log(`[summary] messages found in the last ${hours}h: ${messages.length}`); // debug temporaneo

  if (messages.length === 0) {
    return {
      summary: 'I did not find enough messages in the requested time window.',
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
  'You are an expert gaming assistant that summarizes Discord alliance/team conversations accurately and concisely.',
    'Write the summary in ${language}.',
    'Do not invent missing details or hallucinate game mechanics.',
    'Your primary task is to extract and structure the following key gameplay elements:',
    '- CHOSEN STRATEGIES: Highlight the specific tactics, plans, or actions the team has firmly decided to execute.',
    '- POSSIBILITIES TO EVALUATE: List alternative options, hypotheses, or future moves currently under discussion.',
    '- COORDINATES: Extract a clear list of all mentioned in-game coordinates along with their associated targets, threats, or relevant information.',
    'If the chat content is sparse, irrelevant, or too noisy, state so clearly.',
    'IMPORTANT: Reply ONLY with the final summary, organized logically using bullet points.',
    'Do not include your reasoning, analysis steps, meta-comments, literal translations of the original messages,',
    'or conversational filler like "Here is the summary" or "The user wants...".',
    'Do not repeat the instructions you received. Do not add preambles or final notes.'
  ].join(' ');

  const userPrompt = [
    `Server: ${guildName}`,
    `Channel: ${channelName}`,
    `Time window: last ${hours} hours`,
    '',
    'Messages:',
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
  let summary = payload?.choices?.[0]?.message?.content?.trim();

  if (summary) {
    // Alcuni modelli "reasoning" inseriscono il proprio ragionamento dentro
    // tag tipo <think>...</think> anche quando gli si chiede di non farlo.
    // Li rimuoviamo per sicurezza, qualunque sia il modello configurato.
    summary = summary.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  if (!summary) {
    throw new Error('OpenRouter did not return a valid summary');
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