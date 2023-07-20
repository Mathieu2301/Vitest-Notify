import fs from 'fs';
import type { File, Task } from 'vitest';

export function generateCodeSnippet({
  filepath,
  line,
  column = 0,
  markdownMode,
  contextSize = 3,
}: {
  filepath: string;
  line: number;
  column?: number;
  markdownMode: boolean;
  contextSize?: number;
}) {
  const code = fs.readFileSync(filepath, 'utf-8');
  const lines = code.split('\n');

  const start = Math.max(0, line - contextSize);
  const end = Math.min(lines.length, line + contextSize);

  const snippet = lines.slice(start, end).map((l, i) => {
    const lineNumber = start + i + 1;
    const lineText = `${lineNumber} | ${l}`;
    const pointer = (lineNumber === line
      ? `\n${' '.repeat(column + 5)}^`
      : ''
    );

    return `  ${lineText}${pointer}`;
  }).join('\n');

  return markdownMode ? `\`\`\`js\n${snippet}\n\`\`\`` : snippet;
}

export interface Stack {
  /** Task ID */
  id: string;
  file: {
    id: string;
    name: string;
    path: string;
  };
  line?: number;
  column?: number;
  path: string[];
  error: {
    name: string;
    message: string;
    diff?: string;
  };
}

function findEquivalentStack(obj: any) {
  const isStackObject = (testObj: any) => {
    const keys = Object.keys(testObj);
    return ['column', 'line', 'file'].every((key) => keys.includes(key));
  };

  const seenPaths = new Set();

  const recurse = (obj: any): any => {
    if (isStackObject(obj)) return obj;

    for (const v of Object.values(obj)) {
      if (typeof v !== 'object') continue;
      if (seenPaths.has(v)) continue;
      seenPaths.add(v);
      const result = recurse(v);
      if (result) return result;
    }
  }

  return recurse(obj);
}

let stackWaitI = 0;

export async function getStacks(files: File[]): Promise<Stack[]> {
  const stacks: Stack[] = [];

  const tasks: {
    task: Task;
    path: string[];
  }[] = [];

  for (const file of files ?? []) {
    if (file.result?.state !== 'fail') continue;
    for (const task of file.tasks) tasks.push({ task, path: [file.name, task.name] });
  }

  while (tasks.length > 0) {
    const { task, path } = tasks.shift() as typeof tasks[0];
    const subtasks = (task as { tasks: Task[] }).tasks;

    if (subtasks) {
      for (const subtask of subtasks) {
        tasks.push({ task: subtask, path: [...path, subtask.name] });
      }
      continue;
    }

    for (const error of task.result?.errors ?? []) {
      const errorInfo = {
        id: task.id,
        file: {
          id: task.file?.id ?? '',
          name: task.file?.name ?? '',
          path: task.file?.filepath ?? '',
        },
        path,
        error: {
          name: error.name,
          message: error.message,
          diff: error.diff,
        },
      };

      const max = 5;
      while ((!error.stacks || !error.stacks.length) && stackWaitI <= max) {
        if (stackWaitI >= max) {
          console.log('No stacks available for task:\n  ', errorInfo.path.join(' > '));

          console.log('  Finding equivalent stack...');
          const equivalentStack = findEquivalentStack(task);

          if (!equivalentStack) {
            console.warn('  No equivalent stack found.');
            stacks.push(errorInfo);
            break;
          }

          console.log(
            '  Equivalent stack found:',
            `${equivalentStack.file}:${equivalentStack.line}:${equivalentStack.column}`,
          );

          stacks.push({
            ...errorInfo,
            line: equivalentStack.line,
            column: equivalentStack.column,
          });

          break;
        }

        console.log(`Waiting for stacks to be available, ${stackWaitI}/${max}...`);
        stackWaitI += 1;

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      for (const stack of error.stacks ?? []) {
        stacks.push({
          ...errorInfo,
          line: stack.line,
          column: stack.column,
        });
      }
    }
  }

  return stacks;
}
