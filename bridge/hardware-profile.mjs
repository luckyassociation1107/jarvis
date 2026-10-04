/**
 * JARVIS Hardware Profile — auto-detect and optimize for YOUR machine.
 *
 * This is the SINGLE source of truth for all performance decisions.
 * Every module reads from here to know what's possible.
 *
 * Target hardware detected:
 *   CPU: Intel i5-12400F (6P cores, 12 threads, Alder Lake)
 *   RAM: 16GB
 *   GPU: None (CPU-only inference)
 *   OS: Windows 11 Pro
 *
 * Optimization strategy:
 *   - Small quantized models (Q4_K_M, 3B-7B max)
 *   - Aggressive memory management
 *   - CPU thread optimization (use all 12 threads)
 *   - Context window limits to save RAM
 *   - Batch processing over streaming where possible
 *   - Lazy loading of modules
 *   - Cache everything possible
 */

import os from 'os'
import { execSync } from 'child_process'

/* ──────────────── Hardware detection ──────────────────────────── */

function detectHardware() {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const platform = os.platform()
  const arch = os.arch()

  // CPU info
  const cpuModel = cpus[0]?.model || 'Unknown'
  const cpuCores = os.cpus().length
  const physicalCores = Math.ceil(cpuCores / 2) // Assume hyperthreading

  // Detect GPU (Windows)
  let gpu = { available: false, name: 'None', vram: 0 }
  if (platform === 'win32') {
    try {
      const gpuInfo = execSync('wmic path win32_videocontroller get name,AdapterRAM /format:csv', { encoding: 'utf8', timeout: 5000 })
      const match = gpuInfo.match(/(\d+),(.+)/)
      if (match) {
        const vramBytes = parseInt(match[1])
        gpu = {
          available: vramBytes > 0,
          name: match[2].trim(),
          vram: Math.round(vramBytes / 1024 / 1024 / 1024 * 10) / 10, // GB
        }
      }
    } catch {
      // Try nvidia-smi
      try {
        const nvidia = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8', timeout: 5000 })
        const [name, vram] = nvidia.trim().split(',')
        gpu = { available: true, name: name?.trim(), vram: parseInt(vram) / 1024 }
      } catch {
        // No GPU detected
      }
    }
  }

  return {
    cpu: {
      model: cpuModel.trim(),
      cores: cpuCores,
      physicalCores,
      isAlderLake: cpuModel.includes('12') || cpuModel.includes('Alder'),
      isHyperthreaded: cpuCores > physicalCores,
      singleThreadScore: estimateSingleThread(cpuModel),
    },
    ram: {
      total: Math.round(totalMem / 1024 / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024 / 1024),
      usable: Math.round((totalMem * 0.75) / 1024 / 1024 / 1024), // 75% usable for AI
    },
    gpu,
    platform,
    arch,
    isWindows: platform === 'win32',
    isLinux: platform === 'linux',
  }
}

function estimateSingleThread(model) {
  // Rough single-thread performance score (higher = better)
  const m = model.toLowerCase()
  if (m.includes('12400') || m.includes('12600')) return 85 // Strong
  if (m.includes('12700') || m.includes('12900')) return 95 // Very strong
  if (m.includes('13400') || m.includes('13600')) return 90
  if (m.includes('14400') || m.includes('14600')) return 92
  if (m.includes('5600') || m.includes('5800')) return 80 // Ryzen 5000
  if (m.includes('7600') || m.includes('7800')) return 88 // Ryzen 7000
  if (m.includes('i5') || m.includes('i7')) return 75
  if (m.includes('i3')) return 55
  if (m.includes('celeron') || m.includes('pentium')) return 30
  return 60 // Default
}

/* ──────────────── Optimization profiles ──────────────────────────── */

