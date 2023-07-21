import https from 'https';
import { generateCodeSnippet, type Stack } from '../vitest/agent';
import type { Changes, PagesUrls } from '../notion/agent';
import type { TestStatus } from '../notion/databases/TestsDatabase';

const config = {
  namespace: process.env.VITEST_NAMESPACE,
  key: process.env.TELEGRAM_KEY,
  chat: process.env.TELEGRAM_CHAT,
};

export const available = (
  !!config.namespace
  && !!config.key
  && !!config.chat
);

const statusEmojis: {
  [status in TestStatus]: string;
} = {
  PASS: '✅',
  FAIL: '❌',
  SKIP: '⏭️',
  TODO: '📝',
  ONLY: '🔥',
  RUN: '⌛️',
  UNKNOWN: '❓',
};

function sendTelegramMessage(text: string) {
  console.log(`Sending message to Telegram (size: ${text.length})...`);

  const url = new URL(`https://api.telegram.org/bot${config.key}/sendMessage`);
  url.searchParams.set('chat_id', config.chat);
  url.searchParams.set('parse_mode', 'markdown');
  url.searchParams.set('text', text);

  return new Promise((cb) => https.get(url, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Cannot send message to Telegram: ${res.statusCode} (${res.statusMessage})`);
      console.error(url);
      console.error(text);
      process.exit(1);
    }

    cb(true);
  }));
}

interface TelegramReportOptions {
  stacks: Stack[];
  changes?: Changes;
  reportUrl?: string;
  notionUrls: PagesUrls;
}

const pathFormat = (path: string[]) => path.map((p) => `\`${p}\``).join('\n  > ');

export async function sendTelegramReport(
  { stacks, changes, reportUrl, notionUrls }: TelegramReportOptions,
) {
  if (!available) throw new Error('Telegram is not available');

  const getNewEmoji = (stack: Stack) => (changes?.[stack.id]?.isNewTest ? '🆕' : '');

  const report = (stacks
    .filter((stack) => !changes || changes[stack.id])
    .map((stack) => (
      [
        `${getNewEmoji(stack)}${statusEmojis.FAIL} *[FAIL]* ${pathFormat(stack.path)}`,
        '',
        `*${stack.error.name}*: \`${stack.error.message}\``,
        `  ❯ \`${stack.file.name}:${stack.line}:${stack.column}\``,
        '',
        (stack.line
          ? `${generateCodeSnippet({
            filepath: stack.file.path,
            line: stack.line,
            column: stack.column,
            markdownMode: true,
          })}\n`
          : null
        ),

        stack.error.diff?.replace(/\x1B\[\d+m/g, ''),

        (reportUrl
          ? `Voir le détail: [report/#file=${stack.file.id}](${reportUrl}/#file=${stack.file.id})`
          : null
        ),
        (notionUrls[stack.id]
          ? `Voir l'erreur sur Notion: [notion/${notionUrls[stack.id].id}](${notionUrls[stack.id].url})`
          : null
        ),
        '',
      ]
      .filter((line) => line !== null)
      .flat()
      .join('\n')
    ))
  );

  for (const change of Object.values(changes ?? {})) {
    if (stacks.find((stack) => stack.id === change.id)) continue;

    const newEmoji = change.isNewTest ? '🆕' : '';
    const emoji = statusEmojis[change.status] ?? statusEmojis.UNKNOWN;

    report.push(
      `${newEmoji}${emoji} *[${change.status}]* ${pathFormat(change.path)}`,
      '',
    );
  }

  if (report.length === 0) {
    console.log('No report to send');
    return;
  }

  report.unshift(`======= *${config.namespace}* =======`, '');

  // split in chunks of 4096 chars
  const chunks = [];

  let chunk = '';
  for (const line of report) {
    if (line === null) continue;
    if (line.length >= 4096) {
      console.error('Line is too long to be sent to Telegram. Skipping...');
      continue;
    }
    if (chunk.length + line.length >= 4096) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += `${line}\n`;
  }

  if (chunk.length > 0) chunks.push(chunk);

  for (const chunk of chunks) await sendTelegramMessage(chunk);
}

export default available;
