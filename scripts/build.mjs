import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const rootDir = process.cwd();
const srcDir = resolve(rootDir, 'src');
const distDir = resolve(rootDir, 'dist');

async function collectTsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteImportSpecifiers(source) {
  return source.replace(
    /((?:from|import)\s+['"])(\.[^'"]+)\.ts(['"])/g,
    (_, prefix, specifier, suffix) => `${prefix}${specifier}.js${suffix}`,
  );
}

async function build() {
  await mkdir(distDir, { recursive: true });

  const files = await collectTsFiles(srcDir);

  for (const filePath of files) {
    const relativePath = relative(srcDir, filePath);
    const outputPath = resolve(distDir, relativePath.replace(/\.ts$/, '.js'));
    const input = await readFile(filePath, 'utf8');
    const output = rewriteImportSpecifiers(
      stripTypeScriptTypes(input, {
        mode: 'transform',
        sourceUrl: filePath,
      }),
    );

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
