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

      let i = 0;
      const max = 5;
      while (!error.stacks || !error.stacks.length) {
        console.log(`Waiting for stacks to be available, ${i}/${max}...`);
        i -= 1;

        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (i > max) {
          console.log('No stacks available for task:', task.name);
          stacks.push(errorInfo);
          break;
        }
      }

      for (const stack of error.stacks) {
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
