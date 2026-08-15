import type { AppConfig } from "./config.js";
import { CoverageService } from "./analytics/coverage.js";
import { AlertEngine } from "./alerts/engine.js";
import { LogAlertNotifier } from "./alerts/notifiers.js";
import { createLogger, type Logger } from "./observability/logger.js";
import { MarketplaceCollector } from "./ingest/collector.js";
import { ReplayClient } from "./ingest/replay.js";
import { AlertRepository } from "./storage/alert-repository.js";
import { CoverageRepository } from "./storage/coverage-repository.js";
import { DatabaseManager } from "./storage/database.js";
import { EventRepository } from "./storage/event-repository.js";
import { ProjectionRepository } from "./storage/projection-repository.js";
import { QueryRepository } from "./storage/query-repository.js";
import { replayEndpoint } from "./config.js";

export type RuntimeServices = {
  config: AppConfig;
  logger: Logger;
  database: DatabaseManager;
  events: EventRepository;
  projections: ProjectionRepository;
  coverageRepository: CoverageRepository;
  coverage: CoverageService;
  query: QueryRepository;
  alerts: AlertRepository;
  alertEngine: AlertEngine;
  collector: MarketplaceCollector;
  close(): void;
};

export function createRuntime(config: AppConfig): RuntimeServices {
  const logger = createLogger(config.logLevel);
  const database = new DatabaseManager(config.databasePath);
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const coverageRepository = new CoverageRepository(database.db);
  const coverage = new CoverageService(coverageRepository, events, database);
  const query = new QueryRepository(database.db);
  const alerts = new AlertRepository(database.db);
  const alertEngine = new AlertEngine(alerts, new LogAlertNotifier(logger));
  const replay = new ReplayClient({ endpoint: replayEndpoint(config) });
  const collector = new MarketplaceCollector({
    config,
    events,
    projections,
    coverage: coverageRepository,
    replay,
    alertEngine,
    logger,
  });
  return {
    config,
    logger,
    database,
    events,
    projections,
    coverageRepository,
    coverage,
    query,
    alerts,
    alertEngine,
    collector,
    close: () => {
      collector.stop();
      database.close();
    },
  };
}
