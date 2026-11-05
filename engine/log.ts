import pino, { type LoggerOptions } from "pino";

const REDACT: LoggerOptions["redact"] = {
  paths: [
    "privateKey",
    "password",
    "secret",
    "ciphertext",
    "authorization",
    "secretKey",
    "*.privateKey",
    "*.password",
    "*.secret",
    "*.ciphertext",
    "*.secretKey",
    "req.headers.authorization",
    "req.headers.cookie",
  ],
  censor: "[redacted]",
};

export function createLogger(level = process.env.LOG_LEVEL ?? "info", destination?: pino.DestinationStream) {
  return pino({ level, redact: REDACT, base: { service: "meridian" } }, destination);
}

export const logger = createLogger();
