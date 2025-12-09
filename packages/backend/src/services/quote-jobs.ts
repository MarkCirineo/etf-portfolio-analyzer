import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type { ListContent } from "@db/tables/List";
import {
	type AggregatedEntry,
	type ListAnalysis,
	collectDecompositionPlan,
	getOrCreateAggregate,
	isValidPrice,
	buildListAnalysis
} from "@services/list-analysis";
import { fetchQuotes } from "@utils/quotes";

type QuoteJobStatus = "pending" | "running" | "completed" | "failed";

type QuoteTask =
	| {
			kind: "ETF";
			symbol: string;
			score: number;
	  }
	| {
			kind: "HOLDING";
			symbol: string;
			score: number;
			etfSymbol: string;
			holding: EtfHoldingDetail;
	  };

type EtfHoldingDetail = {
	symbol: string;
	weight: number;
	name?: string;
};

type EtfPlan = {
	symbol: string;
	shares: number;
	holdings: EtfHoldingDetail[];
	holdingLookup: Map<string, EtfHoldingDetail>;
	holdingPrices: Map<string, number>;
	pendingHoldings: Set<string>;
	completedHoldings: Set<string>;
	etfPrice?: number;
};

type QuoteJob = {
	id: string;
	ownerId: number;
	listPublicId: string;
	status: QuoteJobStatus;
	aggregated: Map<string, AggregatedEntry>;
	failedTickers: Set<string>;
	placeholderTickers: Set<string>;
	quoteFailures: Set<string>;
	etfPlans: Map<string, EtfPlan>;
	tasks: QuoteTask[];
	totalTasks: number;
	processedTasks: number;
	eventEmitter: EventEmitter;
	lastPayload?: QuoteJobPayload;
	createdAt: number;
	updatedAt: number;
	timeoutHandle?: NodeJS.Timeout;
};

export type QuoteJobProgress = {
	processed: number;
	total: number;
	fastTrackLimit: number;
};

export type QuoteJobPayload = {
	jobId: string;
	status: QuoteJobStatus;
	progress: QuoteJobProgress;
	analysis: ListAnalysis;
};

type StartQuoteJobParams = {
	ownerId: number;
	listPublicId: string;
	content: ListContent;
};

const jobs = new Map<string, QuoteJob>();
const jobKeyIndex = new Map<string, string>();
const JOB_TTL_MS = 15 * 60 * 1000;
const FAST_TRACK_LIMIT = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startQuoteJob = async (
	params: StartQuoteJobParams
): Promise<QuoteJobPayload | undefined> => {
	const jobKey = getJobKey(params.ownerId, params.listPublicId);
	const existingJobId = jobKeyIndex.get(jobKey);

	let staleJobId: string | undefined;

	if (existingJobId) {
		const existing = jobs.get(existingJobId);

		if (existing && (existing.status === "pending" || existing.status === "running")) {
			return existing.lastPayload;
		}

		staleJobId = existingJobId;
	}

	const job: QuoteJob = {
		id: randomUUID(),
		status: "pending",
		ownerId: params.ownerId,
		listPublicId: params.listPublicId,
		aggregated: new Map(),
		failedTickers: new Set(),
		placeholderTickers: new Set(),
		quoteFailures: new Set(),
		etfPlans: new Map(),
		tasks: [],
		totalTasks: 0,
		processedTasks: 0,
		eventEmitter: new EventEmitter(),
		createdAt: Date.now(),
		updatedAt: Date.now()
	};

	if (staleJobId) {
		const staleJob = jobs.get(staleJobId);
		staleJob?.eventEmitter.removeAllListeners();
		jobs.delete(staleJobId);
	}

	jobs.set(job.id, job);
	jobKeyIndex.set(jobKey, job.id);

	try {
		await initializeJob(job, params.content);
	} catch (error) {
		job.status = "failed";
		job.quoteFailures.add("internal");
		emitJobUpdate(job);
		loggerError(job, error);
		scheduleCleanup(job);
		throw error;
	}

	return job.lastPayload;
};

