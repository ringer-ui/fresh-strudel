// Starter parts, grouped like Strudel Market's categories. Click one to add it as a new track.
export const SNIPPETS = {
  Drums: {
    'Four on the floor': `drums({ kick: "X...X...X...X...", hat: "..x...x...x...x." })`,
    'Backbeat': `drums({ kick: "x.......x.x.....", snare: "....x.......x..." })`,
    'Hats, 16ths': `drums({ hat: "xoxoxoxoxoxoxoxo" }, { vol: 0.5 })`,
    'Clap on 2 & 4': `drums({ clap: "....x.......x..." })`,
    'Breakbeat': `drums({ kick: "x.....x...x.....", snare: "....x..o.o..x...", hat: "x.x.x.x.x.x.x.x." })`,
    'Halftime': `drums({ kick: "x...............", snare: "........x.......", hat: "x.x.x.x.x.x.x.x." })`,
  },
  Bass: {
    'Groove (euclidean)': `bass("<0 0 3 -2>(5,16)")`,
    'Syncopated': `bass("0 ~ ~ 0 ~ -2 ~ ~ 3 ~ ~ 0 ~ 5 ~ ~")`,
    'Offbeat': `bass("~ 0 ~ 0 ~ 0 ~ 0")`,
    'Sub': `bass("0 ~ ~ ~", { sound: "sine", vol: 0.9 }).slow(2)`,
    'Acid': `bass("0 0 3 0 5 0 7 5", { filter: 300, reverb: 0 }).sweep(300, 2000, 2)`,
  },
  Chords: {
    'Minor loop': `chords("<Cm7 Ab Fm7 G7>")`,
    'Pop': `chords("<C G Am F>")`,
    'Jazzy': `chords("<Dm7 G7 Cmaj7 A7>")`,
    'Stabs': `chords("<Cm7 Fm7>", { release: 0.1 }).struct("x ~ x ~ ~ x ~ ~")`,
    'Soft pad': `pad("<Cm9 Abmaj7>")`,
  },
  Melody: {
    'Hook': `lead("~ ~ 4 ~ ~ 2 ~ ~ 0 ~ 3 ~ ~ ~ ~ ~")`,
    'Question & answer': `lead("<[~ 4 ~ 2 ~ ~ 0 ~] [~ 3 ~ 2 ~ ~ 4 ~]>")`,
    'Sparse': `lead("~ 4 ~ 2 ~ 7 ~ ~").slow(2)`,
    'Broken chord': `lead("0 ~ 4 ~ ~ 7 ~ 4").fast(2)`,
    'Drifting': `lead("~ 0 ~ 4 ~ 2 ~ ~").fast(2).sometimes((x) => x.add(n(2))).degradeBy(0.2)`,
  },
  Ambient: {
    'Drifting pad': `pad("<Cm9 Fm9>", { reverb: 0.8 }).slow(2)`,
    'Bells': `lead("~ 7 ~ 4 ~ ~ 9 ~", { sound: "sine", delay: 0.6, reverb: 0.7, vol: 0.4 }).slow(2)`,
    'Sub drone': `bass("0", { sound: "sine", vol: 0.6 }).slow(4)`,
  },
  Effects: {
    'Slow filter sweep': `.sweep(200, 4000, 8)`,
    'Human feel': `.humanize()`,
    'Half-speed': `.bars(2)`,
    'Occasionally skip': `.degradeBy(0.3)`,
  },
};
