// Lets vendor/soundfonts.mjs import "@strudel/core" from the already-loaded bundle (window.strudel).
export const { freqToMidi, noteToMidi, getSoundIndex, Pattern, getPlayableNoteValue } = window.strudel;
