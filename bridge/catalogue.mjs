/**
 * The catalogue.
 *
 * The planner answers "which models does this machine get?" — one answer,
 * derived from RAM. This module answers the other question: *what could this
 * machine get?* Every rung the project knows about, for the three jobs a person
 * actually asks about — chat, vision, and coding/reasoning — with the numbers
 * that make choosing possible: download size, resident size, parameter count,
 * quantization, and whether this machine has the RAM and the disk for it.
 *
 * Nothing here downloads or decides anything. The choice is the person's; this
 * is the shop window, and `installSelection()` in `autopilot.mjs` is the till.
 */
import { mkdirSync, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  LADDERS,
  availableRam,
  plan,
  totalRam,
} from './autopilot.mjs'

const GB = 1024 ** 3

/**
 * The three jobs, and the ladder behind each.
 *
 * `coder` reads from the ladder the planner calls `reason`: coding, tool use and
 * technical reasoning are one job in this project, and the models that do it are
 * the ones that can hold a project in their head and argue with themselves about
 * it. Vision is separate because only a multimodal model can look at a screenshot
 * at all.
 */
export const USER_SLOTS = Object.freeze([
  {
    id: 'chat',
    ladder: 'chat',
    label: 'Chat',
    purpose: 'abliterated multilingual chat, intent extraction and translation',
  },
  {
    id: 'vision',
    ladder: 'vision',
    label: 'Vision',
    purpose: 'a model that reads screenshots and images, natively multimodal',
    requiresMultimodal: true,
  },
  {
    id: 'coder',
    ladder: 'reason',
    label: 'Coder & reasoning',
    purpose: 'abliterated reasoning and self-debate for building whole projects',
  },
])

const DEFAULT_SELECTION_PATH = 'models/model-selection.json'

/** Where the chosen three live. `JARVIS_MODEL_SELECTION` points it elsewhere. */
export function selectionPath(env = process.env) {
  return resolve(env.JARVIS_MODEL_SELECTION ?? DEFAULT_SELECTION_PATH)
}

/** Free space on the volume holding `path`, in gigabytes, or null if unknown. */
export function freeDiskGb(path = process.cwd()) {
  try {
    const fs = statfsSync(resolve(path))
    const available = Number(fs?.bavail)
    const size = Number(fs?.bsize)
    if (!Number.isFinite(available) || !Number.isFinite(size) || size <= 0) return null
    return (available * size) / GB
  } catch {
    return null
  }
}

/**
 * Every entry, with the two fits a person cares about.
 *
 * RAM is judged against the same ceiling the planner uses — one model resident
 * at a time, inside the user's share — so the catalogue and the plan cannot
 * disagree about what "fits" means. Disk is judged with a reserve left over, so
 * filling the machine with weights does not leave it unable to run.
 */
export function catalogue(options = {}) {
  const p = options.plan ?? plan()
  const freeDisk = options.freeDiskGb ?? freeDiskGb(options.diskPath ?? process.cwd())
  const reserveGb = options.reserveGb ?? 2
  const ceiling = p.budget.models
  const diskRoomGb = freeDisk === null ? null : Math.max(0, freeDisk - reserveGb)

  const slots = USER_SLOTS.map((slot) => {
    const entries = (LADDERS[slot.ladder] ?? [])
      .filter((rung) => rung.model)
      .map((rung) => {
        const downloadGb = Number((rung.bytes / GB).toFixed(2))
        const residentGb = Number((rung.residentBytes / GB).toFixed(2))
        const fitsRam = rung.residentBytes <= ceiling
        const fitsDisk = diskRoomGb === null ? null : downloadGb <= diskRoomGb
        return {
          id: rung.model,
          slot: slot.id,
          model: rung.model,
          parametersB: rung.parametersB ?? null,
          quant: rung.quant ?? null,
          downloadGb,
          residentGb,
          quality: rung.quality ?? null,
          multimodal: rung.multimodal === true,
          multilingual: rung.multilingual === true,
          // True for the mandatory tiny set: rows the person asked for by name
          // rather than rungs the planner chose.
          namedByUser: rung.namedByUser === true,
          note: rung.note ?? null,
          fitsRam,
          fitsDisk,
          // Unknown disk is not a reason to hide a model: the RAM fit stands.
          fits: fitsRam && fitsDisk !== false,
        }
      })
      .sort((a, b) => a.downloadGb - b.downloadGb || a.residentGb - b.residentGb)
    return {
      ...slot,
      entries,
      smallest: entries[0]?.model ?? null,
      // The catalogue opens on the small end on purpose: a first run should be
      // minutes, not hours, and the big rungs are still one click away.
      defaultModel: entries[0]?.model ?? null,
    }
  })

  return {
    machine: {
      totalRamGb: Number((totalRam() / GB).toFixed(1)),
      freeRamGb: Number((availableRam() / GB).toFixed(1)),
      freeDiskGb: freeDisk === null ? null : Number(freeDisk.toFixed(1)),
      diskReserveGb: reserveGb,
      sharePercent: p.budget.sharePercent,
      capGb: p.budget.capGb ?? null,
      budgetGb: Number((ceiling / GB).toFixed(2)),
    },
    filters: {
      quants: [...new Set(slots.flatMap((slot) => slot.entries.map((entry) => entry.quant)).filter(Boolean))].sort(),
      maxDownloadGb: Math.max(...slots.flatMap((slot) => slot.entries.map((entry) => entry.downloadGb)), 0),
      maxParametersB: Math.max(...slots.flatMap((slot) => slot.entries.map((entry) => entry.parametersB ?? 0)), 0),
    },
    slots,
  }
}

