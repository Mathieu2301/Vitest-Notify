import fs from 'fs';
import path from 'path';
import { getStacks } from './vitest/agent';
import surgeAvailable, { uploadToSurge } from './surge/agent';
import telegramAvailable, { sendTelegramReport } from './telegram/agent';
import notionAvailable, {
  setupNotionDatabases,
  updateNotionTestsDB,
  updateNotionIssuesDB,
  updateNotionDatabases,
  type Changes,
  type PagesUrls,
} from './notion/agent';
import type { Vitest, Reporter, File } from 'vitest';

const agents = {
  telegram: telegramAvailable,
  notion: notionAvailable,
  surge: surgeAvailable,
};

const enabled = Object.values(agents).some((agent) => agent);

export default class CustomReporter implements Reporter {
  private outputFile: string;

  onInit(ctx: Vitest): void {
    if (!enabled) return;

    this.outputFile = (typeof ctx.config.outputFile === 'string'
      ? ctx.config.outputFile
      : ctx.config.outputFile?.html
    ) ?? 'html/index.html';

    if (surgeAvailable) {
      if (!(ctx.config.reporters as string[]).includes('html')) {
        console.error('Surge requires HTML reporter to be enabled.');
        process.exit(1);
      }

      console.log('Removing old report...');
      fs.rmSync(this.outputFile, { recursive: true, force: true });
    } else console.log('HTML reporter not enabled.');

    console.log('Custom reporter enabled. Using these agents:');
    for (const [agent, available] of Object.entries(agents)) {
      if (available) console.log(`- ${agent}`);
    }
  }

  async onFinished(files?: File[], errors?: unknown[]): Promise<void> {
    if (!enabled) return;

    let changes: Changes | undefined;

    if (notionAvailable) {
      console.log('Setting up Notion database...');
      await setupNotionDatabases();

      console.log('Updating Notion database...');
      changes = await updateNotionTestsDB(files);
    } else console.log('No Notion config provided. Skipping update.');

    const hasNewResults = (notionAvailable
      ? Object.keys(changes).length > 0
      : files?.some((file) => file.result?.state === 'fail')
    );

    let reportUrl: string | undefined;

    if (!surgeAvailable) console.log('No Surge config provided. Skipping upload report to Surge.');
    else if (!hasNewResults) console.log('No new results. Skipping upload report to Surge.');
    else {
      let check = 0;
      while (!fs.existsSync(this.outputFile)) {
        if (check > 5) {
          console.error('HTML report not found after 5 seconds. Exiting...');
          process.exit(1);
        }
        check += 1;
        console.log('Waiting for report to be generated...');
        await new Promise((cb) => setTimeout(cb, 1000));
      }

      console.log('Uploading report to Surge...');
      const { domain } = await uploadToSurge(
        path.dirname(this.outputFile),
      );

      reportUrl = `https://${domain}`;
      console.log(`Report uploaded to '${reportUrl}'`);
    }

    const stacks = getStacks(files ?? []);

    let notionUrls: PagesUrls = {};

    if (notionAvailable) {
      console.log('Sending issues to Notion...');
      notionUrls = await updateNotionIssuesDB(stacks, changes as Changes, reportUrl);

      console.log('Updating databases names and icons...');
      await updateNotionDatabases();
    }

    if (telegramAvailable) {
      console.log('Sending report to Telegram...');
      await sendTelegramReport({
        stacks,
        changes,
        reportUrl,
        notionUrls,
      });
    } else console.log('No Telegram config provided. Skipping report.');

    console.log('All done. Exiting...');
    process.exit(0);
  }
}
