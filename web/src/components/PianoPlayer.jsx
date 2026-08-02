import { useEffect, useMemo, useRef, useState } from "react";
import PianoSynth from "../audio/PianoSynth";
import { SONGS, compileSong } from "../audio/songs";
import { setSongSource, suspendSongSource, clearSongSource } from "../audio/songBus";

// Audio scheduling: the classic "two clocks" pattern — a coarse JS timer queues
// notes onto the sample-accurate audio clock, so timing never depends on when
// the timer actually fires.
//
// The lookahead is deliberately generous. Browsers throttle setInterval in a
// backgrounded tab to roughly once a second; with a short lookahead every note
// due in that gap would be scheduled only after its time had passed, collapse
// onto `now`, and the piece would garble the moment you switched tabs. Staying
// well ahead of the worst-case timer gap keeps playback correct in the
// background. Pause/seek cancel whatever is already queued via stopAll().
const LOOKAHEAD_S = 1.5;
const TICK_MS = 25;

function fmt(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const Icon = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);
const PLAY = "M8 5v14l11-7z";
const PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";
const PREV = "M6 6h2v12H6zm3.5 6L18 6v12z";
const NEXT = "M16 6h2v12h-2zM6 18l8.5-6L6 6z";

export default function PianoPlayer() {
  const [songIdx, setSongIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // display only — strikes read the audio clock

  const synthRef = useRef(null);
  if (!synthRef.current) synthRef.current = new PianoSynth();
  const synth = synthRef.current;

  // Transport lives in a ref: the scheduler and the canvas both read it every
  // few milliseconds, far too often to route through React state.
  const transport = useRef({ startedAt: 0, offset: 0, playing: false, nextNote: 0 });

  const song = SONGS[songIdx];
  const compiled = useMemo(() => compileSong(song), [song]);

  // Live playback position, straight off the audio clock. This exact function is
  // what the canvas calls each frame, so the hand strikes the key at the same
  // instant the note sounds.
  const getTime = useRef(() => 0);
  getTime.current = () => {
    const tr = transport.current;
    return tr.playing ? synth.now() - tr.startedAt + tr.offset : tr.offset;
  };

  // ---- transport controls -------------------------------------------------
  // Stop sounding, but leave the song ATTACHED to the bus. Detaching it here is
  // what made the hand abandon its pose mid-bar and start air-playing the idle
  // phrase the instant you hit pause — the idle phrase runs on a free-running
  // clock with no relation to the music. Suspended, getTime() returns the frozen
  // offset, so the hand simply holds its last chord.
  function stopAudio() {
    synth.stopAll();
    transport.current.playing = false;
    suspendSongSource();
  }

  function startAt(seconds) {
    const ctx = synth.ensure();
    if (!ctx) return;
    synth.stopAll();
    const tr = transport.current;
    tr.offset = seconds;
    tr.startedAt = synth.now() + 0.06; // small lead so the first note isn't clipped
    tr.playing = true;
    tr.nextNote = compiled.notes.findIndex((n) => n.t >= seconds);
    if (tr.nextNote < 0) tr.nextNote = compiled.notes.length;
    setSongSource(compiled, () => getTime.current());
    setPlaying(true);
  }

  function pause() {
    const tr = transport.current;
    tr.offset = getTime.current();
    stopAudio();
    setPlaying(false);
  }

  function toggle() {
    if (playing) pause();
    else startAt(transport.current.offset >= compiled.duration ? 0 : transport.current.offset);
  }

  function jump(delta) {
    const wasPlaying = playing;
    stopAudio();
    clearSongSource(); // different piece — its key spans no longer apply
    setPlaying(false);
    transport.current.offset = 0;
    setPos(0);
    const next = (songIdx + delta + SONGS.length) % SONGS.length;
    setSongIdx(next);
    // the new song compiles on the next render — resume there
    if (wasPlaying) pendingPlay.current = true;
  }

  const pendingPlay = useRef(false);
  useEffect(() => {
    if (pendingPlay.current) {
      pendingPlay.current = false;
      startAt(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songIdx]);

  function seek(fraction) {
    const target = Math.max(0, Math.min(compiled.duration, fraction * compiled.duration));
    if (playing) startAt(target);
    else {
      transport.current.offset = target;
      setPos(target);
    }
  }

  // ---- note scheduler -----------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const tr = transport.current;
      if (!tr.playing) return;
      const at = getTime.current();

      while (
        tr.nextNote < compiled.notes.length &&
        compiled.notes[tr.nextNote].t < at + LOOKAHEAD_S
      ) {
        const n = compiled.notes[tr.nextNote];
        const when = tr.startedAt + n.t - tr.offset;
        synth.noteOn(n.midi, Math.max(when, synth.now()), n.dur);
        tr.nextNote++;
      }

      setPos(at);
      if (at >= compiled.duration) {
        // roll into the next piece, like any media player would
        const next = (songIdx + 1) % SONGS.length;
        stopAudio();
        transport.current.offset = 0;
        setPos(0);
        setSongIdx(next);
        pendingPlay.current = true;
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, compiled, songIdx]);

  // Tear down the audio context and hand the canvas back to its idle phrase.
  //
  // The `pagehide` listener matters on its own: React's unmount cleanup is not
  // guaranteed to run when the page is navigated away or reloaded, and notes are
  // queued on the audio clock up to LOOKAHEAD_S ahead with tails that ring for
  // seconds after that. Without this, a reload can leave the old page's audio
  // graph sounding. pagehide (not beforeunload) is the event that also fires on
  // mobile and when the page enters the back/forward cache.
  useEffect(() => {
    const kill = () => {
      // Reset the TRANSPORT as well as the context. As an unmount cleanup that
      // is redundant, but this same closure is the pagehide listener, where the
      // component stays mounted: closing the context while transport.playing
      // stayed true left getTime() reading a clock that had restarted at zero.
      transport.current.playing = false;
      transport.current.startedAt = 0;
      setPlaying(false);
      clearSongSource();
      synth.close();
    };
    window.addEventListener("pagehide", kill);
    return () => {
      window.removeEventListener("pagehide", kill);
      kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = compiled.duration ? Math.min(100, (pos / compiled.duration) * 100) : 0;

  const btn = {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 30,
    borderRadius: "var(--r-md)",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e9edee",
    cursor: "pointer",
    padding: 0,
    transition: "background var(--dur-fast) var(--ease-out)",
  };

  return (
    <div
      style={{
        width: 292,
        padding: "14px 16px 15px",
        borderRadius: "var(--r-xl)",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(18,24,30,0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        color: "#e9edee",
        userSelect: "none",
      }}
    >
      <style>{`
        .vn-pp-btn:hover { background: rgba(255,255,255,0.13) !important; }
        .vn-pp-btn:active { background: rgba(255,255,255,0.2) !important; }
      `}</style>

      <div style={{ marginBottom: 11 }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {song.title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "rgba(233,237,238,0.55)", marginTop: 1 }}>
          {song.composer} · public domain
        </div>
      </div>

      {/* progress */}
      <div
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / r.width);
        }}
        style={{ cursor: "pointer", padding: "5px 0" }}
      >
        <div style={{ height: 3, borderRadius: 999, background: "rgba(255,255,255,0.15)" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 999,
              background: "#e9edee",
              transition: "width 120ms linear",
            }}
          />
        </div>
      </div>

      <div
        className="vn-data"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "rgba(233,237,238,0.55)",
          marginTop: 3,
        }}
      >
        <span>{fmt(pos)}</span>
        <span>{fmt(compiled.duration)}</span>
      </div>

      {/* controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
        <button className="vn-pp-btn" style={btn} onClick={() => jump(-1)} aria-label="Previous song">
          <Icon d={PREV} />
        </button>
        <button
          className="vn-pp-btn"
          style={{ ...btn, width: 38, height: 38, background: "rgba(255,255,255,0.12)" }}
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          <Icon d={playing ? PAUSE : PLAY} size={17} />
        </button>
        <button className="vn-pp-btn" style={btn} onClick={() => jump(1)} aria-label="Next song">
          <Icon d={NEXT} />
        </button>
      </div>
    </div>
  );
}
