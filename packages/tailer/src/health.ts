import { Elysia } from "elysia";

export interface HealthDeps {
  getQueueSize: () => number;
  getReaderCount: () => number;
  checkDb: () => Promise<unknown>;
  isPressured: () => boolean;
  getUnboundMapperStats: () => { count: number; oldestPendingMs: number };
  startTime: number;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  queueDepth: number;
  activeReaders: number;
  dbConnected: boolean;
  uptimeSeconds: number;
  pressured: boolean;
  unboundMappers: number;
  oldestUnboundPendingMs: number;
}

export function createHealthServer(deps: HealthDeps) {
  return new Elysia().get("/health", async (): Promise<HealthStatus> => {
    let dbConnected = false;
    try {
      await deps.checkDb();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const unbound = deps.getUnboundMapperStats();

    return {
      status: dbConnected ? "ok" : "degraded",
      queueDepth: deps.getQueueSize(),
      activeReaders: deps.getReaderCount(),
      dbConnected,
      uptimeSeconds: Math.floor((Date.now() - deps.startTime) / 1000),
      pressured: deps.isPressured(),
      unboundMappers: unbound.count,
      oldestUnboundPendingMs: unbound.oldestPendingMs,
    };
  });
}

