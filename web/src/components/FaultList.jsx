// FaultList.jsx
// ---------------------------------------------------------------------------
// Live posture-fault feed, built as an accessible WAI-ARIA listbox.
//
// Pattern (per the ARIA Authoring Practices "Listbox"):
//   - container role="listbox", children role="option"
//   - roving tabindex: exactly ONE option is in the tab order at a time
//   - ArrowUp/ArrowDown move the active option; Home/End jump to ends
//   - aria-selected tracks the active option; focus follows it for SR users
//   - aria-live region announces newly-flagged faults without stealing focus
//
// Styling uses the VisioNotes design tokens (see styles/tokens.css). Severity
// stays in the Clay family (the Clay-Means-Fault rule) and is also conveyed by
// the dot SHAPE (filled vs. ring), so it never relies on color alone.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * @param {Object} props
 * @param {Array<{id:string, label:string, severity:"warn"|"error"}>} props.faults
 *   `id` must be STABLE across frames (derive from fault identity, not index/time)
 *   or keyboard focus/active-option resets every update.
 * @param {(id:string)=>void} [props.onSelect] - called when an option is activated
 */
export default function FaultList({ faults = [], onSelect }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef([]);
  const listRef = useRef(null);

  // Keep activeIndex in range when the list shrinks.
  useEffect(() => {
    if (activeIndex > faults.length - 1) {
      setActiveIndex(Math.max(0, faults.length - 1));
    }
  }, [faults.length, activeIndex]);

  // Move DOM focus to the active option so SR users hear the change — but only
  // if focus is already inside the listbox, so streaming faults don't yank focus
  // from elsewhere on the page.
  useEffect(() => {
    const node = optionRefs.current[activeIndex];
    if (node && listRef.current?.contains(document.activeElement)) {
      node.focus();
    }
  }, [activeIndex, faults.length]);

  const activate = useCallback(
    (index) => {
      const fault = faults[index];
      if (fault && onSelect) onSelect(fault.id);
    },
    [faults, onSelect]
  );

  const onKeyDown = useCallback(
    (e) => {
      if (faults.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, faults.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(faults.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          activate(activeIndex);
          break;
        case "Escape":
          e.preventDefault();
          listRef.current?.blur();
          break;
        default:
          break;
      }
    },
    [faults.length, activeIndex, activate]
  );

  if (faults.length === 0) {
    return (
      <p style={styles.empty} role="status">
        No posture faults right now. Keep playing.
      </p>
    );
  }

  return (
    <>
      {/* Polite live region: announces the most recent fault without stealing focus */}
      <div aria-live="polite" style={styles.srOnly}>
        {faults.length > 0 ? `${faults[faults.length - 1].label} detected` : ""}
      </div>

      <ul
        ref={listRef}
        role="listbox"
        aria-label="Detected posture faults"
        aria-activedescendant={faults[activeIndex] ? `fault-${faults[activeIndex].id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={styles.list}
      >
        {faults.map((fault, i) => {
          const isActive = i === activeIndex;
          return (
            <li
              key={fault.id}
              id={`fault-${fault.id}`}
              ref={(el) => (optionRefs.current[i] = el)}
              role="option"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                setActiveIndex(i);
                activate(i);
              }}
              style={{
                ...styles.option,
                ...(isActive ? styles.optionActive : null),
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  ...styles.dot,
                  // error = filled clay; warn = clay ring. Shape carries severity,
                  // not hue alone.
                  background: fault.severity === "error" ? "var(--signal)" : "transparent",
                  border: `1.5px solid var(--signal)`,
                }}
              />
              <span style={styles.label}>{fault.label}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Inline styles backed by design tokens (the repo uses inline styles + CSS-var
// tokens, not Tailwind).
const styles = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 4,
    maxHeight: 280,
    overflowY: "auto",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    background: "var(--surface)",
    outline: "none",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: "var(--r-md)",
    cursor: "pointer",
    fontSize: 14,
    color: "var(--ink)",
    outline: "none",
  },
  optionActive: {
    boxShadow: "0 0 0 2px var(--accent)", // visible selection/focus ring
    background: "var(--surface-sunken)",
  },
  label: {
    color: "var(--signal)",
    fontWeight: 500,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
    boxSizing: "border-box",
  },
  empty: {
    color: "var(--ink-muted)",
    fontSize: 14,
    padding: 12,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  },
};
