/* Let `node` run the app's TypeScript directly.

   Node strips types on its own, but it will not guess file extensions the
   way a bundler does, so `import { db } from '../db'` fails on a directory.
   This hook fills that one gap — extensionless and directory imports resolve
   to `.ts` and `/index.ts` — which is enough to run the source under plain
   Node with no build step and no toolchain dependency.

   Deliberately dependency-free: a test runner that needs a native binary
   installed per platform is a test runner that breaks when the project moves
   between machines. */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HAS_EXTENSION = /\.(m?[jt]s|json|node)$/;

export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !HAS_EXTENSION.test(specifier) && context.parentURL) {
    const target = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${target}.ts`, `${target}/index.ts`]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
