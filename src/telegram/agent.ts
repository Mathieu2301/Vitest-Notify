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

interface TelegramReportOptions {
  stacks: Stack[];
  changes?: Changes;
  reportUrl?: string;
  notionUrls: PagesUrls;
}

export async function sendTelegramReport(
  { stacks, changes, reportUrl, notionUrls }: TelegramReportOptions,
) {
  if (!available) throw new Error('Telegram is not available');

  const report = (stacks
    .filter((stack) => !changes || changes[stack.id])
    .map((stack) => [
      `${statusEmojis.FAIL} *[FAIL]* ${stack.path.map((p) => `\`${p}\``).join('\n  > ')}`,
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
      stack.error.diff?.replace(/\x1B\[\d+m/g, '') ?? null,
      '',
      (reportUrl
        ? `Voir le détail: [report/#file=${stack.file.id}](${reportUrl}/#file=${stack.file.id})`
        : null
      ),
      (notionUrls[stack.id]
        ? `Voir l'erreur sur Notion: [notion/${notionUrls[stack.id].id}](${notionUrls[stack.id].url})`
        : null
      ),
      '\n',
    ])
    .filter((stack) => stack !== null)
    .flat()
  );

  for (const change of Object.values(changes ?? {})) {
    if (stacks.find((stack) => stack.id === change.id)) continue;

    const newEmoji = change.isNewTest ? '🆕 ' : '';
    const emoji = statusEmojis[change.status] ?? statusEmojis.UNKNOWN;

    report.push(
      `${newEmoji}${emoji} *[${change.status}]* ${change.path.map((p) => `\`${p}\``).join('\n  > ')}`,
      '',
    );
  }

  if (report.length === 0) {
    console.log('No report to send');
    return;
  }

  report.unshift(`======= *${config.namespace}* =======`, '');

  const url = new URL(`https://api.telegram.org/bot${config.key}/sendMessage`);
  url.searchParams.set('chat_id', config.chat as string);
  url.searchParams.set('parse_mode', 'markdown');
  url.searchParams.set('text', report.join('\n'));

  return new Promise((cb) => https.get(url, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Cannot send message to Telegram: ${res.statusCode} (${res.statusMessage})`);
      console.error(url);
      process.exit(1);
    }

    cb(true);
  }));
}

export default available;
