import { parse, UrlWithStringQuery } from 'url';
import next from "next";
import http from "http";
import express, { Express, Request, Response, NextFunction } from "express";
import requestIDMiddleware from './middlewares/request_id';
// import Login from '../pages/login/login';
import appOpenAIRouter from '../app/api/openai/[...path]/route';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import compression from 'compression';
import userAgent from 'express-useragent';
import morgan from 'morgan';
import session from 'express-session';
import RedisStore from 'connect-redis';
import promBundle from 'express-prom-bundle';
import { collectDefaultMetrics, register } from 'prom-client';
import responseTime from 'response-time';
import xprofiler from 'xprofiler';
import xtransit from 'xtransit'
import packageJson from '../package.json';
import RedisFacade from './redis/redis_facade';

const { name: appName } = packageJson;
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, quiet: false });

export const start = async (): Promise<void> => {
  // next.js (10.x) executes next.config.js when prepare() Therefore,
  // everything that depends on server/config should be executed after this sentence.
  await nextApp.prepare();

  //
  // ---------- API server ----------
  //
  console.info(`Starting ${appName} API Server ...`);

  const app: Express = express();
  const port: number = parseInt(process.env.PORT ? process.env.PORT : "3000", 10);
  const hostname: string = process.env.HOSTNAME || "localhost";
  const backlog: number = parseInt(process.env.BACKLOG ? process.env.BACKLOG : "512", 10);
  const responseTimeout: number = parseInt(process.env.RESPONSE_TIMEOUT ? process.env.RESPONSE_TIMEOUT : "10000", 10);

  app.use(requestIDMiddleware);
  app.use(responseTime());
  app.use(userAgent.express());
  app.use(cookieParser());
  app.use(compression());
  app.use(bodyParser.json({ limit: process.env.BODY_SIZE_LIMIT || '10mb' }));
  app.use(bodyParser.urlencoded({ extended: false }));
  // http request logger. (add tenant,user,trace etc meta fields)
  app.use(morgan((tokens: any, req: express.Request, res: express.Response) => {
    const logRecord = {
      time: tokens.date(req, res, 'iso'),
      service: appName,
      tenantId: "",
      userId: "",
      requestId: "",
      cost: parseFloat(tokens['response-time'](req, res)),
      path: tokens.url(req, res),
      method: tokens.method(req, res),
      status: tokens.status(req, res),
    };
    const { user } = req.session ? req.session : {} as any;
    if (user && user.user) {
      logRecord.tenantId = user.activeCompany?.id;
      logRecord.userId = user.user?.id;
    }
    const requestId = req.get('x-request-id');
    if (requestId) {
      logRecord.requestId = requestId;
    }
    return JSON.stringify(logRecord);
  }, {
    skip: (req: Request) => req.path.indexOf('_next') > 0,
  }));
  const sessionOptions: session.SessionOptions = {
    secret: process.env.SESSION_SECRET ? process.env.SESSION_SECRET : 'changeme',
    // The default value for resave is true, but it may create race conditions
    // where a client makes two parallel requests to your server and changes
    // made to the session in one request may get overwritten when the other
    // request ends, even if it made no changes
    resave: false,
    rolling: true,
    saveUninitialized: false,
    unset: 'destroy',
    store: new RedisStore({
      client: RedisFacade.getDefault().getRedisClient(),
      prefix: process.env.SESSION_PREFIX ? process.env.SESSION_PREFIX : (appName + ':'),
      ttl: process.env.SESSION_TTL ? parseInt(process.env.SESSION_TTL, 10) : 86400,
      scanCount: process.env.SESSION_SCAN_COUNT ? parseInt(process.env.SESSION_SCAN_COUNT, 10) : 100,
    }),
  };
  // The session middleware is placed at the front, because req.session is to be obtained.
  app.use(session(sessionOptions));
  // app.get('/login', Login);
  app.use(appOpenAIRouter);
  // Finally next.js takes over.
  app.get('*', (req: Request, res: Response) => {
    const handle = nextApp.getRequestHandler();
    handle(req, res);
  });

  const server = http.createServer(app);
  server.setTimeout(responseTimeout);
  await server.listen(port, hostname, backlog);
  console.info(`> Ready ${appName} API Server on http://localhost:${port}`);

  //
  // ---------- MGMT server ----------
  //
  console.info(`Starting ${appName} MGMT Server ...`);
  const mgmtApp: Express = express();
  const mgmtPort: number = parseInt(process.env.MGMT_PORT ? process.env.MGMT_PORT : "11700", 10);
  const mgmtHostname: string = process.env.MGMT_HOSTNAME || "localhost";
  const mgmtBacklog: number = parseInt(process.env.MGMT_BACKLOG ? process.env.MGMT_BACKLOG : "512", 10);
  const mgmtResponseTimeout: number = parseInt(process.env.MGMT_RESPONSE_TIMEOUT ? process.env.MGMT_RESPONSE_TIMEOUT : "10000", 10);

  // use healthz handler.
  mgmtApp.get('/healthz', (req: Request, res: Response) => res.json({})); // TODO: add health check

  // use prometheus metrics handler.
  collectDefaultMetrics({
    labels: { app: process.env.APP_SRV_NAME || appName, type: 'nodejs' },
    prefix: '',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  });
  const metricsMiddleware = promBundle({
    includeStatusCode: true,
    includePath: false,
    includeMethod: true,
    includeUp: true,
    buckets: [30, 50, 100, 200, 300, 500, 800, 1000, 2000, 3000, 5000],
  });
  mgmtApp.use(metricsMiddleware);
  mgmtApp.get('/metrics', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  // Use other not found handler.
  mgmtApp.use('*', (req: Request, res: Response) =>
    res.status(404).json({
      message: 'Not Found',
    }),
  );

  const mgmtServer = http.createServer(mgmtApp);
  mgmtServer.setTimeout(mgmtResponseTimeout);
  await mgmtServer.listen(mgmtPort, mgmtHostname, mgmtBacklog);
  console.info(`> Ready ${appName} MGMT Server on http://localhost:${mgmtPort}`);

  //
  // ---------- XPROFILER ----------
  //
  if (process.env.XPROFILER_ENABLE === 'true') {
    const logLevelEnv = process.env.XPROFILER_LOG_LEVEL;
    const logLevel: 0 | 1 | 2 | undefined = logLevelEnv !== undefined ? parseInt(logLevelEnv, 10) as 0 | 1 | 2 : undefined;
    xprofiler.start({
      log_dir: process.env.XPROFILER_LOG_DIR || '/tmp',
      log_level: logLevel,
      enable_fatal_error_hook: process.env.XPROFILER_ENABLE_FATAL_ERROR_HOOK === 'true',
      enable_fatal_error_report: process.env.XPROFILER_ENABLE_FATAL_ERROR_REPORT === 'true',
      enable_fatal_error_coredump: process.env.XPROFILER_ENABLE_FATAL_ERROR_COREDUMP === 'true',
      enable_http_profiling: process.env.XPROFILER_ENABLE_HTTP_PROFILING === 'true',
      enable_auto_incr_heap_limit: process.env.XPROFILER_ENABLE_AUTO_INCR_HEAP_LIMIT === 'true',
    });
    const server = process.env.XTRANSIT_HOST || 'my.xtransit.com';
    const appId = process.env.XTRANSIT_APP_ID ? parseInt(process.env.XTRANSIT_APP_ID, 10) : 0;
    const appSecret = process.env.XTRANSIT_APP_SECRET || 'my_xprofiler_secret';
    xtransit.start({
      server: server,
      appId,
      appSecret,
    });
  }
};
