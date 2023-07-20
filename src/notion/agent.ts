import Notion from './DatabaseController';
import env from '../config';
import { generateCodeSnippet, type Stack } from '../vitest/agent';
import { getIconUrl, type Icon } from './NotionDatabase';
import {
  statusIconsUrls,
  type TestStatus,
  type TestPage,
  type NewTestPage,
} from './databases/TestsDatabase';
import type { File, Task } from 'vitest';

const config = {
  namespace: env('VITEST_NAMESPACE'),
  notionKey: env('NOTION_KEY'),
  notionTestsDB: env('NOTION_TESTS_DB'),
  notionIssuesDB: env('NOTION_ISSUES_DB'),
};

export const available = (
  !!config.notionKey
  && !!config.notionTestsDB
  && !!config.notionIssuesDB
  && !!config.namespace
);

const notion = new Notion({
  auth: config.notionKey,
  dbIDs: {
    issues: config.notionIssuesDB,
    tests: config.notionTestsDB,
  },
});

function getNewActiveValue(
	newStatus: TestStatus,
	oldStatus?: TestStatus,
	oldActive?: boolean,
) {
  const passOrFail = Array.prototype.includes.bind(['PASS', 'FAIL']);
	if (!passOrFail(newStatus)) return false;
	if (!oldStatus || !passOrFail(oldStatus)) return true;
	return oldActive;
}

interface Test {
  /** Task ID */
  id: string;
  path: string[];
  title: string;
  fileName: string;
  filePath: string;
  tag: string;
  file: string;
  status: TestStatus;
}

export type Changes = { [taskId: string]: Change };

export interface Change {
  /** Task ID */
  id: string;
  path: string[];
  status: TestStatus;
  pageUrl: string;
  pageId: string;
  priority: string;
  assigned: { id: string }[];
  active: boolean;
  isNewTest: boolean;
}

export async function setupNotionDatabases() {
  if (!available) throw new Error('Notion is not available');

  await notion.setup();
  console.log('Notion database is ready');
};

const needUpdate = (base: any, reference: any) => {
  if (!base && base !== reference) return true;

  for (const key in reference) {
    const val = reference[key];
    if (typeof val === 'object') {
      if (needUpdate(base[key], val)) return true;
      continue;
    }
    if (base[key] !== val) return true;
  }

  return false;
}

