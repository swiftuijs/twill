import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { TransformOptions } from './compiler.js';

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      out: { type: 'string', short: 'o' },
      project: { type: 'string', short: 'p' },
      js: { type: 'boolean', default: false },
      runtime: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean', default: false },
      build: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const [command, input, ...extra] = positionals;
  if (values.runtime !== undefined) {
    if (!['inline', 'external'].includes(values.runtime))
      throw new Error('--runtime must be inline or external');
    if (command !== 'compile' && !values.help)
      throw new Error(
        '--runtime is only supported by twill compile; use twill.config.json for project commands',
      );
  }
  if (command === 'export') {
    // Resolve from the selected project, including under pnpm's isolated
    // dependency layout. Core does not depend on the optional export tool.
    let entry: string;
    try {
      entry = createRequire(resolve(values.project ?? 'package.json')).resolve(
        '@swiftuijs/twill-export/cli',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
      throw new Error(
        'twill export requires @swiftuijs/twill-export in your project. Install it with pnpm add -D @swiftuijs/twill-export.',
        { cause: error },
      );
    }
    const exporter = await import(pathToFileURL(entry).href);
    const index = tokens.find((token) => token.kind === 'positional')!.index;
    return exporter.main(args.filter((_, position) => position !== index));
  }
  if (values['dry-run']) throw new Error('--dry-run is only supported by twill export');
  if (values.help || !command) {
    console.log('twill <script> [arguments...]\ntwill run <script> [arguments...]');
    console.log(
      'twill compile <file> [-o output.ts] [--js] [--runtime inline|external]\ntwill check [-p tsconfig.json] [--json]\ntwill doctor [-p tsconfig.json] [--json]\ntwill declarations [-p tsconfig.json] [-o dist] [--build] [--json]\ntwill export [-p tsconfig.json] -o ../native-project [--dry-run] [--json]\n\ncompile keeps TypeScript types by default; --js erases types and lowers JSX.\nexport requires the optional @swiftuijs/twill-export package.\nCommands use the optional twill.config.json from the project root.',
    );
    return 0;
  }
  if (extra.length) throw new Error('Unexpected arguments: ' + extra.join(' '));
  if (command === 'declarations') {
    if (input) throw new Error('Use --project <tsconfig.json> with declarations');
    const { emitDeclarations } = await import('./declarations.js');
    const result = emitDeclarations(resolve(values.project ?? 'tsconfig.json'), {
      outDir: values.out,
      build: values.build,
    });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const diagnostic of result.diagnostics)
        console.error(
          `${diagnostic.filename ?? 'tsconfig'}:${diagnostic.line}:${diagnostic.column + 1} TS${diagnostic.code}: ${diagnostic.message}`,
        );
      if (!result.diagnostics.some((item) => item.category === 'error'))
        console.log(
          `Emitted ${result.files.length} declaration/map files from ${result.projects.length} projects.`,
        );
    }
    return result.diagnostics.some((item) => item.category === 'error') ? 1 : 0;
  }
  if (command === 'check' || command === 'doctor') {
    if (input) throw new Error('Use --project <tsconfig.json> with ' + command);
    const { TwillProject } = await import('./project.js');
    const project = new TwillProject(resolve(values.project ?? 'tsconfig.json'));
    try {
      if (command === 'doctor') {
        const { inspectProject } = await import('./doctor.js');
        const report = inspectProject(project);
        if (values.json) console.log(JSON.stringify(report, null, 2));
        else {
          console.log(
            `Twill ${report.twillVersion} / TypeScript ${report.typescriptVersion} / Node ${report.nodeVersion}`,
          );
          console.log(
            `Project: ${report.root}\nSources: ${report.files.twill} Twill, ${report.files.native} native\nDiagnostics: ${report.diagnostics.length} (${report.diagnosticTimeMs.toFixed(1)} ms)`,
          );
          for (const diagnostic of report.diagnostics)
            console.log(
              `${diagnostic.filename ?? 'tsconfig'}:${diagnostic.line}:${diagnostic.column + 1} TS${diagnostic.code}: ${diagnostic.message}`,
            );
          console.log('Use --json to save the complete project report.');
        }
        return report.ok ? 0 : 1;
      }
      const diagnostics = project.diagnostics();
      if (values.json) console.log(JSON.stringify(diagnostics, null, 2));
      else
        for (const diagnostic of diagnostics)
          console.error(
            `${diagnostic.filename ?? 'tsconfig'}:${diagnostic.line}:${diagnostic.column + 1} TS${diagnostic.code}: ${diagnostic.message}`,
          );
      return diagnostics.some((diagnostic) => diagnostic.category === 'error') ? 1 : 0;
    } finally {
      project.dispose();
    }
  }
  if (command !== 'compile' || !input)
    throw new Error('Expected compile <file> or check. Use --help for usage.');
  const filename = resolve(input);
  const root = values.project ? dirname(resolve(values.project)) : process.cwd();
  const { loadConfig } = await import('./config.js');
  const options = {
    ...loadConfig(root, values.project ? resolve(values.project) : undefined),
    filename,
    ...(values.runtime === undefined
      ? {}
      : { runtime: values.runtime as TransformOptions['runtime'] }),
  };
  const source = readFileSync(filename, 'utf8');
  const result = values.js
    ? (await import('./transpile.js')).transpile(source, options)
    : (await import('./compiler.js')).transform(source, options);
  if (values.out) {
    const output = resolve(values.out);
    if (output === filename) throw new Error('Output must differ from input');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      result.code + `\n//# sourceMappingURL=${output.split(/[\\/]/).at(-1)}.map\n`,
    );
    const map = JSON.parse(result.map.toString());
    map.file = output.split(/[\\/]/).at(-1);
    writeFileSync(output + '.map', JSON.stringify(map));
  } else process.stdout.write(result.code + '\n');
  return 0;
}
