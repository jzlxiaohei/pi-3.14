import { randomUUID } from "node:crypto";
import type { PiTurnResult } from "@pi-3.14/model";
import { AsyncQueue } from "./async-queue.js";
import type {
  SubagentEvent,
  SubagentExecution,
  SubagentExecutor,
  SubagentHandle,
  SubagentInput,
  SubagentResult,
  SubagentStatus,
} from "./types.js";

export interface SubagentOrchestratorOptions {
  executor: SubagentExecutor;
  maxConcurrency?: number;
  createId?: () => string;
  now?: () => number;
}

interface Job {
  id: string;
  input: SubagentInput;
  events: AsyncQueue<SubagentEvent>;
  result: Promise<SubagentResult>;
  resolve: (result: SubagentResult) => void;
  state: "queued" | "running" | "finished";
  startedAt?: number;
  execution?: SubagentExecution;
  abortRequested: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

export class SubagentOrchestrator {
  private readonly executor: SubagentExecutor;
  private readonly maxConcurrency: number;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly pending: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  private disposed = false;

  constructor(options: SubagentOrchestratorOptions) {
    if (!Number.isInteger(options.maxConcurrency ?? 4) || (options.maxConcurrency ?? 4) < 1) {
      throw new Error("maxConcurrency must be a positive integer");
    }
    this.executor = options.executor;
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  spawn(input: SubagentInput): SubagentHandle {
    if (this.disposed) throw new Error("Subagent orchestrator is disposed");
    const id = input.id ?? this.createId();
    if (this.jobs.has(id)) throw new Error(`Subagent id is already active: ${id}`);

    const events = new AsyncQueue<SubagentEvent>();
    let resolveResult!: (result: SubagentResult) => void;
    const result = new Promise<SubagentResult>((resolve) => {
      resolveResult = resolve;
    });
    const job: Job = {
      id,
      input,
      events,
      result,
      resolve: resolveResult,
      state: "queued",
      abortRequested: false,
    };
    this.jobs.set(id, job);
    this.pending.push(job);
    events.push({ type: "queued", at: this.now(), subagentId: id });
    this.drain();

    return {
      id,
      events,
      result,
      abort: () => this.abortJob(job),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const jobs = [...this.jobs.values()];
    await Promise.all(jobs.map((job) => this.abortJob(job)));
    await Promise.all(jobs.map((job) => job.result));
  }

  private drain(): void {
    while (!this.disposed && this.running < this.maxConcurrency) {
      const job = this.pending.shift();
      if (!job) return;
      this.running++;
      job.state = "running";
      job.startedAt = this.now();
      job.events.push({
        type: "started",
        at: job.startedAt,
        subagentId: job.id,
        executor: this.executor.kind,
      });
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    let outcome: SubagentResult;
    try {
      const execution = await this.executor.start(job.input);
      job.execution = execution;
      if (job.input.timeoutMs !== undefined) {
        job.timeout = setTimeout(() => {
          job.abortRequested = true;
          void execution.abort().catch(() => {});
        }, job.input.timeoutMs);
      }
      if (job.abortRequested) await execution.abort();

      const eventPump = this.forwardEvents(job, execution);
      const pi = await execution.result;
      await eventPump;
      outcome = resultFromPi(job, this.executor.kind, pi, this.now());
    } catch (error) {
      outcome = {
        id: job.id,
        executor: this.executor.kind,
        status: job.abortRequested ? "cancelled" : "error",
        text: "",
        startedAt: job.startedAt ?? this.now(),
        finishedAt: this.now(),
        ...(job.abortRequested ? {} : { errorMessage: errorMessage(error) }),
      };
    } finally {
      if (job.timeout) clearTimeout(job.timeout);
      await job.execution?.dispose().catch(() => {});
      await this.finish(job, outcome!);
      this.running--;
      this.drain();
    }
  }

  private async forwardEvents(job: Job, execution: SubagentExecution): Promise<void> {
    for await (const event of execution.events) {
      job.events.push({
        type: "host_event",
        at: this.now(),
        subagentId: job.id,
        event,
      });
    }
  }

  private async abortJob(job: Job): Promise<void> {
    if (job.state === "finished") return;
    job.abortRequested = true;
    if (job.state === "queued") {
      const index = this.pending.indexOf(job);
      if (index >= 0) this.pending.splice(index, 1);
      await this.finish(job, {
        id: job.id,
        executor: this.executor.kind,
        status: "cancelled",
        text: "",
        startedAt: this.now(),
        finishedAt: this.now(),
      });
      return;
    }
    await job.execution?.abort();
  }

  private async finish(job: Job, result: SubagentResult): Promise<void> {
    if (job.state === "finished") return;
    job.state = "finished";
    this.jobs.delete(job.id);
    job.events.push({ type: "finished", at: this.now(), subagentId: job.id, result });
    job.events.close();
    job.resolve(result);
  }
}

function resultFromPi(
  job: Job,
  executor: string,
  pi: PiTurnResult,
  finishedAt: number,
): SubagentResult {
  const status: SubagentStatus =
    job.abortRequested || pi.stopReason === "aborted"
      ? "cancelled"
      : pi.stopReason === "error"
        ? "error"
        : "completed";
  return {
    id: job.id,
    executor,
    status,
    text: pi.text,
    startedAt: job.startedAt ?? finishedAt,
    finishedAt,
    pi,
    ...(status === "error" ? { errorMessage: pi.errorMessage ?? "Subagent failed" } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