export async function updateNotionTestsDB(files?: File[]) {
  if (!available) throw new Error('Notion is not available');

  const tests: Test[] = [];

  const tasks: {
    task: Task;
    path: string[];
    filePath: string;
  }[] = [];

  for (const file of files ?? []) {
    for (const task of file.tasks) tasks.push({
      task,
      path: [file.name.replace(/\.(?:test|spec)\.(?:ts|js)/g, ''), task.name],
      filePath: file.name,
    });
  }

  while (tasks.length > 0) {
    const { task, path, filePath } = tasks.shift() as typeof tasks[0];
    const subtasks = (task as { tasks: Task[] }).tasks;

    if (subtasks) {
      for (const subtask of subtasks) {
        tasks.push({ task: subtask, path: [...path, subtask.name], filePath });
      }
      continue;
    }

    tests.push({
      id: task.id,

      // ['dir', 'subdir', 'filename', 'testname', ...]
      path,

      // 'testname > ... > should be ...'
      title: path.slice(1).join(' > '),

      // 'filename'
      fileName: path[0].split('/').pop() as string,

      // 'dir/subdir'
      tag: path[0].split('/').slice(0, -1).join('/') || 'root',

      // 'dir/subdir/filename'
      file: path[0],

      // 'dir/subdir/filename.test.ts'
      filePath,

      // 'PASS' | 'FAIL' | 'SKIP' | ...
      status: (task.result?.state ?? task.mode).toUpperCase() as TestStatus ?? 'UNKNOWN',
    });
  }

  // Update database

  const { results: testPages } = await notion.tests.getRows({
    property: 'project',
    select: { equals: config.namespace },
  });

  const updated = new Set<string>();
  const changes: Changes = {};

  const stats = {
    kept: 0,
    created: [] as string[],
    updated: [] as string[],
    archived: [] as string[],
  };

  for (const test of tests) {
    let pages = testPages.filter(
      (page) => page.properties.name.title[0].text.content === test.title,
    );

    // Filter by tag if multiple pages with the same name exist
    if (pages.length > 1) {
      pages = pages.filter(
        (page) => page.properties.tag.select.name === test.tag,
      );
    }

    // Filter by file name if multiple pages with the same name and tag exist
    if (pages.length > 1) {
      pages = pages.filter(
        (page) => page.properties.fileName.select.name === test.fileName,
      );
    }

    // Show an error if multiple pages with the same name, tag and file name exist
    if (pages.length > 1) {
      console.error(`The '${test.filePath}' file has multiple (${pages.length}) tests with the same name '${test.title}'`);
      console.error('please check this file for duplicate tests and rename/remove them');
    }

    const page = pages.filter((page) => !updated.has(page.id))[0];

    const newActive = getNewActiveValue(
      test.status,
      page.properties.status.status.name as TestStatus,
      page.properties.active.checkbox,
    );

    const params: NewTestPage = {
      properties: {
        name: { title: [{ text: { content: test.title } }] },
        tag: { select: { name: test.tag } },
        fileName: { select: { name: test.fileName } },
        status: { status: { name: test.status } },
        project: { select: { name: config.namespace as string } },
        archived: { checkbox: false },
        active: { checkbox: newActive },
      },
      icon: statusIconsUrls[test.status] ?? statusIconsUrls.UNKNOWN,
    };

    const genChange = (testOldPage: TestPage, isNewTest: boolean): Change => ({
      id: test.id,
      path: test.path,
      status: test.status,
      pageId: testOldPage.id,
      pageUrl: testOldPage.url,
      priority: testOldPage.properties.priority.select?.name ?? null,
      assigned: testOldPage.properties.assigned.people.map(({ id }) => ({ id })),
      active: testOldPage.properties.active.checkbox || newActive,
      isNewTest,
    });

    // If a page exists, update it
    // else, create it
    if (page && page.id) {
      updated.add(page.id);

      if (!needUpdate(page, {
        properties: params.properties,
        icon: {
          type: 'external',
          external: { url: getIconUrl(params.icon) },
        },
      })) {
        stats.kept += 1;
        continue;
      }

      console.log(`Updating page '${test.title}'`);
      await notion.tests.editRow({
        id: page.id,
        ...params,
      });

      stats.updated.push(page.url);
      const change = genChange(page, false);
      if (change.active) changes[test.id] = change;
    } else {
      console.log(`Creating page '${test.title}'`);
      const page = await notion.tests.createRow(params);

      changes[test.id] = genChange(page, true);
      updated.add(page.id);
      stats.created.push(page.url);
    }
  }

  // Archive old pages
  for (const page of testPages) {
    if (
      !page.id
      || updated.has(page.id)
      || page.properties.archived.checkbox
    ) continue;

    console.log(`Archiving page '${page.properties.name.title?.[0].text.content}'`);

    await notion.tests.editRow({
      id: page.id,
      properties: {
        archived: { checkbox: true },
      },
    });

    stats.archived.push(page.url);
  }

  // Log stats
  console.log(
    'Notion database updated:\n',
    ` ${stats.kept} kept\n`,
    ` ${stats.created.length} created\n`,
    ...stats.created.map((url) => `   - ${url}\n`),
    ` ${stats.updated.length} updated\n`,
    ...stats.updated.map((url) => `   - ${url}\n`),
    ` ${stats.archived.length} archived\n`,
    ...stats.archived.map((url) => `   - ${url}\n`),
  );

  return changes;
};

export interface PagesUrls {
  [id: string]: {
    id: string;
    url: string;
  };
}

