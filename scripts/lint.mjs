import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const rootDir = process.cwd();
const srcDir = resolve(rootDir, 'src');

async function collectTsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === '.ts') {
      files.push(fullPath);
    }
  }

  return files;
}

async function lint() {
  const files = await collectTsFiles(srcDir);
  let hasFailure = false;

  for (const filePath of files) {
    const input = await readFile(filePath, 'utf8');

    try {
      stripTypeScriptTypes(input, {
        mode: 'transform',
        sourceUrl: filePath,
      });
    } catch (error) {
      console.error(`[lint] ${filePath}`);
      console.error(error);
      hasFailure = true;
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
    return;
  }

  console.log(`lint ok: ${files.length} files`);
}

lint().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
