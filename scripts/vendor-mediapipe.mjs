#!/usr/bin/env node
/** Copy the pinned MediaPipe WASM runtime into Vite's same-origin public tree. */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const destination = join(ROOT, 'public', 'mediapipe')

export function vendorWasm() {
  if (!existsSync(source)) {
    console.warn('  MediaPipe is not installed; skipping the optional hand-tracking runtime.')
    return false
  }
  if (existsSync(join(destination, 'vision_wasm_internal.wasm'))) return true
  try {
    mkdirSync(destination, { recursive: true })
    cpSync(source, destination, { recursive: true })
    console.log('  vendored the hand-tracking runtime into public/mediapipe.')
    return true
  } catch (error) {
    console.warn(`  could not vendor the hand-tracking runtime: ${error.message}`)
    return false
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  vendorWasm()
}
