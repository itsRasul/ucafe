import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PlatformBootstrapService } from "../authorization/platform-bootstrap.service";

async function run() {
  const [phone] = process.argv.slice(2);
  if (!phone) throw new Error('Usage: npm run platform:bootstrap --workspace=@cafexa/api -- "09121234567"');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    console.log(JSON.stringify(await app.get(PlatformBootstrapService).claimFirstOwner(phone), null, 2));
  } finally {
    await app.close();
  }
}

void run();
