const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ---- Ensure logs directory exists ----
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// ---- Console format (human readable, colored) ----
const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `${timestamp} [${level}]: ${message}\n${stack}`
      : `${timestamp} [${level}]: ${message}`;
  })
);

// ---- File format (structured JSON, easier to parse/search later) ----
const fileFormat = combine(timestamp(), errors({ stack: true }), json());

// ---- Base logger instance ----
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  defaultMeta: { service: 'avfinancehub-backend' },
  transports: [
    // Errors go to their own file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // Everything (info and above) goes to combined log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'rejections.log') }),
  ],
});

// ---- Also log to console when not in production ----
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// ---- Convenience helpers used across controllers/services ----
logger.logRequest = (req) => {
  logger.info(`${req.method} ${req.originalUrl} - IP: ${req.ip}`);
};

logger.logError = (err, context = '') => {
  logger.error(`${context ? `[${context}] ` : ''}${err.message}`, { stack: err.stack });
};

module.exports = logger;
