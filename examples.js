export const EXAMPLES = {
  'Start here': `// Each line is a track. Ctrl/Cmd+Enter to play or update, Ctrl/Cmd+. to stop.
tempo(110)
key("C minor")

drums({
  kick:  "x...x...x...x...",
  snare: "....x.......x...",
  hat:   "x.x.x.x.x.x.x.x.",
})

bass("0 ~ ~ 0 ~ -2 ~ ~ 3 ~ ~ 0 ~ 5 ~ ~")

chords("<Cm7 Ab Fm7 G7>")

lead("~ ~ 4 ~ ~ 2 ~ ~ 0 ~ 3 ~ ~ ~ ~ ~")
`,

  'Four on the floor': `tempo(124)
key("A minor")

drums({
  kick:    "X...X...X...X...",
  clap:    "....x.......x...",
  openhat: "..x...x...x...x.",
  hat:     "xxxxxxxxxxxxxxxx",
}, { vol: 0.8 })

bass("0*2 ~ 0 ~ 3 ~ 5 ~", { filter: 700 }).sweep(300, 1400, 4)

pad("<Am7 Fmaj7>")
`,

  'Lo-fi chill': `tempo(78)
key("F major")

drums({
  kick:  "x.....x...x.....",
  snare: "....x.......x..o",
  hat:   "x.xox.xox.xox.xo",
}, { vol: 0.7 }).humanize(0.03)

bass("0 ~ ~ 0 ~ 2 ~ ~", { sound: "sine", vol: 0.9 })

chords("<Fmaj7 Em7 Dm7 Cmaj7>", { filter: 1200, vol: 0.35 })

lead("<[4 2] [~ 5]> ~ 7 ~", { sound: "sine", delay: 0.5 }).slow(2)
`,

  'Drum & bass-ish': `tempo(172)
key("E minor")

drums({
  kick:  "x.........x.....",
  snare: "....x.......x...",
  hat:   "x.x.x.x.x.x.x.x.",
}).fast(2)

bass("<0 0 -2 -3>*2", { sound: "sawtooth", filter: 400 })
  .sweep(200, 900, 2)

pad("<Em Cmaj7 D Bm>")
`,

  'Ambient': `tempo(60)
key("D dorian")

pad("<Dm9 Gmaj7 Am7 Cmaj7>", { vol: 0.35 })

lead("0 ~ 4 ~ 7 ~ 2 ~", { sound: "sine", delay: 0.6, reverb: 0.6, vol: 0.4 })
  .slow(2).sometimes((x) => x.add(note(12)))

bass("0 ~ ~ ~", { sound: "sine", vol: 0.7 }).slow(2)
`,

  'Name your tracks': `// A label before the colon names a track (shows in the mixer above).
// Anything Strudel can do still chains on the end.
tempo(100)
key("G minor")

groove: drums({ kick: "x..x..x.", snare: "....x..." }).fast(2)

sub: bass("0 ~ ~ 0 ~ 3 ~ 5", { sound: "sine" })

// Muted at the start with an underscore. Remove it to hear it.
_shimmer: lead("0 2 4 6 7 6 4 2", { delay: 0.5 }).fast(2).degradeBy(0.3)
`,
};
