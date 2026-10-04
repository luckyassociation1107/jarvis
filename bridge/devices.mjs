/**
 * JARVIS Multi-Device Control — phone, smart home, other PCs.
 *
 * Control everything from one JARVIS:
 *   - Phone: notifications, calls, messages (via ADB/scrcpy)
 *   - Smart home: lights, AC, TV (via MQTT/Home Assistant)
 *   - Other computers: SSH, remote desktop
 *   - IoT: any device on your network
 */

import { execSync, spawn } from 'node:child_process'
import { platform } from 'node:os'

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 10_000 }).trim() } catch { return null } }

/* ──────────────── Phone control (ADB) ──────────────────────────── */

/**
 * Check if a phone is connected via ADB.
 */
export function isPhoneConnected() {
  const out = sh('adb devices 2>/dev/null')
  return out?.includes('device') && !out.includes('List of')
}

/**
 * Get phone notifications.
 */
export function getPhoneNotifications() {
  if (!isPhoneConnected()) return { ok: false, error: 'No phone connected. Connect via USB or WiFi ADB.' }
  const out = sh('adb shell dumpsys notification --noredact 2>/dev/null | grep -A2 "NotificationRecord" | head -30')
  return { ok: true, notifications: out ?? 'No notifications found' }
}

/**
 * Send a command to the phone.
 */
export function phoneCommand(command) {
  if (!isPhoneConnected()) return { ok: false, error: 'No phone connected' }

  const commands = {
    screenshot: 'adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png /tmp/phone-screen.png',
    home: 'adb shell input keyevent KEYCODE_HOME',
    back: 'adb shell input keyevent KEYCODE_BACK',
    power: 'adb shell input keyevent KEYCODE_POWER',
    volume_up: 'adb shell input keyevent KEYCODE_VOLUME_UP',
    volume_down: 'adb shell input keyevent KEYCODE_VOLUME_DOWN',
    mute: 'adb shell input keyevent KEYCODE_VOLUME_MUTE',
    play: 'adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE',
    next: 'adb shell input keyevent KEYCODE_MEDIA_NEXT',
    prev: 'adb shell input keyevent KEYCODE_MEDIA_PREVIOUS',
    open: (url) => `adb shell am start -a android.intent.action.VIEW -d "${url}"`,
    call: (num) => `adb shell am start -a android.intent.action.CALL -d tel:${num}`,
    sms: (num, msg) => `adb shell am start -a android.intent.action.SENDTO -d sms:${num} --es sms_body "${msg}"`,
    wifi_on: 'adb shell svc wifi enable',
    wifi_off: 'adb shell svc wifi disable',
    bluetooth_on: 'adb shell svc bluetooth enable',
    bluetooth_off: 'adb shell svc bluetooth disable',
    flashlight_on: 'adb shell cmd camera flashlight on',
    flashlight_off: 'adb shell cmd camera flashlight off',
  }

  const cmd = commands[command]
  if (!cmd) return { ok: false, error: `Unknown phone command: ${command}` }
  const out = typeof cmd === 'function' ? sh(cmd()) : sh(cmd)
  return { ok: true, result: out }
}

/* ──────────────── Smart Home (Home Assistant) ──────────────────────────── */

const HA_URL = process.env.HOME_ASSISTANT_URL ?? 'http://homeassistant.local:8123'
const HA_TOKEN = process.env.HOME_ASSISTANT_TOKEN ?? ''

async function haRequest(endpoint, method = 'GET', body = null) {
  const headers = { 'Authorization': `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' }
  const opts = { method, headers, signal: AbortSignal.timeout(5000) }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${HA_URL}/api${endpoint}`, opts)
  return res.json()
}

/**
 * Control a smart home device.
 */
export async function smartHomeControl(entityId, action, value = null) {
  if (!HA_TOKEN) return { ok: false, error: 'Home Assistant not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN.' }

  const domain = entityId.split('.')[0]
  const services = {
    light: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' },
    switch: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' },
    climate: { set_temperature: 'set_temperature', turn_on: 'turn_on', turn_off: 'turn_off' },
    media_player: { play: 'media_play', pause: 'media_pause', next: 'media_next_track', volume_set: 'volume_set' },
    cover: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' },
    lock: { lock: 'lock', unlock: 'unlock' },
  }

  const service = services[domain]?.[action]
  if (!service) return { ok: false, error: `Unknown action ${action} for ${domain}` }

  try {
    const data = value ? { entity_id: entityId, ...value } : { entity_id: entityId }
    const result = await haRequest(`/services/${domain}/${service}`, 'POST', data)
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/* ──────────────── Network scanning ──────────────────────────── */

/**
 * Scan local network for devices.
 */
export function scanNetwork() {
  const out = sh('ip neigh show 2>/dev/null || arp -a 2>/dev/null')
  if (!out) return { ok: false, error: 'Cannot scan network' }

  const devices = out.split('\n').filter(Boolean).map((line) => {
    const parts = line.split(/\s+/)
    return { ip: parts[0], mac: parts[parts.indexOf('lladdr') + 1] ?? parts[4] ?? '', status: line.includes('REACHABLE') ? 'online' : 'unknown' }
  }).filter((d) => d.ip && d.ip.match(/\d+\.\d+\.\d+\.\d+/))

  return { ok: true, devices }
}

export default { isPhoneConnected, getPhoneNotifications, phoneCommand, smartHomeControl, scanNetwork }