export const getQuoteJobPayload = (jobId: string): QuoteJobPayload | undefined => {
	return jobs.get(jobId)?.lastPayload;
};

export const assertJobOwnership = (
	jobId: string,
	ownerId: number,
	listPublicId: string
) => {
	const job = jobs.get(jobId);

	if (!job) {
		throw new Error("Job not found");
	}

	if (job.ownerId !== ownerId || job.listPublicId !== listPublicId) {
		throw new Error("Not authorized to access this job");
	}

	return job;
};

export const subscribeToQuoteJob = (
	jobId: string,
	ownerId: number,
	listPublicId: string,
	listener: (payload: QuoteJobPayload) => void
) => {
	const job = assertJobOwnership(jobId, ownerId, listPublicId);
	const handler = (payload: QuoteJobPayload) => listener(payload);

	job.eventEmitter.on("update", handler);

	if (job.lastPayload) {
		listener(job.lastPayload);
	}

	return () => {
		job.eventEmitter.off("update", handler);
	};
};

const initializeJob = async (job: QuoteJob, content: ListContent) => {
	const plan = await collectDecompositionPlan(content);

	job.aggregated = plan.aggregated;
	job.failedTickers = plan.failedTickers;
	job.placeholderTickers = plan.placeholderTickers;

	const etfPlans: Map<string, EtfPlan> = new Map();
	const tasks: QuoteTask[] = [];

	for (const etf of plan.etfInputs) {
		const holdingLookup = new Map<string, EtfHoldingDetail>();

		etf.holdings.forEach((holding) => {
			holdingLookup.set(holding.symbol, {
				symbol: holding.symbol,
				weight: holding.weight,
				...(holding.name && { name: holding.name })
			});
		});

		etfPlans.set(etf.symbol, {
			symbol: etf.symbol,
			shares: etf.shares,
			holdings: etf.holdings,
			holdingLookup,
			holdingPrices: new Map(),
			pendingHoldings: new Set(),
			completedHoldings: new Set()
		});

		tasks.push({
			kind: "ETF",
			symbol: etf.symbol,
			score: etf.shares
		});

		for (const holding of etf.holdings) {
			const holdingScore = etf.shares * holding.weight;

			tasks.push({
				kind: "HOLDING",
				symbol: holding.symbol,
				score: holdingScore,
				etfSymbol: etf.symbol,
				holding: {
					symbol: holding.symbol,
					weight: holding.weight,
					...(holding.name && { name: holding.name })
				}
			});
		}
	}

	job.etfPlans = etfPlans;
	job.tasks = prioritizeTasks(tasks);
	job.totalTasks = job.tasks.length;
	job.status = "running";
	emitJobUpdate(job);

	processTaskQueue(job);
};

const prioritizeTasks = (tasks: QuoteTask[]): QuoteTask[] => {
	return tasks.sort((a, b) => {
		const kindWeight = (task: QuoteTask) => (task.kind === "ETF" ? 2 : 1);
		const kindDelta = kindWeight(b) - kindWeight(a);

		if (kindDelta !== 0) {
			return kindDelta;
		}

		return b.score - a.score;
	});
};

const processTaskQueue = (job: QuoteJob) => {
	const runNext = async () => {
		if (job.status !== "running") {
			return;
		}

		const task = job.tasks.shift();

		if (!task) {
			job.status = "completed";
			emitJobUpdate(job);
			scheduleCleanup(job);
			return;
		}

		const requiresThrottle = job.processedTasks >= FAST_TRACK_LIMIT;

		if (requiresThrottle) {
			await sleep(1000);
		}

		await executeTask(job, task);
		job.processedTasks += 1;
		job.updatedAt = Date.now();
		emitJobUpdate(job);

		setImmediate(runNext);
	};

	runNext();
};

