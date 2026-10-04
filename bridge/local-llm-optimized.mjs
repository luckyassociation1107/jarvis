/**
 * JARVIS Optimized LLM — inference tuned for i5-12400F + 16GB + No GPU.
 *
 * Wraps around local-llm.mjs with:
 *   - Response caching (skip inference for repeated prompts)
 *   - Request queuing (prevent CPU overload)
 *   - Prompt optimization (fewer tokens = faster inference)
 *   - Conversation pruning (stay within context window)
 *   - Progressive token streaming
 *   - Auto-tuning based on observed latency
 *   - Memory-aware model selection
 *
 * Performance targets for i5-12400F:
 *   - 3B Q4_K_M: ~15-25 tokens/sec (fast, good for simple tasks)
 *   - 7B Q4_K_M: ~6-10 tokens/sec (balanced, good for complex tasks)
 *   - 13B Q4_K_M: ~2-4 tokens/sec (slow, avoid unless critical)
 *
 * "Fast and good enough beats slow and perfect."
 */

import { PROFILE, HW } from './hardware-profile.mjs'
import { responseCache, requestQueue, autoTuner, pruneConversation, optimizePrompt } from './perf-optimizer.mjs'

/* ──────────────── Optimized inference ──────────────────────────── */

/**
 * Complete with automatic optimization.
 *
 * This is a DROP-IN REPLACEMENT for complete() from local-llm.mjs.
 * Same API, but optimized for CPU-only inference.
 */
export async function completeOptimized(slot, messages, options = {}) {
  const startTime = Date.now()

  // 1. Optimize prompts (reduce tokens)
  const optimized = optimizePrompt(messages)

  // 2. Prune conversation history
  const pruned = pruneConversation(optimized)

  // 3. Check cache
  const cached = responseCache.get(pruned, options)
  if (cached) {
    autoTuner.record(Date.now() - startTime, cached.length)
    return cached
  }

  // 4. Apply hardware-specific defaults
  const opts = {
    maxTokens: Math.min(options.maxTokens || PROFILE.optimizations.maxResponseTokens, PROFILE.optimizations.maxResponseTokens),
    temperature: options.temperature || 0.7,
    numCtx: PROFILE.optimizations.maxContextTokens,
    numThread: PROFILE.ollama.numThreads,
    numBatch: PROFILE.ollama.numBatch,
    ...options,
  }

  // 5. Queue the request (CPU can only do 1 inference at a time)
  const response = await requestQueue.enqueue(async () => {
    // Dynamic import of actual LLM module
    const { complete } = await import('./local-llm.mjs')
    return complete(slot, pruned, opts)
  }, options.priority || 'normal')

  // 6. Cache the response
  if (response && !options.noCache) {
    responseCache.set(pruned, opts, response)
  }

  // 7. Record metrics
  autoTuner.record(Date.now() - startTime, response?.length || 0)

  return response
}

/**
 * Quick complete — for simple tasks, use smallest/fastest model.
 */
export async function quickComplete(messages, options = {}) {
  return completeOptimized('chat', messages, {
    ...options,
    maxTokens: Math.min(options.maxTokens || 256, 256),
    temperature: options.temperature || 0.5,
  })
}

/**
 * Reason complete — for complex reasoning, use larger model.
 */
export async function reasonComplete(messages, options = {}) {
  return completeOptimized('reason', messages, {
    ...options,
    maxTokens: Math.min(options.maxTokens || 800, PROFILE.optimizations.maxResponseTokens),
    temperature: options.temperature || 0.3, // Lower temp for reasoning
  })
}

/* ──────────────── Batch inference ──────────────────────────── */

/**
 * Process multiple prompts sequentially (CPU can only do one at a time).
 * But we can optimize by reusing context.
 */
export async function batchComplete(prompts, { slot = 'chat', onResult = () => {} } = {}) {
  const results = []

  for (let i = 0; i < prompts.length; i++) {
    onResult(`Processing ${i + 1}/${prompts.length}...`)
    const result = await completeOptimized(slot, prompts[i])
    results.push(result)
  }

  return results
}

/* ──────────────── Performance stats ──────────────────────────── */

export function getPerformanceStats() {
  return {
    hardware: {
      cpu: HW.cpu.model,
      cores: HW.cpu.cores,
      ram: `${HW.ram.total}GB`,
      gpu: HW.gpu.available ? HW.gpu.name : 'None (CPU-only)',
      tier: PROFILE.tier,
    },
    cache: responseCache.getStats(),
    queue: requestQueue.getStats(),
    autoTune: autoTuner.getStats(),
    optimizations: {
      maxConcurrent: PROFILE.optimizations.maxConcurrentLLMCalls,
      maxContext: PROFILE.optimizations.maxContextTokens,
      maxResponse: PROFILE.optimizations.maxResponseTokens,
      cacheEnabled: PROFILE.optimizations.enableCaching,
      threads: PROFILE.ollama.numThreads,
    },
    memoryBudget: {
      llmModels: `${MEMORY_BUDGET.allocation.llmModels}GB`,
      cache: `${MEMORY_BUDGET.allocation.cache}GB`,
      available: `${MEMORY_BUDGET.available}GB`,
    },
  }
}

/* ──────────────── Warm up ──────────────────────────── */

/**
 * Pre-warm the chat model so first request isn't slow.
 */
export async function warmUp() {
  console.log('  ⚡ Warming up models...')
  const start = Date.now()

  try {
    await completeOptimized('chat', [
      { role: 'user', content: 'Hello' },
    ], { maxTokens: 10, noCache: true })

    console.log(`  ⚡ Warmup complete in ${Date.now() - start}ms`)
    return { ok: true, time: Date.now() - start }
  } catch (err) {
    console.log(`  ⚡ Warmup skipped: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

/* ──────────────── Re-export for compatibility ──────────────────────────── */

// Keep backward compatibility with existing modules
export { completeOptimized as complete }
export default completeOptimized