import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

export function loadModule(url, globals, exports) {
  const code = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [() => file => ts.factory.updateSourceFile(file,
      file.statements.filter(s => !ts.isImportDeclaration(s) && !ts.isExportDeclaration(s)),
    )] },
  }).outputText.replace(/^export /gm, "");
  const context = createContext(globals);
  runInContext(code + "\nglobalThis.result = (" + exports + ");", context);
  return context.result;
}
