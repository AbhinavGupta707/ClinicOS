import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  normalizedRouteKey
} from "../packages/api-contracts/src/native-http-contracts.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function extractNativeRouterRoutes() {
  const serverPath = resolve(repositoryRoot, "apps/api/src/server.ts");
  const source = await readFile(serverPath, "utf8");
  const sourceFile = ts.createSourceFile(
    serverPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const dynamicPatterns = new Map();

  function collectDynamicPatterns(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer;
      if (
        ts.isCallExpression(initializer) &&
        ts.isPropertyAccessExpression(initializer.expression) &&
        initializer.expression.name.text === "match" &&
        initializer.arguments.length === 1
      ) {
        const argument = initializer.arguments[0];
        if (argument && argument.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          dynamicPatterns.set(node.name.text, normalizeRegexRoute(argument.getText(sourceFile)));
        }
      }
    }
    ts.forEachChild(node, collectDynamicPatterns);
  }
  collectDynamicPatterns(sourceFile);

  const routes = new Set();
  function walk(node, context = {}) {
    if (ts.isIfStatement(node)) {
      const method = methodFromCondition(node.expression) ?? context.method;
      const path = pathFromCondition(node.expression, dynamicPatterns) ?? context.path;
      if (method && path) routes.add(`${method} ${path}`);
      walk(node.thenStatement, { method, path });
      if (node.elseStatement) walk(node.elseStatement, context);
      return;
    }
    ts.forEachChild(node, (child) => walk(child, context));
  }
  walk(sourceFile);

  const nestApplicationPath = resolve(repositoryRoot, "apps/api/src/framework/nest-application.ts");
  const nestSource = await readOptionalSource(nestApplicationPath);
  if (nestSource !== null) {
    const nestSourceFile = ts.createSourceFile(
      nestApplicationPath,
      nestSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    collectNestDecoratorRoutes(nestSourceFile, routes);
  }

  return [...routes].sort();
}

export async function assertNativeRouterInventoryCoverage() {
  const actual = await extractNativeRouterRoutes();
  const contracted = ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation) =>
    normalizedRouteKey(operation.method, operation.path)
  ).sort();
  const actualSet = new Set(actual);
  const contractedSet = new Set(contracted);
  const missingContracts = actual.filter((route) => !contractedSet.has(route));
  const staleContracts = contracted.filter((route) => !actualSet.has(route));
  if (missingContracts.length > 0 || staleContracts.length > 0) {
    const details = [
      ...(missingContracts.length > 0
        ? [
            `Registered routes missing contracts:\n${missingContracts.map((route) => `  - ${route}`).join("\n")}`
          ]
        : []),
      ...(staleContracts.length > 0
        ? [
            `Contract routes absent from the router:\n${staleContracts.map((route) => `  - ${route}`).join("\n")}`
          ]
        : [])
    ];
    throw new Error(details.join("\n"));
  }
  return { actual, contracted };
}

function methodFromCondition(expression) {
  for (const candidate of flattenCondition(expression)) {
    if (
      !ts.isBinaryExpression(candidate) ||
      candidate.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    )
      continue;
    const [left, right] = [candidate.left, candidate.right];
    if (isMethodExpression(left) && ts.isStringLiteral(right)) return right.text;
    if (isMethodExpression(right) && ts.isStringLiteral(left)) return left.text;
  }
  return undefined;
}

function pathFromCondition(expression, dynamicPatterns) {
  for (const candidate of flattenCondition(expression)) {
    if (ts.isIdentifier(candidate) && dynamicPatterns.has(candidate.text)) {
      return dynamicPatterns.get(candidate.text);
    }
    if (
      !ts.isBinaryExpression(candidate) ||
      candidate.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    )
      continue;
    const [left, right] = [candidate.left, candidate.right];
    if (isPathExpression(left) && ts.isStringLiteral(right))
      return normalizeLiteralRoute(right.text);
    if (isPathExpression(right) && ts.isStringLiteral(left))
      return normalizeLiteralRoute(left.text);
  }
  return undefined;
}

function flattenCondition(expression) {
  if (ts.isParenthesizedExpression(expression)) return flattenCondition(expression.expression);
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...flattenCondition(expression.left), ...flattenCondition(expression.right)];
  }
  return [expression];
}

function isMethodExpression(node) {
  return ts.isPropertyAccessExpression(node) && node.name.text === "method";
}

function isPathExpression(node) {
  return (
    (ts.isIdentifier(node) && node.text === "pathname") ||
    (ts.isPropertyAccessExpression(node) && node.name.text === "url")
  );
}

function normalizeLiteralRoute(path) {
  return path.replace(/\{[^}]+\}/g, "{}");
}

function normalizeRegexRoute(literal) {
  const lastSlash = literal.lastIndexOf("/");
  let pattern = literal.slice(1, lastSlash);
  pattern = pattern.replace(/^\^/, "").replace(/\$$/, "");
  pattern = pattern.replace(/\\\//g, "/");
  pattern = pattern.replace(/\(\[\^\/\]\+\)/g, "{}");
  return pattern;
}

function collectNestDecoratorRoutes(sourceFile, routes) {
  const methods = new Map([
    ["Delete", "DELETE"],
    ["Get", "GET"],
    ["Patch", "PATCH"],
    ["Post", "POST"],
    ["Put", "PUT"]
  ]);

  function walk(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "decorateRoute" &&
      node.arguments.length >= 3
    ) {
      const decorator = node.arguments[2];
      if (decorator && ts.isCallExpression(decorator) && ts.isIdentifier(decorator.expression)) {
        const method = methods.get(decorator.expression.text);
        const path = decorator.arguments[0];
        if (method && path && ts.isStringLiteral(path)) {
          routes.add(`${method} ${normalizeLiteralRoute(`/${path.text.replace(/^\//u, "")}`)}`);
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
}

async function readOptionalSource(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await assertNativeRouterInventoryCoverage();
  process.stdout.write(
    `CP12 native route inventory matches ${result.actual.length} registered operations.\n`
  );
}
