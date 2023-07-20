import { Client } from '@notionhq/client';
import TestsDatabase from './databases/TestsDatabase';
import IssuesDatabase from './databases/IssuesDatabase';

export type Language = 'EN' | 'FR';

interface DatabaseControllerConfig {
  auth: string;
  dbIDs: {
    tests: string;
    issues: string;
  };
}

export default class DatabaseController {
  readonly client: Client;
  public lang: Language;
  public readonly tests: TestsDatabase;
  public readonly issues: IssuesDatabase;

  constructor({ auth, dbIDs }: DatabaseControllerConfig) {
    this.client = new Client({
      auth,
      async fetch(url: string, init?: RequestInit) {
        try {
          const res = await fetch(url, init);
          if (!res.ok) throw new Error();
          return res;
        } catch {
          console.warn(`\nNotion API error (${url}), retrying...\n`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return fetch(url, init);
        }
      }
    });

    this.tests = new TestsDatabase({
      controller: this,
      id: dbIDs.tests,
    });

    this.issues = new IssuesDatabase({
      controller: this,
      id: dbIDs.issues,
    });
  }

  public async setup() {
    let errored = false;

    for (const db of [
      this.tests,
      this.issues,
    ]) errored = !(await db.setup()) || errored;

    if (errored) {
      console.error('Exiting due to wrong database schema.');
      process.exit(1);
    }
  }
}
