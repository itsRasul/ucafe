import Joi from "joi";

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  API_PORT: Joi.number().port().default(3001),
  DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ["redis", "rediss"] }).required(),
  PLATFORM_BASE_DOMAIN: Joi.string().pattern(/^[a-z0-9.-]+$/).required(),
  ACCESS_TOKEN_SECRET: Joi.string().min(32).required(),
  AUTH_PEPPER: Joi.string().min(32).required(),
  PII_ENCRYPTION_KEY: Joi.string().custom((value: string, helpers) => {
    try {
      if (Buffer.from(value, "base64").length !== 32) return helpers.error("any.invalid");
      return value;
    } catch {
      return helpers.error("any.invalid");
    }
  }).required(),
  ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),
  OTP_TTL_SECONDS: Joi.number().integer().min(60).max(600).default(120),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(30).max(300).default(60),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(3).max(10).default(5),
  OTP_PHONE_HOURLY_LIMIT: Joi.number().integer().min(1).max(20).default(5),
  OTP_IP_HOURLY_LIMIT: Joi.number().integer().min(5).max(100).default(20),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),
  INTERNAL_PROXY_SECRET: Joi.string().min(32).required(),
  S3_ENDPOINT: Joi.string().uri({ scheme: ["http", "https"] }).required(),
  S3_REGION: Joi.string().min(1).required(),
  S3_BUCKET: Joi.string().pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).required(),
  S3_ACCESS_KEY: Joi.string().min(3).required(),
  S3_SECRET_KEY: Joi.string().min(8).required(),
  SMS_PROVIDER: Joi.string().valid("development", "kavenegar").default("development"),
  KAVENEGAR_API_KEY: Joi.when("SMS_PROVIDER", { is: "kavenegar", then: Joi.string().min(8).required(), otherwise: Joi.string().optional() }),
  KAVENEGAR_OTP_TEMPLATE: Joi.when("SMS_PROVIDER", { is: "kavenegar", then: Joi.string().pattern(/^[A-Za-z0-9_-]+$/).required(), otherwise: Joi.string().default("cafexa-otp") }),
  KAVENEGAR_RESERVATION_CONFIRMED_TEMPLATE: Joi.when("SMS_PROVIDER", { is: "kavenegar", then: Joi.string().pattern(/^[A-Za-z0-9_-]+$/).required(), otherwise: Joi.string().default("cafexa-reservation-confirmed") }),
  PAYMENT_PROVIDER: Joi.string().valid("simulated", "zarinpal").default("simulated"),
  PAYMENT_CALLBACK_BASE_URL: Joi.string().uri({scheme:["http","https"]}).required(),
  ZARINPAL_MERCHANT_ID: Joi.when("PAYMENT_PROVIDER", { is:"zarinpal", then:Joi.string().guid().required(), otherwise:Joi.string().allow("").optional() }),
}).unknown(true).custom((environment, helpers) => {
  if (environment.NODE_ENV !== "production") return environment;
  if (environment.SMS_PROVIDER !== "kavenegar") return helpers.error("any.custom", { message: "Production requires SMS_PROVIDER=kavenegar" });
  if (environment.PAYMENT_PROVIDER !== "zarinpal") return helpers.error("any.custom", { message: "Production requires PAYMENT_PROVIDER=zarinpal" });
  if (!String(environment.PAYMENT_CALLBACK_BASE_URL).startsWith("https://")) return helpers.error("any.custom", { message: "Production payment callback must use HTTPS" });
  return environment;
});
