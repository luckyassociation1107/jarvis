# JARVIS Ollama Optimizer — tuned for EXACT hardware:
#   CPU: Intel i5-12400F @ 2500MHz (6P cores, 12 threads)
#   Motherboard: Gigabyte H610M K DDR4
#   RAM: 16GB DDR4 (~8GB free)
#   GPU: NONE (F-SKU, no iGPU, no discrete)
#   OS: Windows 11 Pro Build 26200
#
# Run this ONCE as Administrator to configure Ollama for your hardware.
# It sets environment variables that Ollama reads at startup.

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   JARVIS Ollama Optimizer — MDK-TECH-ASSOCIATION           ║" -ForegroundColor Cyan
Write-Host "║   i5-12400F + H610M + 16GB DDR4 + NO GPU                   ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Detect hardware
$cpu = (Get-WmiObject Win32_Processor).Name
$ram = [math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$freeRam = [math]::Round((Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue / 1024, 1)
Write-Host "  CPU:     $cpu" -ForegroundColor Yellow
Write-Host "  RAM:     ${ram}GB total, ${freeRam}GB free" -ForegroundColor Yellow
Write-Host "  GPU:     NONE (CPU-only inference)" -ForegroundColor Red
Write-Host "  Board:   Gigabyte H610M K DDR4" -ForegroundColor Yellow
Write-Host ""

# ─── Ollama environment variables ───
# CRITICAL: CPU-only mode — every setting matters

$env:OLLAMA_NUM_PARALLEL = "1"          # Only 1 inference at a time (CPU can't do 2)
$env:OLLAMA_MAX_LOADED_MODELS = "1"     # Only 1 model in RAM at a time (8GB free limit)
$env:OLLAMA_KEEP_ALIVE = "5m"           # Keep model loaded 5 min, then unload to free RAM
$env:OLLAMA_FLASH_ATTENTION = "0"       # No flash attention on CPU
$env:OLLAMA_HOST = "127.0.0.1:11434"   # Localhost only
$env:OLLAMA_MAX_QUEUE = "5"             # Small queue (CPU processes 1 at a time anyway)

# Persist to user environment (survives reboot)
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "1", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS", "1", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "5m", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "0", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_MAX_QUEUE", "5", "User")

Write-Host "  ✅ Ollama environment configured" -ForegroundColor Green
Write-Host ""

# ─── Recommended models for i5-12400F + 16GB + NO GPU ───

Write-Host "  📦 Recommended models for YOUR hardware:" -ForegroundColor Cyan
Write-Host "     i5-12400F (12 threads) + 16GB DDR4 (~8GB free) + CPU-only" -ForegroundColor Gray
Write-Host ""
Write-Host "  ═══ CHAT (primary — use daily) ═══" -ForegroundColor White
Write-Host "    qwen2.5:3b       Q4_K_M  → ~20 tok/s | 2.0GB RAM | ★★★☆☆ quality" -ForegroundColor Green
Write-Host "    phi3:mini         Q4_K_M  → ~22 tok/s | 2.3GB RAM | ★★★☆☆ quality" -ForegroundColor Green
Write-Host "    llama3.2:3b       Q4_K_M  → ~18 tok/s | 2.0GB RAM | ★★★☆☆ quality" -ForegroundColor Green
Write-Host ""
Write-Host "  ═══ CHAT (quality — when speed OK) ═══" -ForegroundColor White
Write-Host "    qwen2.5:7b       Q4_K_M  → ~8 tok/s  | 4.5GB RAM | ★★★★☆ quality" -ForegroundColor Yellow
Write-Host "    mistral:7b        Q4_K_M  → ~9 tok/s  | 4.4GB RAM | ★★★★☆ quality" -ForegroundColor Yellow
Write-Host "    llama3.1:8b       Q4_K_M  → ~7 tok/s  | 5.0GB RAM | ★★★★☆ quality" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ═══ REASONING (complex tasks) ═══" -ForegroundColor White
Write-Host "    qwen2.5:7b       Q4_K_M  → ~8 tok/s  | 4.5GB RAM | ★★★★☆ reasoning" -ForegroundColor Yellow
Write-Host "    deepseek-r1:7b    Q4_K_M  → ~6 tok/s  | 4.5GB RAM | ★★★★★ reasoning" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ═══ VISION (image analysis) ═══" -ForegroundColor White
Write-Host "    llava:7b          Q4_K_M  → ~5 tok/s  | 4.5GB RAM | ★★★☆☆ vision" -ForegroundColor Yellow
Write-Host "    minicpm-v:8b      Q4_K_M  → ~5 tok/s  | 5.0GB RAM | ★★★★☆ vision" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ═══ CODING (code generation) ═══" -ForegroundColor White
Write-Host "    qwen2.5-coder:7b  Q4_K_M  → ~7 tok/s  | 4.5GB RAM | ★★★★☆ coding" -ForegroundColor Yellow
Write-Host "    deepseek-coder:6b Q4_K_M  → ~8 tok/s  | 4.0GB RAM | ★★★★☆ coding" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  ⚠️  NEVER use 13B+ models — <3 tok/s on CPU, painfully slow" -ForegroundColor Red
Write-Host "  ⚠️  NEVER use Q8/Q16 quant — eats too much RAM" -ForegroundColor Red
Write-Host "  ⚠️  NEVER load 2 models simultaneously — RAM limit" -ForegroundColor Red
Write-Host "  ⚠️  CLOSE Chrome/Edge tabs before running — browsers eat 2-4GB" -ForegroundColor Red
Write-Host ""
Write-Host "  💡 RECOMMENDED: Install 3B for speed + 7B for quality" -ForegroundColor Cyan
Write-Host "     Switch between them based on task complexity" -ForegroundColor Cyan
Write-Host ""

# ─── Model install helper ───

Write-Host "  🚀 To install recommended models:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  QUICK (minimal, fastest):" -ForegroundColor White
Write-Host '    ollama pull qwen2.5:3b' -ForegroundColor Green
Write-Host ""
Write-Host "  RECOMMENDED (best balance):" -ForegroundColor White
Write-Host '    ollama pull qwen2.5:3b' -ForegroundColor Green
Write-Host '    ollama pull qwen2.5:7b' -ForegroundColor Green
Write-Host '    ollama pull llava:7b' -ForegroundColor Green
Write-Host ""
Write-Host "  FULL (all capabilities):" -ForegroundColor White
Write-Host '    ollama pull qwen2.5:3b' -ForegroundColor Green
Write-Host '    ollama pull qwen2.5:7b' -ForegroundColor Green
Write-Host '    ollama pull deepseek-r1:7b' -ForegroundColor Green
Write-Host '    ollama pull llava:7b' -ForegroundColor Green
Write-Host '    ollama pull qwen2.5-coder:7b' -ForegroundColor Green
Write-Host ""

Write-Host "  ✅ Optimization complete!" -ForegroundColor Green
Write-Host "  Restart Ollama for changes to take effect." -ForegroundColor Yellow
Write-Host ""