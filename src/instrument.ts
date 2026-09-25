import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://aa49ba11e560eabbd7cfd2826ea03389@o4512144445603840.ingest.us.sentry.io/4512144642277376',
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || 'production',
});
