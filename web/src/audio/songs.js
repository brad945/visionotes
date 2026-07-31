/**
 * Public-domain piano melodies for the login hero.
 *
 * COPYRIGHT: every piece here is a public-domain composition — Bach (d. 1750)
 * and Beethoven (d. 1827), all published long before 1928. The audio is
 * SYNTHESIZED in-browser from these note numbers (see PianoSynth.js), so there
 * is no sound-recording copyright either: no sample, no master, nothing
 * licensed. The note data below was transcribed by hand from the melody line.
 *
 * Authoring format — a song is `{ id, title, composer, step, notes }` where
 * `notes` is `[unit, midi, durUnits]` and `step` is the seconds per unit. Times
 * in units keep the data readable (unit = one sixteenth / eighth / quarter,
 * whatever the piece wants); compileSong() converts to seconds.
 */

// [unit, midiPitch, durationInUnits]
export const SONGS = [
  {
    id: "fur-elise",
    title: "Für Elise",
    composer: "Beethoven",
    step: 0.165, // one sixteenth
    notes: [
      [0, 76, 1], [1, 75, 1], [2, 76, 1], [3, 75, 1], [4, 76, 1],
      [5, 71, 1], [6, 74, 1], [7, 72, 1], [8, 69, 3],
      [11, 60, 1], [12, 64, 1], [13, 69, 1], [14, 71, 3],
      [17, 64, 1], [18, 68, 1], [19, 71, 1], [20, 72, 3],
      [23, 64, 1], [24, 76, 1], [25, 75, 1], [26, 76, 1], [27, 75, 1],
      [28, 76, 1], [29, 71, 1], [30, 74, 1], [31, 72, 1], [32, 69, 3],
      [35, 60, 1], [36, 64, 1], [37, 69, 1], [38, 71, 3],
      [41, 64, 1], [42, 72, 1], [43, 71, 1], [44, 69, 6],
    ],
  },
  {
    id: "minuet-in-g",
    title: "Minuet in G",
    composer: "Bach",
    step: 0.21, // one eighth
    notes: [
      [0, 74, 2], [2, 67, 1], [3, 69, 1], [4, 71, 1], [5, 72, 1],
      [6, 74, 2], [8, 67, 2], [10, 67, 2],
      [12, 76, 2], [14, 72, 1], [15, 74, 1], [16, 76, 1], [17, 78, 1],
      [18, 79, 2], [20, 67, 2], [22, 67, 2],
      [24, 72, 2], [26, 74, 1], [27, 72, 1], [28, 71, 1], [29, 69, 1],
      [30, 71, 2], [32, 72, 1], [33, 71, 1], [34, 69, 1], [35, 67, 1],
      [36, 66, 2], [38, 67, 1], [39, 69, 1], [40, 71, 2],
      [42, 67, 2], [44, 67, 4],
    ],
  },
  {
    id: "ode-to-joy",
    title: "Ode to Joy",
    composer: "Beethoven",
    step: 0.42, // one quarter
    notes: [
      [0, 64, 1], [1, 64, 1], [2, 65, 1], [3, 67, 1],
      [4, 67, 1], [5, 65, 1], [6, 64, 1], [7, 62, 1],
      [8, 60, 1], [9, 60, 1], [10, 62, 1], [11, 64, 1],
      [12, 64, 1.5], [13.5, 62, 0.5], [14, 62, 2],
      [16, 64, 1], [17, 64, 1], [18, 65, 1], [19, 67, 1],
      [20, 67, 1], [21, 65, 1], [22, 64, 1], [23, 62, 1],
      [24, 60, 1], [25, 60, 1], [26, 62, 1], [27, 64, 1],
      [28, 62, 1.5], [29.5, 60, 0.5], [30, 60, 2],
    ],
  },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Turn authoring data into everything the player and the canvas need.
 *
 * FINGER ASSIGNMENT IS GESTURAL, NOT PITCH-ACCURATE — and that is deliberate.
 * The hand only drifts ~±26px (PIANO_SHIFT × 2) while these melodies span two
 * octaves, and the keyboard is sized and placed relative to the hand, so
 * literally tracking pitch would slide the hand out from under its own keys.
 * Instead each note's pitch is ranked inside the song's own range and mapped to
 * one of the five fingers: the eye reads the RHYTHM and the CONTOUR (melody up
 * → hand drifts right), while the audio carries the true pitch.
 *
 * Returns { notes, events, strikeTimes, duration } with all times in SECONDS.
 */
export function compileSong(song) {
  const { step } = song;
  const pitches = song.notes.map(([, midi]) => midi);
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const span = Math.max(1, hi - lo);

  const notes = song.notes
    .map(([unit, midi, durUnits]) => ({
      t: unit * step,
      midi,
      dur: durUnits * step,
      finger: Math.round(((midi - lo) / span) * 4),
    }))
    .sort((a, b) => a.t - b.t);

  // A real player wouldn't repeat a finger across a pitch change (think of the
  // E–D# trill that opens Für Elise: it alternates 4–3). Where the rank mapping
  // lands two different pitches on the same finger, nudge one step in the
  // direction the melody moved so the alternation is visible.
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1];
    const cur = notes[i];
    if (cur.midi !== prev.midi && cur.finger === prev.finger) {
      const dir = cur.midi > prev.midi ? 1 : -1;
      let f = prev.finger + dir;
      // Already on the outermost finger — stepping further would clamp back onto
      // the same one and the strike would read as a repeat. Go the other way
      // instead: a real player shifts hand position rather than restriking a
      // finger that is still on its way up.
      if (f < 0 || f > 4) f = prev.finger - dir;
      cur.finger = clamp(f, 0, 4);
    }
  }

  // Group notes that strike together into events, matching the shape of the
  // idle PIANO_PHRASE: `lat` (mean finger, centred on the middle finger) is what
  // drives the hand's lateral drift along the keyboard.
  const byTime = new Map();
  for (const n of notes) {
    const key = n.t.toFixed(4);
    if (!byTime.has(key)) byTime.set(key, { t: n.t, f: [] });
    byTime.get(key).f.push(n.finger);
  }
  const events = [...byTime.values()].sort((a, b) => a.t - b.t);
  for (const ev of events) {
    ev.lat = ev.f.reduce((s, x) => s + x, 0) / ev.f.length - 2;
  }

  const strikeTimes = [[], [], [], [], []];
  for (const n of notes) strikeTimes[n.finger].push(n.t);
  for (const arr of strikeTimes) arr.sort((a, b) => a - b);

  // Let the last note ring out rather than cutting the song off on its attack.
  const last = notes[notes.length - 1];
  const duration = last.t + Math.max(last.dur, 0.6) + 0.5;

  return { notes, events, strikeTimes, duration };
}
