import { Client } from '@notionhq/client';
import env from '../config';
import { generateCodeSnippet, type Stack } from '../vitest/agent';
import type { File, Task } from 'vitest';
import type { CreatePageParameters, UpdatePageParameters } from '@notionhq/client/build/src/api-endpoints';

interface LangTexts {
  tests: {
    name: string;
    tag: string;
    fileName: string;
    status: string;
    project: string;
    archived: string;
  };
  issues: {
    name: string;
    test: string;
    status: string;
  };
  texts: {
    automaticTests: string;
  };
}

const i8nLangs = {
  EN: {
    tests: {
      name: 'Name',
      fileName: 'File',
      tag: 'Tag',
      status: 'Status',
      project: 'Project',
      archived: 'Archived',
    },
    issues: {
      name: 'Message',
      test: 'Associated test',
      status: 'Test status',
    },
    texts: {
      automaticTests: 'Automatic tests',
    },
  } as LangTexts,
  FR: {
    tests: {
      name: 'Nom',
      fileName: 'Fichier',
      tag: 'Tag',
      status: 'État',
      project: 'Projet',
      archived: 'Archivé',
    },
    issues: {
      name: 'Message',
      test: 'Test associé',
      status: 'État du test',
    },
    texts: {
      automaticTests: 'Tests automatiques',
    },
  } as LangTexts,
} as const;

type Language = keyof typeof i8nLangs;
type TextType = keyof LangTexts;

const config = {
  namespace: env('VITEST_NAMESPACE'),
  notionKey: env('NOTION_KEY'),
  notionTestsDB: env('NOTION_TESTS_DB'),
  notionIssuesDB: env('NOTION_ISSUES_DB'),
  notionLanguage: 'EN' as Language,
};

export const available = (
  !!config.notionKey
  && !!config.notionTestsDB
  && !!config.notionIssuesDB
  && !!config.namespace
);

const client = new Client({
  auth: config.notionKey,
});

type IconName = (
  | 'question-mark'
  | 'checkmark'
  | 'clear'
  | 'code'
  | 'playback-pause'
  | 'playback-play'
  | 'checklist'
  | 'list'
  | 'layers'
);

type IconColor = (
  | 'green'
  | 'blue'
  | 'yellow'
  | 'red'
  | 'pink'
  | 'gray'
);

type Icon = `${IconName}_${IconColor}`;
type IconUrl = `https://www.notion.so/icons/${Icon}.svg`;

const getIconUrl = (icon: Icon): IconUrl => `https://www.notion.so/icons/${icon}.svg`;

type TestStatus = 'PASS' | 'FAIL' | 'SKIP' | 'TODO' | 'ONLY' | 'RUN' | 'UNKNOWN';

const statusIconsUrls: { [status in TestStatus]: IconUrl } = {
  PASS: getIconUrl('checkmark_green'),
  FAIL: getIconUrl('clear_red'),
  SKIP: getIconUrl('playback-pause_blue'),
  TODO: getIconUrl('code_pink'),
  ONLY: getIconUrl('checkmark_blue'),
  RUN: getIconUrl('playback-play_gray'),
  UNKNOWN: getIconUrl('question-mark_yellow'),
} as const;

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
}

const getTemplateLanguage = (properties: { [type in TextType]?: string[] }): Language => {
  const missingColumns: {
    [lang in Language]: [TextType, string][];
  } = {} as any;

  for (const _lang in i8nLangs) {
    const lang = _lang as Language;
    missingColumns[lang] = [];
    for (const _type in properties) {
      const type = _type as TextType;
      missingColumns[lang].push(...(Object
        .values(i8nLangs[lang][type])
        .filter((column) => !properties[type]?.includes(column))
        .map((column) => [type, column] as [TextType, string])
      ));
    }
    if (missingColumns[lang]?.length === 0) return lang;
  }

  const nearestLang = Object.keys(missingColumns).reduce((_prev, _curr) => {
    if (!_prev) return _curr;
    const curr = _curr as Language;
    const prev = _prev as Language;
    if (missingColumns[curr]?.length < missingColumns[prev]?.length) return curr;
    return prev;
  }, '' as Language) as Language;

  console.log('Detected language:', nearestLang.toUpperCase());

  console.error(
    'Missing column(s):\n',
    ...missingColumns[nearestLang].map(([type, column]) =>
      `- the '${type}' database needs a column named '${column}'\n`,
    ),
    '\nThis Notion database is not supported, please use the default template.\n',
  );
  process.exit(1);
}

