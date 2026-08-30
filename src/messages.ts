import path from "node:path";

export const REPO_ROOT_REQUIRED =
  "repoRoot is required. Pass the open project path. Do not use the ctx engine directory.";

export const NOT_ENABLED =
  "ctx is off in this repo. Run `ctx on` in that project first. Do not call ctx.";

export const ENGINE_OFF =
  "Engine is off. In the ctx clone run: npm install && npm run build && npm start";

export function notConnected(repoRoot: string): string {
  return `This path is not connected. In the ctx clone run: node dist/cli.js connect "${path.resolve(repoRoot)}"`;
}

export const PATH_MISSING = (repoRoot: string) =>
  `Path does not exist: ${path.resolve(repoRoot)}`;
