import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const ext of CANDIDATES) {
        const candidate = `${base.href}${ext}`;
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
