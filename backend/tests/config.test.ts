import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config/config.js";

const local = {
  DATABASE_PROFILE: "local",
  DB_LOCAL_HOST: "127.0.0.1",
  DB_LOCAL_PORT: "5433",
  DB_LOCAL_NAME: "wealthos",
  DB_LOCAL_USER: "wealthos_app",
  DB_LOCAL_PASSWORD: "secret",
};

describe("local-only configuration", () => {
  it("uses explicit local settings", () => {
    const cfg = loadConfig({ ...local, PORT: "8787", HOST: "127.0.0.1" });
    expect(cfg.database).toMatchObject({ host: "127.0.0.1", port: 5433, name: "wealthos" });
    expect(cfg.server.port).toBe(8787);
  });

  it("has local development defaults and no TLS or cloud branch", () => {
    const cfg = loadConfig({});
    expect(cfg.database).toMatchObject({ profile: "local", host: "127.0.0.1", port: 5433, name: "wealthos" });
    expect("ssl" in cfg.database).toBe(false);
    expect(cfg.server.host).toBe("127.0.0.1");
  });

  it("does not read ambient environment into an explicit test configuration", () => {
    process.env.DB_LOCAL_NAME = "wealthos";
    const cfg = loadConfig({ DB_LOCAL_HOST: "127.0.0.1", DB_LOCAL_PORT: "5433", DB_LOCAL_NAME: "wealthos_test" });
    expect(cfg.database.name).toBe("wealthos_test");
    delete process.env.DB_LOCAL_NAME;
  });

  it("rejects unknown profiles and non-loopback hosts", () => {
    expect(() => loadConfig({ DATABASE_PROFILE: "remote" })).toThrow(/DATABASE_PROFILE/);
    expect(() => loadConfig({ DB_LOCAL_HOST: "db.example.com" })).toThrow(/loopback/);
  });

  it("does not allow an empty local password", () => {
    expect(() => loadConfig({ ...local, DB_LOCAL_PASSWORD: "" })).toThrow(/DB_LOCAL_PASSWORD/);
  });

  it("rejects invalid database ports", () => {
    expect(() => loadConfig({ DB_LOCAL_PORT: "not-a-port" })).toThrow(/DB_LOCAL_PORT/);
  });
});