function generateProfile(hw) {
  // Determine tier
  let tier = 'low'
  if (hw.ram.total >= 32 && hw.gpu.available && hw.gpu.vram >= 8) tier = 'ultra'
  else if (hw.ram.total >= 16 && hw.gpu.available && hw.gpu.vram >= 6) tier = 'high'
  else if (hw.ram.total >= 16 && hw.gpu.available && hw.gpu.vram >= 2) tier = 'medium-high'
  else if (hw.ram.total >= 16 && !hw.gpu.available) tier = 'medium-cpu' // ← YOUR TIER
  else if (hw.ram.total >= 8) tier = 'low-medium'
  else tier = 'low'

  // Model recommendations based on tier
  const modelProfiles = {
    'ultra': {
      chat: { size: '13B', quant: 'Q5_K_M', contextLength: 8192 },
      vision: { size: '11B', quant: 'Q4_K_M', contextLength: 4096 },
      reason: { size: '13B', quant: 'Q5_K_M', contextLength: 8192 },
    },
    'high': {
      chat: { size: '7B', quant: 'Q5_K_M', contextLength: 8192 },
      vision: { size: '7B', quant: 'Q4_K_M', contextLength: 4096 },
      reason: { size: '13B', quant: 'Q4_K_M', contextLength: 4096 },
    },
    'medium-high': {
      chat: { size: '7B', quant: 'Q4_K_M', contextLength: 4096 },
      vision: { size: '7B', quant: 'Q4_K_M', contextLength: 2048 },
      reason: { size: '7B', quant: 'Q5_K_M', contextLength: 4096 },
    },
    'medium-cpu': { // ← YOUR OPTIMAL PROFILE
      chat: { size: '3B-7B', quant: 'Q4_K_M', contextLength: 4096 },
      vision: { size: '3B', quant: 'Q4_K_M', contextLength: 2048 },
      reason: { size: '7B', quant: 'Q4_K_M', contextLength: 4096 },
    },
    'low-medium': {
      chat: { size: '3B', quant: 'Q4_K_M', contextLength: 2048 },
      vision: { size: '3B', quant: 'Q4_0', contextLength: 1024 },
      reason: { size: '3B', quant: 'Q4_K_M', contextLength: 2048 },
    },
    'low': {
      chat: { size: '1B-3B', quant: 'Q4_0', contextLength: 1024 },
      vision: { size: '1B', quant: 'Q4_0', contextLength: 512 },
      reason: { size: '1B-3B', quant: 'Q4_0', contextLength: 1024 },
    },
  }

  // Ollama settings optimized for CPU-only i5-12400F
  const ollamaSettings = {
    'medium-cpu': {
      numThreads: 8,           // Use 8 of 12 threads (leave headroom)
      numBatch: 512,           // Batch size for prompt processing
      numCtx: 4096,            // Context window
      numGpu: 0,               // No GPU
      mmap: true,              // Memory-mapped files (saves RAM)
      mlock: false,            // Don't lock memory (let OS swap if needed)
      numa: false,             // No NUMA on desktop
      ropeScaling: null,       // No rope scaling (keep it simple)
      flashAttention: false,   // CPU doesn't benefit from flash attention
      quantization: 'q4_k_m',  // Best quality/speed ratio for CPU
    },
  }

  // Module loading strategy
  const moduleStrategy = {
    eager: [],      // Load immediately on startup
    lazy: [],       // Load on first use
    deferred: [],   // Load only when explicitly requested
    disabled: [],   // Too heavy for this hardware
  }

  if (tier === 'medium-cpu') {
    // Core — always loaded (small footprint)
    moduleStrategy.eager = [
      'agent', 'workflow', 'language', 'commands', 'memory',
      'context', 'emotion', 'proactive', 'local-llm',
    ]

    // Useful — load on first use
    moduleStrategy.lazy = [
      'app-launcher', 'vision-controller', 'documents', 'code-exec',
      'digital-twin', 'self-improve', 'universal-translator',
      'reasoning-engine', 'wisdom', 'personality', 'empathy',
      'predict-scheduler', 'creative-writer',
    ]

    // Heavy — only load when explicitly requested
    moduleStrategy.deferred = [
      'autonomous-coder', 'research', 'research-lab', 'scientist',
      'swarm', 'multiverse', 'world-sim', 'simulation',
      'music-studio', 'holographic', 'visual-storyteller',
      'knowledge-graph', 'hive-mind', 'genetic', 'quantum',
      'replicator', 'foresight', 'memetic', 'emergent',
      'threat-model', 'diplomacy', 'wisdom-traditions',
      'planetary', 'economy', 'education', 'health', 'ethics',
      'society', 'macro-memory', 'orchestrator', 'executive',
      'operational', 'resource-mgr', 'proactive-v2',
    ]

    // Too heavy — disable
    moduleStrategy.disabled = [
      'dream',           // Continuous background processing too expensive
      'time-travel',     // Snapshot storage too heavy
      'memory-palace',   // BFS pathfinding too slow on CPU
    ]
  }

  return {
    tier,
    hardware: hw,
    models: modelProfiles[tier],
    ollama: ollamaSettings[tier] || ollamaSettings['low'],
    moduleStrategy,
    optimizations: {
      maxConcurrentLLMCalls: 1,        // CPU-only: sequential inference
      maxContextTokens: 4096,           // Save RAM
      maxResponseTokens: 1024,          // Don't generate walls of text
      enableCaching: true,              // Cache LLM responses
      cacheSize: 100,                   // Max cached responses
      enableLazyLoading: true,          // Don't load all modules
      enableCompression: true,          // Compress memory storage
      enableDeduplication: true,        // Deduplicate similar memories
      backgroundProcessing: false,      // No background tasks (save CPU)
      streamingInference: true,         // Stream tokens for responsiveness
      batchProcessing: true,            // Batch multiple requests
      prewarmModels: ['chat'],          // Only prewarm chat model
      maxHistoryMessages: 20,           // Limit conversation history
      maxMemoryEntries: 500,            // Limit memory entries
      maxKnowledgeGraphNodes: 200,      // Limit KG size
      maxSwarmAgents: 3,                // Limit swarm to 3 agents (not 8)
      maxMultiverseBranches: 3,         // Limit multiverse to 3 (not 5)
      maxReasoningStrategies: 3,        // Use 3 strategies (not 8)
      maxPeerReviews: 1,                // 1 reviewer per task (not 2)
    },
  }
}

