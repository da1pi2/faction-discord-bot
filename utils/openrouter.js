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
  console.log(`[summary] messages found in the last ${hours}h: ${messages.length}`);

  if (messages.length === 0) {
    return {
      summary: 'I did not find enough messages in the requested time window.',
      messagesCount: 0,
      authorsCount: 0,
      model: 'N/A',
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
    'You are an expert gaming assistant specialized in analyzing Discord alliance/team conversations and producing accurate, concise, actionable gameplay summaries.',

    `LANGUAGE: Write the entire final output exclusively in ${language}. Preserve game names, usernames, coordinates, abbreviations, and necessary in-game terms exactly as written.`,

    'TASK: Extract gameplay-relevant decisions, strategic possibilities, coordinates, targets, threats, objectives, movements, and relevant timing information.',

    'CHOSEN STRATEGIES:',
    '- Include ONLY actions or plans that have been explicitly confirmed or clearly agreed upon by the team.',
    '- A proposal, suggestion, question, hypothesis, or personal opinion is NOT a chosen strategy.',
    '- Silence or lack of disagreement does NOT imply agreement.',
    '- If players disagree or no final decision exists, do not choose a strategy on their behalf.',

    'POSSIBILITIES TO EVALUATE:',
    '- Include proposals, alternatives, hypotheses, unresolved plans, and actions still under discussion.',
    '- Clearly preserve uncertainty and disagreement.',
    '- Never present a possibility as a confirmed decision.',

    'COORDINATES:',
    '- Extract every explicitly mentioned in-game coordinate.',
    '- Preserve coordinates exactly as written.',
    '- Associate each coordinate with its target, player, alliance, objective, threat, or relevant context.',
    '- Never invent or infer coordinates.',
    '- Consolidate repeated mentions of the same coordinate when they refer to the same situation.',

    'TIMING:',
    '- Extract relevant dates, times, deadlines, countdowns, or time windows when they affect gameplay actions.',
    '- Do not invent or assume missing dates, times, or timezones.',

    'ACCURACY:',
    '- Do not invent facts, outcomes, intentions, strategies, players, targets, or coordinates.',
    '- Ignore unrelated conversation, jokes, greetings, and noise.',
    '- Preserve important uncertainty and conflicting opinions.',
    '- Prefer factual extraction over interpretation.',

    'OUTPUT:',
    '- Start immediately with bullet points.',
    '- Use these sections when applicable:',
    '  • CHOSEN STRATEGIES',
    '  • POSSIBILITIES TO EVALUATE',
    '  • COORDINATES',
    '- Omit empty sections.',
    '- Keep bullets concise but include information necessary to understand and execute the plan.',
    '- Include timing information when relevant.',
    '- If the chat contains little or no useful gameplay information, state this clearly in one short bullet.',

    'STRICT RULES:',
    '- Output ONLY the final summary.',
    '- Do not output reasoning, chain-of-thought, analysis, or meta-commentary.',
    '- Do not write "Here is the summary", "Let me analyze", "I think", or similar introductory phrases.',
    '- The first character of the response must be the beginning of a bullet point.'
  ].join(' ');

  const userPrompt = [
    `Server: ${guildName}`,
    `Channel: ${channelName}`,
    `Time window: last ${hours} hours`,
    '',
    'Messages:',
    transcript,
  ].join('\n');

  // Recupera i modelli dal .env (separati da virgola) o usa una lista di default super stabile
  const modelList = process.env.OPENROUTER_MODEL
    ? process.env.OPENROUTER_MODEL.split(',').map(m => m.trim())
    : [
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.5-flash-lite-preview:free',
        'microsoft/phi-3-mini-128k-instruct:free',
        'qwen/qwen-2.5-72b-instruct:free'
      ];

  let lastError;

  // Ciclo di Fallback: prova un modello alla volta
  for (const currentModel of modelList) {
    try {
      console.log(`[summary] Tentativo in corso con il modello: ${currentModel}...`);
      
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://localhost',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'Discord Summary Bot',
        },
        body: JSON.stringify({
          model: currentModel,
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
        throw new Error(`Status ${response.status}: ${errorText}`);
      }

      const payload = await response.json();
      let summary = payload?.choices?.[0]?.message?.content?.trim();

      if (summary) {
        // Rimuovi eventuali tag <think> dei modelli "reasoning"
        summary = summary.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        
        console.log(`[summary] ✅ Successo con il modello: ${currentModel}`);
        return {
          summary,
          messagesCount: messages.length,
          authorsCount: authors.size,
          model: currentModel, // Passa all'embed il nome del modello che ha effettivamente funzionato
        };
      } else {
        throw new Error('L\'API non ha restituito testo valido.');
      }

    } catch (error) {
      console.error(`[summary] ❌ Fallito con ${currentModel}:`, error.message);
      lastError = error;
      // Continua il ciclo: passa al prossimo modello nell'array
    }
  }

  // Se siamo usciti dal ciclo, tutti i modelli hanno fallito
  throw new Error(`Tutti i modelli di fallback hanno fallito. Ultimo errore: ${lastError.message}`);
}

module.exports = {
  summarizeChannelMessages,
};