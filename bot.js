const http = require('http');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN environment variable. Get one from @BotFather and set it in your host Variables.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// franc-min is ESM-only, so it is loaded once via dynamic import.
let francReady = import('franc-min').then((m) => m.franc);

// ISO 639-3 (what franc returns) -> [ISO 639-1 code for MyMemory, display name]
const LANG_MAP = {
  eng: ['en', 'English'], spa: ['es', 'Spanish'], fra: ['fr', 'French'],
  deu: ['de', 'German'], ita: ['it', 'Italian'], por: ['pt', 'Portuguese'],
  rus: ['ru', 'Russian'], cmn: ['zh-CN', 'Chinese'], jpn: ['ja', 'Japanese'],
  kor: ['ko', 'Korean'], arb: ['ar', 'Arabic'], ara: ['ar', 'Arabic'],
  hin: ['hi', 'Hindi'], tur: ['tr', 'Turkish'], nld: ['nl', 'Dutch'],
  pol: ['pl', 'Polish'], swe: ['sv', 'Swedish'], dan: ['da', 'Danish'],
  nob: ['no', 'Norwegian'], nno: ['no', 'Norwegian'], fin: ['fi', 'Finnish'],
  ces: ['cs', 'Czech'], ell: ['el', 'Greek'], heb: ['he', 'Hebrew'],
  tha: ['th', 'Thai'], vie: ['vi', 'Vietnamese'], ind: ['id', 'Indonesian'],
  zsm: ['ms', 'Malay'], zlm: ['ms', 'Malay'], msa: ['ms', 'Malay'],
  ukr: ['uk', 'Ukrainian'], ron: ['ro', 'Romanian'], hun: ['hu', 'Hungarian'],
  bul: ['bg', 'Bulgarian'], swh: ['sw', 'Swahili'], pes: ['fa', 'Persian'],
  fas: ['fa', 'Persian'], urd: ['ur', 'Urdu'], ben: ['bn', 'Bengali'],
  tam: ['ta', 'Tamil'], srp: ['sr', 'Serbian'], slk: ['sk', 'Slovak'],
  hrv: ['hr', 'Croatian']
};

async function detectLanguage(text) {
  const franc = await francReady;
  const code3 = franc(text); // 'und' if too short or ambiguous
  if (code3 === 'und') return null;
  return LANG_MAP[code3] || null;
}

// Split long text into chunks under MyMemory's ~500 character per-request limit.
function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const slice = remaining.slice(0, maxLen);
    let breakAt = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
    if (breakAt < maxLen * 0.4) breakAt = slice.lastIndexOf(' ');
    if (breakAt <= 0) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt + 1).trim());
    remaining = remaining.slice(breakAt + 1);
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
}

async function translateChunk(text, sourceCode) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceCode}|en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  if (data.responseStatus && Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || 'Translation failed');
  }
  return data.responseData ? data.responseData.translatedText : '';
}

async function translateToEnglish(text, sourceCode) {
  const chunks = chunkText(text, 450);
  const results = [];
  for (const chunk of chunks) {
    results.push(await translateChunk(chunk, sourceCode));
  }
  return results.join(' ');
}

const WELCOME_TEXT =
  '🚀 *English Translation Bot*\n\n' +
  'Translate words, sentences, and messages into clear, natural English instantly. ' +
  'Fast, simple, and easy to use.\n\n' +
  "Just send me any message in another language and I'll translate it into English " +
  'automatically, no commands needed.\n\n' +
  '_Tip: very short messages (a word or two) can be hard to detect reliably. A full ' +
  'phrase works best._';

bot.start((ctx) => ctx.replyWithMarkdown(WELCOME_TEXT));
bot.help((ctx) => ctx.replyWithMarkdown(WELCOME_TEXT));

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  if (text.trim().length < 2) return;

  try {
    const detected = await detectLanguage(text);

    if (!detected) {
      await ctx.reply(
        "🤔 Couldn't confidently detect the language of that message. Try sending a slightly longer phrase."
      );
      return;
    }

    const [code, name] = detected;

    if (code === 'en') {
      await ctx.reply("That's already in English 🇬🇧, nothing to translate.");
      return;
    }

    const translated = await translateToEnglish(text, code);
    if (!translated) {
      await ctx.reply("⚠️ Couldn't get a translation back just now. Try again in a moment.");
      return;
    }

    await ctx.reply(`🔤 _Detected: ${name}_\n\n${translated}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Translation failed:', err.message);
    await ctx.reply("⚠️ Couldn't translate that just now. Try again in a moment.");
  }
});

bot.catch((err, ctx) => {
  console.error(`Unhandled error for ${ctx.updateType}:`, err);
});

bot.launch().then(() => {
  console.log('English Translation Bot is up and polling for updates.');
});

// Tiny HTTP server so the host (and an uptime pinger) has something to hit.
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('English Translation Bot is running.');
  })
  .listen(PORT, () => console.log(`Health check server listening on port ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
