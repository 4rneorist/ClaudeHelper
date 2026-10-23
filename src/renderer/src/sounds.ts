import type { SoundName } from '../../shared/ipc'

// Short sounds, synthesized so no sound files ship with the app. By default "chime" plays when
// Claude finishes and "rise" when it asks for your answer; Settings can pick any for either.

interface Note {
  /** Hz. */
  freq: number
  /** Seconds from the start of the sound. */
  at: number
  length: number
  /** Share of the sound's volume, 1 when left out. */
  level?: number
}

const SOUNDS: Record<SoundName, { label: string; wave: OscillatorType; notes: Note[] }> = {
  chime: {
    label: 'Chime (soft, falling)',
    wave: 'sine',
    notes: [
      { freq: 784, at: 0, length: 0.18 }, // G5
      { freq: 523, at: 0.15, length: 0.35 } // C5
    ]
  },
  rise: {
    label: 'Rise (bright, three notes)',
    wave: 'triangle',
    notes: [
      { freq: 880, at: 0, length: 0.11 }, // A5
      { freq: 1175, at: 0.13, length: 0.11 }, // D6
      { freq: 1568, at: 0.26, length: 0.22 } // G6
    ]
  },
  bell: {
    label: 'Bell (one long ring)',
    wave: 'sine',
    notes: [
      { freq: 1319, at: 0, length: 1.2 }, // E6
      { freq: 2638, at: 0, length: 0.6, level: 0.3 } // its overtone
    ]
  },
  blip: {
    label: 'Blip (two soft taps)',
    wave: 'sine',
    notes: [
      { freq: 1047, at: 0, length: 0.07 }, // C6
      { freq: 1047, at: 0.12, length: 0.07 }
    ]
  },
  knock: {
    label: 'Knock (two low taps)',
    wave: 'triangle',
    notes: [
      { freq: 220, at: 0, length: 0.09 }, // A3
      { freq: 196, at: 0.14, length: 0.12 } // G3
    ]
  }
}

export const SOUND_LABELS = Object.fromEntries(
  Object.entries(SOUNDS).map(([name, sound]) => [name, sound.label])
) as Record<SoundName, string>

/** Peak level at full volume; the slider (0–100) scales it. */
const MAX_LEVEL = 0.3

let context: AudioContext | null = null

export function playSound(name: SoundName, volume: number): void {
  const sound = SOUNDS[name]
  if (!sound || volume <= 0) return
  try {
    context ??= new AudioContext()
    void context.resume()
    const peak = (MAX_LEVEL * Math.min(100, volume)) / 100
    const start = context.currentTime + 0.02
    for (const note of sound.notes) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      const t = start + note.at
      osc.type = sound.wave
      osc.frequency.value = note.freq
      // A quick fade in and a ringing fade out, so the notes don't click.
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(peak * (note.level ?? 1), t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.length)
      osc.connect(gain).connect(context.destination)
      osc.start(t)
      osc.stop(t + note.length + 0.02)
    }
  } catch {
    // No audio device: stay silent.
  }
}
