-- Additional fault types — run this in the Supabase SQL Editor.
--
-- 001 pinned fault_type to ('collapsed_wrist', 'arm_posture') with an inline
-- CHECK. Posting any other value fails the INSERT, and because faults are sent
-- as one batch, a single unknown type loses the whole session's fault data. So
-- this migration must be applied BEFORE the client starts emitting the new
-- types, not after.
--
-- Adds:
--   flat_fingers  — the finger arch has collapsed (fingers held straight).
--                   Finger SHAPE only; still no per-key detection anywhere.
--   back_posture  — torso leaning past ~15 degrees off vertical.
--
-- Not added: the side-view camera check. A bad camera angle is one static setup
-- mistake, not a moment-to-moment posture fault, so it gates the framing step in
-- the UI instead of writing a row every frame.

-- The inline CHECK from 001 gets an auto-generated name. Drop it by that name if
-- present, then re-add a named one so future migrations can target it directly.
alter table fault_events
  drop constraint if exists fault_events_fault_type_check;

alter table fault_events
  drop constraint if exists fault_events_fault_type_allowed;

alter table fault_events
  add constraint fault_events_fault_type_allowed
  check (fault_type in ('collapsed_wrist', 'arm_posture', 'flat_fingers', 'back_posture'));
