import { BRIDGE_HTTP_URL } from '../config'

export async function checkLocalWhisper(): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const response = await fetch(`${BRIDGE_HTTP_URL}/stt`, { signal: AbortSignal.timeout(3500) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) {
      return { ok: false, error: String(data.error ?? `Whisper bridge returned HTTP ${response.status}`) }
    }
    return { ok: true, model: data.model }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Local Whisper bridge is unavailable.',
    }
  }
}

/** Decode the browser's MediaRecorder format and encode mono 16 kHz PCM WAV. */
export async function toWhisperWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const mono = context.createBuffer(1, decoded.length, decoded.sampleRate)
    const out = mono.getChannelData(0)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel)
      const gain = 1 / decoded.numberOfChannels
      for (let i = 0; i < out.length; i++) out[i] += data[i] * gain
    }

    const sampleRate = 16_000
    const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate))
    const offline = new OfflineAudioContext(1, frames, sampleRate)
    const source = offline.createBufferSource()
    source.buffer = mono
    source.connect(offline.destination)
    source.start()
    const resampled = await offline.startRendering()
    const pcm = resampled.getChannelData(0)
    const wav = new ArrayBuffer(44 + pcm.length * 2)
    const view = new DataView(wav)
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
    }
    text(0, 'RIFF')
    view.setUint32(4, 36 + pcm.length * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcm[i]))
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }
    return new Blob([wav], { type: 'audio/wav' })
  } finally {
    await context.close().catch(() => {})
  }
}

export async function transcribeWithWhisper(audio: Blob): Promise<string> {
  const wav = await toWhisperWav(audio)
  const response = await fetch(`${BRIDGE_HTTP_URL}/stt`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: wav,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) {
    throw new Error(String(data.error ?? `Local Whisper returned HTTP ${response.status}`))
  }
  return String(data.text ?? '').trim()
}