export async function updateNotionIssuesDB(stacks: Stack[], changes: Changes, reportUrl?: string): Promise<PagesUrls> {
  if (!available) throw new Error('Notion is not available');

  const pagesUrls: PagesUrls = {};
  const newStacks = stacks.filter((stack) => changes[stack.id]);

  for (const stack of Object.values(newStacks)) {
    const stackName = `${stack.error.name}: ${stack.error.message}`;

    console.log(
      'Creating issue page\n',
      ` for stack: '${stackName}'\n`,
      ` for test page: ${changes[stack.id].pageUrl}`,
    );

    const newPage = await notion.issues.createRow({
      properties: {
        name: { title: [{
          text: {
            content: stackName,
          },
        }] },
        test: { relation: [{
          id: changes[stack.id].pageId,
        }] },
        priority: (changes[stack.id].priority
          ? { select: { name: changes[stack.id].priority } }
          : undefined
        ),
        assigned: { people: changes[stack.id].assigned },
      },
      content: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'Stack trace' } }],
          },
        },
        {
          object: 'block',
          type: 'code',
          code: {
            language: 'typescript',
            rich_text: [{
              type: 'text',
              text: {
                content: [
                  stack.path.map((p) => `${p}`).join('\n  > '),
                  '',
                  `${stack.error.name}: ${stack.error.message}`,
                  `  ❯ ${stack.file.name}:${stack.line}:${stack.column}`,
                  '',
                  (stack.line
                    ? `${generateCodeSnippet({
                      filepath: stack.file.path,
                      line: stack.line,
                      column: stack.column,
                      markdownMode: false,
                      contextSize: 10,
                    })}\n`
                    : null
                  ),
                  stack.error.diff?.replace(/\x1B\[\d+m/g, '') ?? null,
                ].filter((line) => line !== null).join('\n'),
              },
            }],
          },
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'Report URL' } }],
          },
        },
        {
          object: 'block',
          type: 'bookmark',
          bookmark: {
            url: (reportUrl
              ? `${reportUrl}/#file=${stack.file.id}`
              : 'No report URL'
            ),
          },
        },
      ],
    });

    console.log(` => ${newPage.url}`);
    pagesUrls[stack.id] = { id: newPage.id, url: newPage.url };
  }

  return pagesUrls;
};

export async function updateNotionDatabases() {
  if (!available) throw new Error('Notion is not available');

  // Update databases titles and icons
  {
    console.log('Getting \'tests\' database...');
    const { results: testPages } = await notion.tests.getRows({
      and: [
        { property: 'archived', checkbox: { equals: false } },
        { property: 'active', checkbox: { equals: true } },
      ],
    });

    const statuses = testPages.map((page) => page.properties.status.status.name);
    const passCount = statuses.filter((status: TestStatus) => status === 'PASS').length;
    const totalCount = statuses.length;

    const pageIcon: Icon = (passCount === totalCount) ? 'checklist_green' : 'list_red';
    const oldTitleObject = (await notion.tests.getHeader()).title;
    const counterFormat = /[0-9]+\/[0-9]+/;

    const titleHasCounter = oldTitleObject.some(
      (obj) => obj.type === 'text' && counterFormat.test(obj.text.content),
    );

    let newTitleObject: typeof oldTitleObject | undefined;
    let newTitleFullText: string | undefined;

    if (titleHasCounter) {
      newTitleObject = oldTitleObject.map((obj) => {
        if (obj.type !== 'text') return null;
        obj.text.content = obj.text.content.replace(counterFormat, `${passCount}/${totalCount}`);
        return obj;
      }).filter((obj) => obj);

      newTitleFullText = newTitleObject.map(
        (obj) => obj.type === 'text' ? obj.text.content : '',
      ).join('');
    }

    console.log(
      'Updating \'tests\' database:\n',
      ...(newTitleFullText ? [` title: '${newTitleFullText}'\n`] : []),
      ` icon: ${pageIcon}`,
    );

    await notion.tests.editHeader({
      title: newTitleObject,
      icon: pageIcon,
    });

    const issuePageIcon: Icon = `layers_${(passCount === totalCount) ? 'green' : 'red'}`

    console.log(
      'Updating \'issues\' database:\n',
      ` icon: ${issuePageIcon}`,
    );

    await notion.issues.editHeader({ icon: issuePageIcon });
  };
};

export default available;