/**
 * The catalogue, narrowed by whatever the person typed into the filter row.
 *
 * Filters only ever hide; they never change an entry's numbers, and a filter
 * that matches nothing returns an empty list rather than silently relaxing
 * itself — an empty column is information about the machine, not a bug.
 */
export function filterCatalogue(slots, filters = {}) {
  const maxDownloadGb = Number(filters.maxDownloadGb ?? Infinity)
  const maxResidentGb = Number(filters.maxResidentGb ?? Infinity)
  const maxParametersB = Number(filters.maxParametersB ?? Infinity)
  const minQuality = Number(filters.minQuality ?? -Infinity)
  const quants = Array.isArray(filters.quants) && filters.quants.length ? new Set(filters.quants) : null
  const fitOnly = filters.fitOnly === true
  const search = String(filters.search ?? '').trim().toLowerCase()

  return slots.map((slot) => ({
    ...slot,
    entries: slot.entries.filter((entry) => {
      if (Number.isFinite(maxDownloadGb) && entry.downloadGb > maxDownloadGb) return false
      if (Number.isFinite(maxResidentGb) && entry.residentGb > maxResidentGb) return false
      if (Number.isFinite(maxParametersB) && (entry.parametersB ?? 0) > maxParametersB) return false
      if (Number.isFinite(minQuality) && (entry.quality ?? 0) < minQuality) return false
      if (quants && !quants.has(entry.quant)) return false
      if (fitOnly && !entry.fits) return false
      if (search && !entry.model.toLowerCase().includes(search)) return false
      return true
    }),
  }))
}

/** The smallest rung in each slot: what the setup page opens with. */
export function defaultSelection(cat = catalogue()) {
  return Object.fromEntries(cat.slots.map((slot) => [slot.id, slot.defaultModel]))
}

/**
 * The saved three, cached until the file changes.
 *
 * `modelFor()` asks for this on every turn and every probe, so it cannot be a
 * disk read each time; and it must not be a value frozen at import, because the
 * setup window can change the choice while the bridge is running.
 */
let selectionCache = { file: null, stamp: null, value: null }

/** Read the saved three. Missing or unreadable means "nothing chosen yet". */
export function readSelection(env = process.env) {
  const file = selectionPath(env)
  try {
    const { mtimeMs, size } = statSync(file)
    const stamp = `${mtimeMs}:${size}`
    if (selectionCache.file === file && selectionCache.stamp === stamp) return selectionCache.value
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const chosen = {}
    for (const slot of USER_SLOTS) {
      if (typeof raw?.[slot.id] === 'string' && raw[slot.id]) chosen[slot.id] = raw[slot.id]
    }
    const value = Object.keys(chosen).length ? { ...chosen, chosenAt: raw.chosenAt ?? null } : null
    selectionCache = { file, stamp, value }
    return value
  } catch {
    selectionCache = { file, stamp: null, value: null }
    return null
  }
}

/**
 * Save the chosen three, refusing anything that is not in the catalogue.
 *
 * A tag that no ladder in that slot carries is a typo or a stale page, and
 * writing it would send the bridge looking for weights that do not exist.
 */
export function writeSelection(selection, env = process.env) {
  const cat = catalogue()
  const chosen = {}
  for (const slot of cat.slots) {
    const wanted = selection?.[slot.id]
    if (!wanted) throw new Error(`no ${slot.id} model was chosen; all three slots are required`)
    const entry = slot.entries.find((candidate) => candidate.id === wanted)
    if (!entry) throw new Error(`${wanted} is not a ${slot.id} model in the catalogue`)
    if (slot.requiresMultimodal && !entry.multimodal) {
      throw new Error(`${wanted} cannot see images, so it cannot fill the vision slot`)
    }
    chosen[slot.id] = entry.id
  }
  const payload = { ...chosen, chosenAt: new Date().toISOString() }
  const file = selectionPath(env)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

/** The tag chosen for one of the three slots, in pipeline terms. */
export function chosenModel(slot, env = process.env) {
  const selection = readSelection(env)
  if (!selection) return null
  const userSlot = USER_SLOTS.find((candidate) => candidate.id === slot)?.id
    // The bridge asks for `reason`, the person chose `coder`.
    ?? (slot === 'reason' ? 'coder' : null)
  return userSlot ? selection[userSlot] ?? null : null
}
