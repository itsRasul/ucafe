import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { DataSource } from "typeorm";
import { MediaStorageService } from "./media/media-storage.service";

function redisCommand(parts: string[]) { return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`; }

async function pingRedis(rawUrl: string) {
  const url = new URL(rawUrl);
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  const commands: string[] = [];
  if (url.password) commands.push(redisCommand(url.username ? ["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)] : ["AUTH", decodeURIComponent(url.password)]));
  const database = url.pathname.replace(/^\//, "");
  if (database && database !== "0") commands.push(redisCommand(["SELECT", database]));
  commands.push(redisCommand(["PING"]));
  await new Promise<void>((resolve, reject) => {
    const socket = url.protocol === "rediss:" ? connectTls({ host: url.hostname, port, servername: url.hostname }) : connectTcp({ host: url.hostname, port });
    let response = "";
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setTimeout(2_000, () => fail(new Error("Redis readiness timed out")));
    socket.on("error", fail);
    socket.on("connect", () => socket.write(commands.join("")));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); if (response.includes("-")) fail(new Error("Redis readiness rejected")); else if (response.includes("+PONG\r\n")) { socket.end(); resolve(); } });
  });
}

@Controller("health")
export class HealthController {
  constructor(private readonly database: DataSource, private readonly config: ConfigService, private readonly media: MediaStorageService) {}

  @Get()
  check() { return { service: "api", status: "ok" } as const; }

  @Get("ready")
  async ready() {
    const checks = await Promise.allSettled([
      this.database.query("SELECT 1"),
      pingRedis(this.config.getOrThrow<string>("REDIS_URL")),
      this.media.readiness(),
    ]);
    if (checks.some((check) => check.status === "rejected")) throw new ServiceUnavailableException("Service dependencies are unavailable");
    return { service: "api", status: "ready", dependencies: { postgres: "ok", redis: "ok", objectStorage: "ok" } } as const;
  }
}
