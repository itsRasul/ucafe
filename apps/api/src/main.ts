import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { requestObservability } from "./observability/request-observability.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const trustProxyHops = config.get<number>("TRUST_PROXY_HOPS", 0);
  if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set("trust proxy", trustProxyHops);
  app.use(requestObservability);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3001), "0.0.0.0");
}

void bootstrap();
