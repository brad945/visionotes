/**
 * SCORE GROUND TRUTH — do not hand-edit to make a test pass.
 *
 * Transcribed independently by two agents each, from machine-readable editions
 * of the public-domain scores, then compared note by note:
 *
 *   Für Elise, WoO 59 (Beethoven) — Mutopia Project LilyPond source, typeset
 *     from Breitkopf & Härtel 1888. Anacrusis through m. 8.
 *     https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly
 *     Both transcriptions agreed on all 53 notes except the length of the final
 *     RH A4 (4 vs 2 sixteenths); 4 is used, and nothing depends on it.
 *
 *   Prelude in C, BWV 846 (Bach) — Humdrum kern + Mutopia LilyPond + MusicXML.
 *     https://raw.githubusercontent.com/humdrum-tools/bach-wtc/main/kern/wtc1p01.krn
 *     Both transcriptions were byte-identical across all 128 notes; the first
 *     four measures (64 sixteenths) are kept, matching what songs.js implements.
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

export const PRELUDE_IN_C_SCORE = [
  [0, 60, 8, "L"],
  [1, 64, 7, "L"],
  [2, 67, 1, "R"],
  [3, 72, 1, "R"],
  [4, 76, 1, "R"],
  [5, 67, 1, "R"],
  [6, 72, 1, "R"],
  [7, 76, 1, "R"],
  [8, 60, 8, "L"],
  [9, 64, 7, "L"],
  [10, 67, 1, "R"],
  [11, 72, 1, "R"],
  [12, 76, 1, "R"],
  [13, 67, 1, "R"],
  [14, 72, 1, "R"],
  [15, 76, 1, "R"],
  [16, 60, 8, "L"],
  [17, 62, 7, "L"],
  [18, 69, 1, "R"],
  [19, 74, 1, "R"],
  [20, 77, 1, "R"],
  [21, 69, 1, "R"],
  [22, 74, 1, "R"],
  [23, 77, 1, "R"],
  [24, 60, 8, "L"],
  [25, 62, 7, "L"],
  [26, 69, 1, "R"],
  [27, 74, 1, "R"],
  [28, 77, 1, "R"],
  [29, 69, 1, "R"],
  [30, 74, 1, "R"],
  [31, 77, 1, "R"],
  [32, 59, 8, "L"],
  [33, 62, 7, "L"],
  [34, 67, 1, "R"],
  [35, 74, 1, "R"],
  [36, 77, 1, "R"],
  [37, 67, 1, "R"],
  [38, 74, 1, "R"],
  [39, 77, 1, "R"],
  [40, 59, 8, "L"],
  [41, 62, 7, "L"],
  [42, 67, 1, "R"],
  [43, 74, 1, "R"],
  [44, 77, 1, "R"],
  [45, 67, 1, "R"],
  [46, 74, 1, "R"],
  [47, 77, 1, "R"],
  [48, 60, 8, "L"],
  [49, 64, 7, "L"],
  [50, 67, 1, "R"],
  [51, 72, 1, "R"],
  [52, 76, 1, "R"],
  [53, 67, 1, "R"],
  [54, 72, 1, "R"],
  [55, 76, 1, "R"],
  [56, 60, 8, "L"],
  [57, 64, 7, "L"],
  [58, 67, 1, "R"],
  [59, 72, 1, "R"],
  [60, 76, 1, "R"],
  [61, 67, 1, "R"],
  [62, 72, 1, "R"],
  [63, 76, 1, "R"],
];
