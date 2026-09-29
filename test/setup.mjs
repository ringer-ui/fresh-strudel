// Some deps ship a "main" that Node can't load under test (browser-only IIFE, or a
// file that doesn't exist). Route them to whichever build actually exists.
// registerHooks is synchronous, so it also covers require() inside those packages.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dist = (pkg, name) => path.resolve('node_modules', pkg, 'dist', name);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@kabelsalat/web' || specifier.startsWith('@tonaljs/')) {
      if (context.conditions?.includes('require')) {
        // require() wants a path
        const cjs = ['index.js', 'index.cjs'].map((f) => dist(specifier, f)).find(existsSync);
        if (cjs) return next(cjs, context);
      } else {
        return next(pathToFileURL(dist(specifier, 'index.mjs')).href, context);
      }
    }
    return next(specifier, context);
  },
});