const executeTask = async (job: QuoteJob, task: QuoteTask) => {
	try {
		const quotes = await fetchQuotes([task.symbol]);
		const price = quotes.get(task.symbol);

		if (!isValidPrice(price)) {
			job.quoteFailures.add(task.symbol);
			return;
		}

		if (task.kind === "ETF") {
			handleEtfPrice(job, task.symbol, price);
			return;
		}

		handleHoldingPrice(job, task.etfSymbol, task.holding, price);
	} catch (error) {
		job.quoteFailures.add(task.symbol);
		loggerError(job, error);
	}
};

const handleEtfPrice = (job: QuoteJob, symbol: string, price: number) => {
	const plan = job.etfPlans.get(symbol);

	if (!plan) {
		return;
	}

	plan.etfPrice = price;

	for (const pendingSymbol of Array.from(plan.pendingHoldings)) {
		const pendingHolding = plan.holdingLookup.get(pendingSymbol);
		const holdingPrice = plan.holdingPrices.get(pendingSymbol);

		if (!pendingHolding || !isValidPrice(holdingPrice)) {
			continue;
		}

		applyHoldingExposure(job, plan, pendingHolding, holdingPrice);
		plan.pendingHoldings.delete(pendingSymbol);
	}
};

const handleHoldingPrice = (
	job: QuoteJob,
	etfSymbol: string,
	holding: EtfHoldingDetail,
	price: number
) => {
	const plan = job.etfPlans.get(etfSymbol);

	if (!plan) {
		return;
	}

	plan.holdingPrices.set(holding.symbol, price);

	if (!isValidPrice(plan.etfPrice)) {
		plan.pendingHoldings.add(holding.symbol);
		return;
	}

	applyHoldingExposure(job, plan, holding, price);
};

const applyHoldingExposure = (
	job: QuoteJob,
	plan: EtfPlan,
	holding: EtfHoldingDetail,
	holdingPrice: number
) => {
	if (!isValidPrice(plan.etfPrice)) {
		return;
	}

	if (plan.completedHoldings.has(holding.symbol)) {
		return;
	}

	const capitalAllocation = plan.shares * plan.etfPrice * (holding.weight / 100);
	const derivedShares = capitalAllocation / holdingPrice;

	if (!Number.isFinite(derivedShares) || derivedShares <= 0) {
		return;
	}

	const entry = getOrCreateAggregate(job.aggregated, holding.symbol);
	entry.totalShares += derivedShares;
	entry.viaEtfs.add(plan.symbol);
	if (holding.name && !entry.name) {
		entry.name = holding.name;
	}

	plan.completedHoldings.add(holding.symbol);
};

const emitJobUpdate = (job: QuoteJob) => {
	const payload = buildJobPayload(job);
	job.lastPayload = payload;
	job.eventEmitter.emit("update", payload);
};

const buildJobPayload = (job: QuoteJob): QuoteJobPayload => {
	const analysis = buildListAnalysis(job.aggregated, {
		failedTickers: job.failedTickers,
		placeholderTickers: job.placeholderTickers,
		quoteFailures: job.quoteFailures
	});

	return {
		jobId: job.id,
		status: job.status,
		progress: {
			processed: job.processedTasks,
			total: job.totalTasks,
			fastTrackLimit: FAST_TRACK_LIMIT
		},
		analysis
	};
};

const scheduleCleanup = (job: QuoteJob) => {
	if (job.timeoutHandle) {
		clearTimeout(job.timeoutHandle);
	}

	job.timeoutHandle = setTimeout(() => {
		jobs.delete(job.id);
		jobKeyIndex.delete(getJobKey(job.ownerId, job.listPublicId));
		job.eventEmitter.removeAllListeners();
	}, JOB_TTL_MS);
};

const getJobKey = (ownerId: number, listPublicId: string) => `${ownerId}:${listPublicId}`;

const loggerError = (job: QuoteJob, error: unknown) => {
	// Lazy import to avoid circular dependency
	import("@logger").then(({ default: logger }) => {
		logger.error(
			`[quote-job:${job.id}] ${error instanceof Error ? error.message : String(error)}`
		);
	});
};
