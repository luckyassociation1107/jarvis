# JARVIS Ollama Optimizer — tuned for i5-12400F + 16GB RAM + No GPU
#
# Run this ONCE to configure Ollama for your hardware.
# It sets environment variables that Ollama reads at startup.

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        JARVIS Ollama Optimizer — i5-12400F + 16GB       ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Detect hardware
$cpu = (Get-WmiObject Win32_Processor).Name
$ram = [math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Write-Host "  CPU: $cpu" -ForegroundColor Yellow
Write-Host "  RAM: ${ram}GB" -ForegroundColor Yellow
Write-Host ""

# ─── Ollama environment variables ───

# Thread count — use 8 of 12 threads (leave headroom for OS)
$env:OLLAMA_NUM_PARALLEL = "1"          # Only 1 inference at a time (CPU-only)
$env:OLLAMA_MAX_LOADED_MODELS = "1"     # Only 1 model in memory at a time
$env:OLLAMA_KEEP_ALIVE = "5m"           # Keep model loaded for 5 minutes
$env:OLLAMA_FLASH_ATTENTION = "0"       # No flash attention on CPU
$env:OLLAMA_HOST = "127.0.0.1:11434"   # Local only

# Memory management
$env:OLLAMA_MAX_QUEUE = "10"            # Max queued requests

# Persist to user environment
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "1", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS", "1", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "5m", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "0", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_MAX_QUEUE", "10", "User")

Write-Host "  ✅ Ollama environment configured" -ForegroundColor Green
Write-Host ""

# ─── Recommended models for this hardware ───

Write-Host "  📦 Recommended models for i5-12400F + 16GB (CPU-only):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  CHAT (primary):" -ForegroundColor White
Write-Host "    qwen2.5:3b-instruct-q4_K_M     → ~20 tok/s, 2GB RAM" -ForegroundColor Green
Write-Host "    llama3.2:3b-q4_K_M              → ~18 tok/s, 2GB RAM" -ForegroundColor Green
Write-Host "    phi3:mini-4k-instruct-q4_K_M    → ~22 tok/s, 2.3GB RAM" -ForegroundColor Green
Write-Host ""
Write-Host "  CHAT (quality, if speed OK):" -ForegroundColor White
Write-Host "    qwen2.5:7b-instruct-q4_K_M     → ~8 tok/s, 4.5GB RAM" -ForegroundColor Yellow
Write-Host "    llama3.1:8b-instruct-q4_K_M    → ~7 tok/s, 5GB RAM" -ForegroundColor Yellow
Write-Host "    mistral:7b-instruct-q4_K_M     → ~9 tok/s, 4.4GB RAM" -ForegroundColor Yellow
Write-Host ""
Write-Host "  REASONING:" -ForegroundColor White
Write-Host "    qwen2.5:7b-instruct-q4_K_M     → best reasoning for this hardware" -ForegroundColor Yellow
Write-Host "    deepseek-r1:7b-q4_K_M           → strong reasoning, ~6 tok/s" -ForegroundColor Yellow
Write-Host ""
Write-Host "  VISION:" -ForegroundColor White
Write-Host "    llava:7b-v1.6-q4_K_M            → vision capable, ~5 tok/s" -ForegroundColor Yellow
Write-Host "    minicpm-v:8b-q4_K_M             → better vision, ~5 tok/s" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ⚠️  DO NOT use 13B+ models — too slow on CPU-only (<3 tok/s)" -ForegroundColor Red
Write-Host "  ⚠️  DO NOT use Q8/Q16 quantization — too much RAM" -ForegroundColor Red
Write-Host ""

# ─── Model install helper ───

Write-Host "  🚀 To install recommended models:" -ForegroundColor Cyan
Write-Host ""
Write-Host '    ollama pull qwen2.5:3b' -ForegroundColor White
Write-Host '    ollama pull llama3.2:3b' -ForegroundColor White
Write-Host '    ollama pull phi3:mini' -ForegroundColor White
Write-Host ""

Write-Host "  ✅ Optimization complete!" -ForegroundColor Green
Write-Host "  Restart Ollama for changes to take effect." -ForegroundColor Yellow
Write-Host ""