import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { TenantsService } from "../tenants/tenants.service";

async function run() {
  const [name, slug] = process.argv.slice(2);
  if (!name || !slug) throw new Error('Usage: npm run tenant:provision --workspace=@cafexa/api -- "Cafe name" "cafe-slug"');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const result = await app.get(TenantsService).provision({ name, slug });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void run();