/* ──────────────── Memory management ──────────────────────────── */

function getMemoryBudget(ramGB) {
  // How to allocate RAM
  const totalGB = ramGB
  const osOverhead = 2.5 // Windows + background apps
  const available = totalGB - osOverhead

  return {
    totalGB,
    available: Math.round(available * 10) / 10,
    allocation: {
      llmModels: Math.round(available * 0.55 * 10) / 10,    // 55% for LLM
      nodeRuntime: Math.round(available * 0.10 * 10) / 10,   // 10% for Node.js
      cache: Math.round(available * 0.15 * 10) / 10,          // 15% for cache
      memory: Math.round(available * 0.10 * 10) / 10,         // 10% for memory store
      headroom: Math.round(available * 0.10 * 10) / 10,       // 10% headroom
    },
    recommendations: [
      'Use Q4_K_M quantization (best quality/speed for 16GB)',
      'Keep context window at 4096 tokens max',
      'Close other applications while running JARVIS',
      'Use Ollama with mmap=true for memory efficiency',
      'Set Node.js heap to 4GB: --max-old-space-size=4096',
    ],
  }
}

/* ──────────────── Export ──────────────────────────── */

const HW = detectHardware()
const PROFILE = generateProfile(HW)
const MEMORY_BUDGET = getMemoryBudget(HW.ram.total)

export { HW, PROFILE, MEMORY_BUDGET, detectHardware, generateProfile, getMemoryBudget }
export default PROFILE