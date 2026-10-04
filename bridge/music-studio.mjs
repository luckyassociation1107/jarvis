/**
 * JARVIS Music Studio — not just playing music. CREATING it.
 *
 * Full music production AI:
 *   - Compose melodies, harmonies, rhythms
 *   - Generate full arrangements (any genre)
 *   - Produce mixing/mastering instructions
 *   - Create music theory analysis
 *   - Generate chord progressions
 *   - Write tablature and sheet music notation
 *   - DJ set planning and mashup creation
 *   - Sound design (describe a sound → synthesis parameters)
 *
 * "I don't just play your playlist. I compose the soundtrack of your life."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Composition engine ──────────────────────────── */

/**
 * Compose a full piece of music.
 */
export async function compose({ 
  genre = 'ambient',
  mood = 'peaceful',
  tempo = 'medium',
  key = 'C major',
  duration = '3 minutes',
  instruments = ['piano', 'strings'],
  inspiration = '',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `You are a master composer and music producer. Create a complete musical composition.

Output a detailed composition plan including:
1. Structure (intro, verse, chorus, bridge, outro)
2. Chord progressions for each section
3. Melody description (contour, range, motifs)
4. Rhythm pattern and time signature
5. Arrangement (which instruments play when)
6. Dynamics (loud/soft, builds, drops)
7. Production notes (reverb, delay, EQ suggestions)

Genre conventions: ${genre}
Mood: ${mood}
Tempo: ${tempo}
Key: ${key}

Make it MUSICAL. Not just notes — emotion.` },
    { role: 'user', content: `Compose a ${duration} ${genre} piece.\nMood: ${mood}\nKey: ${key}\nInstruments: ${instruments.join(', ')}${inspiration ? `\nInspired by: ${inspiration}` : ''}\n\nFull composition:` },
  ], { maxTokens: 2000 })

  return { genre, mood, key, tempo, composition: response }
}

/* ──────────────── Chord progressions ──────────────────────────── */

/**
 * Generate chord progressions for any mood/genre.
 */
export async function generateChords({ 
  key = 'C major',
  mood = 'happy',
  genre = 'pop',
  complexity = 'medium',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate chord progressions. Include:
1. 3-5 progression options (Roman numeral notation)
2. Actual chords in the specified key
3. Emotional quality of each progression
4. Genre-specific variations
5. Suggested bass line outline
6. Common songs that use similar progressions

Key: ${key}
Complexity: ${complexity}` },
    { role: 'user', content: `Generate ${mood} chord progressions in ${key} for ${genre}:` },
  ], { maxTokens: 600 })

  return { key, mood, genre, progressions: response }
}

/* ──────────────── Sound design ──────────────────────────── */

/**
 * Describe a sound → get synthesis parameters.
 */
export async function designSound(description, { 
  synthesizer = 'general',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a sound design expert. Translate a sound description into synthesis parameters.

For any synthesizer:
- Oscillator: type (saw, square, sine, noise), detune, unison
- Filter: type, cutoff, resonance, envelope
- Envelope: ADSR for amplitude and filter
- Effects: reverb, delay, distortion, chorus, phaser
- LFO: rate, depth, target

Describe the SOUND first (what it reminds you of, texture, movement), then the parameters.` },
    { role: 'user', content: `Sound: "${description}"\nSynthesizer: ${synthesizer}\n\nSynthesis parameters:` },
  ], { maxTokens: 500 })

  return { description, parameters: response }
}

/* ──────────────── Music analysis ──────────────────────────── */

/**
 * Analyze a piece of music theoretically.
 */
export async function analyzeMusic(description, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Provide a detailed music theory analysis:
1. Key and mode
2. Time signature and rhythm
3. Chord progression analysis
4. Melodic contour and motifs
5. Harmonic rhythm
6. Form and structure
7. Notable techniques used
8. Emotional arc
9. Production techniques heard
10. Similar artists/songs` },
    { role: 'user', content: `Analyze: ${description}\n\nDetailed analysis:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── Lyrics + Melody pairing ──────────────────────────── */

/**
 * Create lyrics fitted to a melody or vice versa.
 */
export async function fitLyricsToMelody(lyrics, { 
  melodyDescription = '',
  genre = 'pop',
  llm = complete,
} = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Fit lyrics to melody. Consider:
- Syllable count per phrase
- Stressed and unstressed syllables
- Natural speech rhythm
- Rhyme scheme alignment
- Emotional peaks matching melodic peaks
- Breathing points

If melody is provided, match lyrics to it.
If lyrics are provided, suggest melodic contour.` },
    { role: 'user', content: `Lyrics:\n${lyrics}${melodyDescription ? `\nMelody: ${melodyDescription}` : ''}\nGenre: ${genre}\n\nFitted arrangement:` },
  ], { maxTokens: 800 })

  return response
}

/* ──────────────── DJ and mixing ──────────────────────────── */

/**
 * Plan a DJ set or create a mashup concept.
 */
export async function planDJSet({ 
  genre = 'house',
  duration = '60 minutes',
  energy = 'building',
  tracks = [],
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Plan a DJ set. Include:
1. Track order (energy flow)
2. Transition types between tracks
3. Key compatibility (Camelot wheel)
4. BPM matching/gradual changes
5. Energy arc (warmup → peak → cooldown)
6. Mix points (where to mix in/out)
7. Effects to use during transitions

Genre: ${genre}
Duration: ${duration}
Energy flow: ${energy}` },
    { role: 'user', content: `${tracks.length ? `Tracks: ${tracks.join(', ')}` : 'Select appropriate tracks'}\n\nDJ set plan:` },
  ], { maxTokens: 1000 })

  return { genre, duration, plan: response }
}

/**
 * Generate MIDI-like note data for a melody.
 */
export function generateMelodyPattern({ key = 'C', scale = 'major', bars = 4, pattern = 'random_walk' } = {}) {
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
  }

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const baseNote = noteNames.indexOf(key)
  const scaleIntervals = scales[scale] || scales.major
  const scaleNotes = scaleIntervals.map((i) => (baseNote + i) % 12)

  const notes = []
  let currentNote = 0

  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      if (pattern === 'random_walk') {
        currentNote += Math.floor(Math.random() * 5) - 2
        currentNote = Math.max(0, Math.min(scaleNotes.length - 1, currentNote))
      } else if (pattern === 'ascending') {
        currentNote = (bar * 4 + beat) % scaleNotes.length
      } else if (pattern === 'descending') {
        currentNote = (scaleNotes.length - 1 - ((bar * 4 + beat) % scaleNotes.length))
      }

      notes.push({
        note: noteNames[scaleNotes[currentNote]],
        midi: scaleNotes[currentNote] + 60,
        beat: bar * 4 + beat + 1,
        duration: 'quarter',
      })
    }
  }

  return { key, scale, bars, pattern, notes }
}

export default { compose, generateChords, designSound, analyzeMusic, fitLyricsToMelody, planDJSet, generateMelodyPattern }