import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Module({})
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log("Cafexa worker is ready", "Bootstrap");
}

void bootstrap();
