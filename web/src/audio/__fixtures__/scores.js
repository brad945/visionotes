/**
 * SCORE GROUND TRUTH — do not hand-edit to make a test pass.
 *
 * Transcribed independently by two agents each, from machine-readable editions
 * of the public-domain score, then compared note by note:
 *
 *   Für Elise, WoO 59 (Beethoven) — Mutopia Project LilyPond source, typeset
 *     from Breitkopf & Härtel 1888. Anacrusis through m. 8.
 *     https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly
 *     Both transcriptions agreed on all 53 notes except the length of the final
 *     RH A4 (4 vs 2 sixteenths); 4 is used, and nothing depends on it.
 *
 * Format: [onsetInSixteenths, midi, durationInSixteenths, hand]. Onset 0 is the
 * first sounding note of the piece.
 *
 * This file exists because the shipped data had the Für Elise left hand entering
 * three sixteenths late, and was missing the right-hand C4-E4-A4 and E4-G#4-B4
 * figures entirely — bugs that no amount of internal-consistency testing could
 * catch, because the data was self-consistently wrong.
 */

export const FUR_ELISE_SCORE = [
  [0, 76, 1, "R"],
  [1, 75, 1, "R"],
  [2, 76, 1, "R"],
  [3, 75, 1, "R"],
  [4, 76, 1, "R"],
  [5, 71, 1, "R"],
  [6, 74, 1, "R"],
  [7, 72, 1, "R"],
  [8, 45, 1, "L"],
  [8, 69, 2, "R"],
  [9, 52, 1, "L"],
  [10, 57, 1, "L"],
  [11, 60, 1, "R"],
  [12, 64, 1, "R"],
  [13, 69, 1, "R"],
  [14, 40, 1, "L"],
  [14, 71, 2, "R"],
  [15, 52, 1, "L"],
  [16, 56, 1, "L"],
  [17, 64, 1, "R"],
  [18, 68, 1, "R"],
  [19, 71, 1, "R"],
  [20, 45, 1, "L"],
  [20, 72, 2, "R"],
  [21, 52, 1, "L"],
  [22, 57, 1, "L"],
  [23, 64, 1, "R"],
  [24, 76, 1, "R"],
  [25, 75, 1, "R"],
  [26, 76, 1, "R"],
  [27, 75, 1, "R"],
  [28, 76, 1, "R"],
  [29, 71, 1, "R"],
  [30, 74, 1, "R"],
  [31, 72, 1, "R"],
  [32, 45, 1, "L"],
  [32, 69, 2, "R"],
  [33, 52, 1, "L"],
  [34, 57, 1, "L"],
  [35, 60, 1, "R"],
  [36, 64, 1, "R"],
  [37, 69, 1, "R"],
  [38, 40, 1, "L"],
  [38, 71, 2, "R"],
  [39, 52, 1, "L"],
  [40, 56, 1, "L"],
  [41, 64, 1, "R"],
  [42, 72, 1, "R"],
  [43, 71, 1, "R"],
  [44, 45, 1, "L"],
  [44, 69, 4, "R"],
  [45, 52, 1, "L"],
  [46, 57, 1, "L"],
];
