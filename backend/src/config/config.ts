import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DatabaseConfig {
  profile: "local";
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  migrationUser?: string;
  migrationPassword?: string;
}

export interface ServerConfig { host: string; port: number; logLevel: string }
export interface AppConfig { database: DatabaseConfig; server: ServerConfig }
type Env = Record<string, string | undefined>;

/** .env is local-only and never overrides the process environment. */
function loadDotEnv(root: string): Env {
  const merged: Env = {};
  try {
    for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) merged[m[1] as string] = m[2]!.replace(/^["']|["']$/g, "");
    }
  } catch { /* .env is optional */ }
  return { ...merged, ...cleanEnv(process.env) };
}

function cleanEnv(env: NodeJS.ProcessEnv): Env {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

function required(env: Env, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing required config: ${key}`);
  return value;
}

function validHost(host: string): string {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("DB_LOCAL_HOST must be a loopback address; use an SSH tunnel for a remote server");
  }
  return host;
}

export function loadConfig(envInput?: Env, root?: string): AppConfig {
  const env = envInput ?? loadDotEnv(root ?? process.cwd());
  const profile = env.DATABASE_PROFILE ?? "local";
  if (profile !== "local") throw new Error("DATABASE_PROFILE must be local");
  const port = Number(required(env, "DB_LOCAL_PORT", "5433"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_LOCAL_PORT must be a valid TCP port");
  const serverPort = Number(env.PORT ?? "8787");
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new Error("PORT must be a valid TCP port");
  return {
    database: {
      profile: "local",
      host: validHost(required(env, "DB_LOCAL_HOST", "127.0.0.1")),
      port,
      name: required(env, "DB_LOCAL_NAME", "wealthos"),
      user: required(env, "DB_LOCAL_USER", "wealthos_app"),
      password: required(env, "DB_LOCAL_PASSWORD", "wealthos_local_dev"),
      ...(env.DB_MIGRATION_USER ? { migrationUser: env.DB_MIGRATION_USER } : {}),
      ...(env.DB_MIGRATION_PASSWORD ? { migrationPassword: env.DB_MIGRATION_PASSWORD } : {}),
    },
    server: { host: env.HOST ?? "127.0.0.1", port: serverPort, logLevel: env.LOG_LEVEL ?? "info" },
  };
}
