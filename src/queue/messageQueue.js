let Queue;
let Worker;
let QueueEvents;
let IORedis;

try {
  ({ Queue, Worker, QueueEvents } = require('bullmq'));
  IORedis = require('ioredis');
} catch (_error) {
  Queue = null;
  Worker = null;
  QueueEvents = null;
  IORedis = null;
}

const QUEUE_NAME = process.env.MESSAGE_QUEUE_NAME || 'whatsapp-messages';
const REDIS_URL = process.env.REDIS_URL || '';
const QUEUE_DRIVER = String(process.env.QUEUE_DRIVER || 'auto').toLowerCase();
const CONCURRENCY = Number(process.env.MESSAGE_QUEUE_CONCURRENCY || 1);

let mode = 'memory';
let queue = null;
let queueEvents = null;
let memoryProcessor = null;
let memoryCounter = 0;
const memoryJobs = new Map();
const memoryQueue = [];
let memoryRunning = false;

function canUseRedis() {
  if (QUEUE_DRIVER === 'memory') {
    return false;
  }

  if (QUEUE_DRIVER === 'redis' && !REDIS_URL) {
    throw new Error('QUEUE_DRIVER=redis exige REDIS_URL configurado.');
  }

  return Boolean(REDIS_URL && Queue && Worker && QueueEvents && IORedis);
}

function bullConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null
  });
}

function initMessageQueue(processor) {
  if (canUseRedis()) {
    mode = 'redis';
    const connection = bullConnection();
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: Number(process.env.MESSAGE_QUEUE_ATTEMPTS || 5),
        backoff: {
          type: 'exponential',
          delay: Number(process.env.MESSAGE_QUEUE_BACKOFF_MS || 5000)
        },
        removeOnComplete: {
          age: Number(process.env.MESSAGE_QUEUE_KEEP_COMPLETE_SECONDS || 86400),
          count: Number(process.env.MESSAGE_QUEUE_KEEP_COMPLETE_COUNT || 1000)
        },
        removeOnFail: {
          age: Number(process.env.MESSAGE_QUEUE_KEEP_FAILED_SECONDS || 604800),
          count: Number(process.env.MESSAGE_QUEUE_KEEP_FAILED_COUNT || 1000)
        }
      }
    });

    queueEvents = new QueueEvents(QUEUE_NAME, { connection: bullConnection() });
    new Worker(
      QUEUE_NAME,
      async (job) => processor(job.data, job),
      { connection: bullConnection(), concurrency: CONCURRENCY }
    );

    console.log(`Fila WhatsApp usando Redis: ${QUEUE_NAME}`);
    return;
  }

  mode = 'memory';
  memoryProcessor = processor;
  console.warn('Fila WhatsApp usando memoria. Configure QUEUE_DRIVER=redis e REDIS_URL para persistencia.');
}

async function enqueueMessage(payload) {
  if (mode === 'redis') {
    const job = await queue.add('send-message', payload);
    return {
      id: String(job.id),
      mode,
      persistent: true
    };
  }

  const id = String(++memoryCounter);
  memoryJobs.set(id, {
    id,
    data: payload,
    state: 'waiting',
    attemptsMade: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString()
  });
  memoryQueue.push(id);
  processMemoryQueue();

  return {
    id,
    mode,
    persistent: false
  };
}

async function getMessageJob(id) {
  if (mode === 'redis') {
    const job = await queue.getJob(id);
    if (!job) {
      return null;
    }

    return {
      id: String(job.id),
      mode,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      data: job.data,
      result: job.returnvalue || null,
      failedReason: job.failedReason || null,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null
    };
  }

  return memoryJobs.get(String(id)) || null;
}

async function getQueueStatus() {
  if (mode === 'redis') {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    return {
      mode,
      persistent: true,
      queue: QUEUE_NAME,
      counts
    };
  }

  const counts = {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0
  };

  for (const job of memoryJobs.values()) {
    counts[job.state] = (counts[job.state] || 0) + 1;
  }

  return {
    mode,
    persistent: false,
    queue: QUEUE_NAME,
    counts
  };
}

async function processMemoryQueue() {
  if (memoryRunning || !memoryProcessor) {
    return;
  }

  memoryRunning = true;

  while (memoryQueue.length) {
    const id = memoryQueue.shift();
    const job = memoryJobs.get(id);
    if (!job) {
      continue;
    }

    job.state = 'active';
    job.attemptsMade += 1;

    try {
      job.result = await memoryProcessor(job.data, job);
      job.state = 'completed';
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      job.error = error.message;
      job.state = 'failed';
      job.finishedAt = new Date().toISOString();
    }
  }

  memoryRunning = false;
}

module.exports = {
  enqueueMessage,
  getMessageJob,
  getQueueStatus,
  initMessageQueue
};

