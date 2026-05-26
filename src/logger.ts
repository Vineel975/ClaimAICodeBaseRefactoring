import { processingService } from "./processing-service";

type LogSink = (message: string) => void | Promise<void>;

let logSink: LogSink | null = null;

export const setLoggerSink = (sink: LogSink | null) => {
  logSink = sink;
};

const formatLogValue = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack ? `${value.message} | ${value.stack}` : value.message;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const logWith =
  (type: "log" | "info" | "warn" | "error") =>
  (...args: unknown[]) => {
    const message = args.map(formatLogValue).join(" ");
    processingService.addCustomLog(message);
    const sinkResult = logSink?.(message);
    if (sinkResult && typeof (sinkResult as Promise<void>).catch === "function") {
      void (sinkResult as Promise<void>).catch((error) => {
        console.error("Logger sink failed", error);
      });
    }
    console[type](...args);
  };

export const logger = {
  debug: logWith("log"),
  info: logWith("info"),
  warn: logWith("warn"),
  error: logWith("error"),
};
