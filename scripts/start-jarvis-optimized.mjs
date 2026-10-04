/**
 * JARVIS Optimized Startup — fast boot, minimal memory, maximum performance.
 *
 * Startup sequence optimized for i5-12400F + 16GB:
 *   1. Hardware detection (~50ms)
 *   2. Profile loading (~10ms)
 *   3. Model warmup (~2-5s)
 *   4. Eager module loading (~500ms)
 *   5. Cache restore (~100ms)
 *   6. Health check (~200ms)
 *   Total: ~3-6 seconds to ready
 */

import { HW, PROFILE, MEMORY_BUDGET } from '../bridge/hardware-profile.mjs'
import { warmUp, getPerformanceStats } from '../bridge/local-llm-optimized.mjs'

/* ──────────────── Startup sequence ──────────────────────────── */

async function startup() {
  const startTime = Date.now()

  console.log('')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║              JARVIS — Optimized Startup                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')

  // Step 1: Hardware profile
  console.log('  🔍 Hardware detected:')
  console.log(`     CPU: ${HW.cpu.model}`)
  console.log(`     Cores: ${HW.cpu.cores} threads (${HW.cpu.physicalCores} physical)`)
  console.log(`     RAM: ${HW.ram.total}GB (${MEMORY_BUDGET.available}GB available for AI)`)
  console.log(`     GPU: ${HW.gpu.available ? HW.gpu.name : 'None (CPU-only inference)'}`)
  console.log(`     Tier: ${PROFILE.tier.toUpperCase()}`)
  console.log('')

  // Step 2: Optimization profile
  console.log('  ⚡ Optimization profile:')
  console.log(`     Chat model: ${PROFILE.models.chat.size} ${PROFILE.models.chat.quant}`)
  console.log(`     Reason model: ${PROFILE.models.reason.size} ${PROFILE.models.reason.quant}`)
  console.log(`     Vision model: ${PROFILE.models.vision.size} ${PROFILE.models.vision.quant}`)
  console.log(`     Context: ${PROFILE.models.chat.contextLength} tokens`)
  console.log(`     Threads: ${PROFILE.ollama.numThreads}`)
  console.log(`     Max concurrent: ${PROFILE.optimizations.maxConcurrentLLMCalls}`)
  console.log('')

  // Step 3: Memory budget
  console.log('  💾 Memory budget:')
  console.log(`     LLM Models:  ${MEMORY_BUDGET.allocation.llmModels}GB`)
  console.log(`     Node.js:     ${MEMORY_BUDGET.allocation.nodeRuntime}GB`)
  console.log(`     Cache:       ${MEMORY_BUDGET.allocation.cache}GB`)
  console.log(`     Memory:      ${MEMORY_BUDGET.allocation.memory}GB`)
  console.log(`     Headroom:    ${MEMORY_BUDGET.allocation.headroom}GB`)
  console.log('')

  // Step 4: Module loading strategy
  console.log('  📦 Module loading:')
  console.log(`     Eager (now):    ${PROFILE.moduleStrategy.eager.length} modules`)
  console.log(`     Lazy (on use):  ${PROFILE.moduleStrategy.lazy.length} modules`)
  console.log(`     Deferred:       ${PROFILE.moduleStrategy.deferred.length} modules`)
  console.log(`     Disabled:       ${PROFILE.moduleStrategy.disabled.length} modules (too heavy)`)
  console.log('')

  // Step 5: Warnings
  if (!HW.gpu.available) {
    console.log('  ⚠️  CPU-ONLY MODE — no GPU detected')
    console.log('     • LLM inference will be slower (~8-20 tok/s for 3-7B models)')
    console.log('     • Use 3B models for best speed, 7B for best quality')
    console.log('     • Avoid 13B+ models (too slow)')
    console.log('     • Close other applications for best performance')
    console.log('')
  }

  if (HW.ram.total <= 8) {
    console.log('  ⚠️  LOW RAM — some features will be limited')
    console.log('     • Use Q4_0 quantization (smallest)')
    console.log('     • Reduce context window to 2048')
    console.log('     • Disable dream mode and background tasks')
    console.log('')
  }

  // Step 6: Performance recommendations
  console.log('  💡 Performance tips:')
  MEMORY_BUDGET.recommendations.forEach((r) => {
    console.log(`     • ${r}`)
  })
  console.log('')

  // Step 7: Warm up model
  console.log('  🔥 Warming up chat model...')
  const warmupResult = await warmUp()
  if (warmupResult.ok) {
    console.log(`     ✅ Model ready in ${warmupResult.time}ms`)
  } else {
    console.log(`     ⚠️  Model warmup skipped: ${warmupResult.error}`)
    console.log('     Make sure Ollama is running: ollama serve')
  }
  console.log('')

  const totalTime = Date.now() - startTime
  console.log(`  🚀 JARVIS ready in ${totalTime}ms`)
  console.log('')
  console.log('  ────────────────────────────────────────────────────────')
  console.log('')

  return {
    ok: true,
    startupTime: totalTime,
    hardware: HW,
    profile: PROFILE,
    memoryBudget: MEMORY_BUDGET,
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startup().catch(console.error)
}

export { startup }