export async function setupNotionDatabases() {
  if (!available) throw new Error('Notion is not available');

  console.log('Getting \'tests\' database...');
  const testsDB = await client.databases.retrieve({
    database_id: config.notionTestsDB as string,
  });

  console.log('Getting \'issues\' database...');
  const issuesDB = await client.databases.retrieve({
    database_id: config.notionIssuesDB as string,
  });

  config.notionLanguage = getTemplateLanguage({
    tests: Object.keys(testsDB.properties),
    issues: Object.keys(issuesDB.properties),
  });
  
  console.log(`Using language '${config.notionLanguage}'`);

  const i8n = i8nLangs[config.notionLanguage];
  const testProperty = issuesDB.properties[i8n.issues.test];

  if (
    testProperty.type !== 'relation'
    || testProperty.relation?.database_id.replace(/-/g, '') !== config.notionTestsDB
  ) {
    console.log(`Setting '${i8n.issues.test}' property as a relation...`);
    await client.databases.update({
      database_id: config.notionIssuesDB as string,
      properties: {
        [i8n.issues.test]: {
          relation: {
            database_id: config.notionTestsDB as string,
            type: 'single_property',
            single_property: {},
          },
        },
      },
    });
  }

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

  const i8n = i8nLangs[config.notionLanguage];
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

  const { results: testPages } = await client.databases.query({
    database_id: config.notionTestsDB as string,
    // filter by namespace
    filter: {
      property: i8n.tests.project,
      select: {
        equals: config.namespace as string,
      },
    },
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
    const params: CreatePageParameters | UpdatePageParameters = {
      parent: {
        database_id: config.notionTestsDB as string,
      },
      properties: {
        [i8n.tests.name]: { title: [{ text: { content: test.title } }] },
        [i8n.tests.tag]: { select: { name: test.tag } },
        [i8n.tests.fileName]: { select: { name: test.fileName } },
        [i8n.tests.status]: { status: { name: test.status } },
        [i8n.tests.project]: { select: { name: config.namespace as string } },
        [i8n.tests.archived]: { checkbox: false },
      },
      icon: {
        type: 'external',
        external: { url: statusIconsUrls[test.status] ?? statusIconsUrls.UNKNOWN },
      },
    };

    let pages = testPages.filter((page) =>
      (page as any).properties?.[i8n.tests.name]?.title?.[0]?.plain_text === test.title,
    );

    // Filter by tag if multiple pages with the same name exist
    if (pages.length > 1) {
      pages = pages.filter((page) =>
        (page as any).properties?.[i8n.tests.tag]?.select?.name === test.tag,
      );
    }

    // Filter by file name if multiple pages with the same name and tag exist
    if (pages.length > 1) {
      pages = pages.filter((page) =>
        (page as any).properties?.[i8n.tests.fileName]?.select?.name === test.fileName,
      );
    }

    // Show an error if multiple pages with the same name, tag and file name exist
    if (pages.length > 1) {
      console.error(`The '${test.filePath}' file has multiple (${pages.length}) tests with the same name '${test.title}'`);
      console.error('please check this file for duplicates and remove them');
    }

    const page = pages.filter((page) => !updated.has(page.id))[0];

    // If page exists, update it
    // else, create it
    if (page && page.id) {
      updated.add(page.id);

      if (!needUpdate(page, { properties: params.properties })) {
        stats.kept += 1;
        continue;
      }

      console.log(`Updating page '${test.title}'`);
      await client.pages.update({
        ...params,
        page_id: page.id,
      });

      const url = (page as { url: string }).url;
      stats.updated.push(url);

      changes[test.id] = {
        id: test.id,
        path: test.path,
        status: test.status,
        pageId: page.id,
        pageUrl: (page as { url: string }).url,
      };
    } else {
      console.log(`Creating page '${test.title}'`);
      const page = await client.pages.create({
        ...params,
        parent: {
          database_id: config.notionTestsDB as string,
        },
      });

      updated.add(page.id);

      const url = (page as { url: string }).url;
      stats.created.push(url);
    }
  }

  // Archive old pages
  for (const page of testPages) {
    if (
      !page.id
      || updated.has(page.id)
      || (page as any).properties?.[i8n.tests.archived]?.checkbox
    ) continue;

    console.log(`Archiving page '${(page as any).properties?.[i8n.tests.name]?.title?.[0]?.plain_text}'`);

    await client.pages.update({
      page_id: page.id,
      properties: {
        [i8n.tests.archived]: { checkbox: true },
      },
    });

    const url = (page as { url: string }).url;
    stats.archived.push(url);
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

  const i8n = i8nLangs[config.notionLanguage];
  const pagesUrls: PagesUrls = {};

  const newStacks = stacks.filter((stack) => changes[stack.id])

  for (const stack of Object.values(newStacks)) {
    const stackName = `${stack.error.name}: ${stack.error.message}`;

    console.log(
      'Creating issue page\n',
      ` for stack: '${stackName}'\n`,
      ` for test page: ${changes[stack.id].pageUrl}`,
    );

    const newPage = await client.pages.create({
      parent: {
        database_id: config.notionIssuesDB as string,
      },
      properties: {
        [i8n.issues.name]: { title: [
          {
            text: {
              content: stackName,
            },
            annotations: {
              bold: true,
              strikethrough: true,
              color: 'red',
            },
          }
        ] },
        [i8n.issues.test]: { relation: [{
          id: changes[stack.id].pageId,
        }] },
      },
      children: [
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
                  `[FAIL] ${stack.path.map((p) => `${p}`).join('\n  > ')}`,
                  '',
                  `${stack.error.name}: ${stack.error.message}`,
                  `  ❯ ${stack.file.name}:${stack.line}:${stack.column}`,
                  '',
                  generateCodeSnippet({
                    filepath: stack.file.path,
                    line: stack.line,
                    column: stack.column,
                    markdownMode: false,
                    contextSize: 10,
                  }),
                  '',
                  stack.error.diff?.replace(/\x1B\[\d+m/g, '') ?? null,
                ].join('\n'),
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

    console.log(` => ${(newPage as { url: string }).url}`);

    pagesUrls[stack.id] = {
      id: newPage.id,
      url: (newPage as { url: string }).url,
    };
  }

  return pagesUrls;
};

export async function updateNotionDatabases() {
  if (!available) throw new Error('Notion is not available');

  const i8n = i8nLangs[config.notionLanguage];

  // Update 'tests' database title and icon
  {
    console.log('Getting \'tests\' database...');
    const { results: testPages } = await client.databases.query({
      database_id: config.notionTestsDB as string,
      filter: {
        property: i8n.tests.archived,
        checkbox: {
          equals: false,
        },
      },
    });

    const statuses = testPages.map((page) => (page as any).properties?.[i8n.tests.status]?.status?.name);
    const passCount = statuses.filter((status) => status === 'PASS').length;
    const failCount = statuses.filter((status) => status === 'FAIL').length;
    const totalCount = passCount + failCount;

    const pageIcon: Icon = (failCount === 0) ? 'checklist_green' : 'list_red';
    const newTitle = `${i8n.texts.automaticTests}: ${passCount}/${totalCount}`;

    console.log(
      'Updating \'tests\' database:\n',
      ` title: '${newTitle}'\n`,
      ` icon: ${pageIcon}`,
    );

    await client.databases.update({
      database_id: config.notionTestsDB as string,
      title: [{
        type: 'text',
        text: { content: newTitle },
      }],
      icon: {
        type: 'external',
        external: { url: getIconUrl(pageIcon) },
      },
    });

    const issuePageIcon: Icon = (failCount === 0) ? 'layers_green' : 'layers_red';

    console.log(
      'Updating \'issues\' database:\n',
      ` icon: ${issuePageIcon}`,
    );

    await client.databases.update({
      database_id: config.notionIssuesDB as string,
      icon: {
        type: 'external',
        external: { url: getIconUrl(issuePageIcon) },
      },
    });
  };
};

export default available;
