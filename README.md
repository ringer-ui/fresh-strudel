# Strudel Easy

A friendlier front end for [Strudel](https://strudel.cc): the same JavaScript and mini-notation, with sensible defaults
(tempo, key, drum kit, synths, filters, reverb), plain-English instruments (`drums`, `bass`, `chords`, `pad`, `lead`),
a mute/solo mixer, a snippet library, clearer errors, and an optional chat that edits the song with Claude (bring your own
Anthropic API key; it stays in your browser).

    npm install        # only needed for the tests
    npm test
    npm run build      # -> dist/, the static site
    npm run preview    # http://localhost:4322 with the production security headers

Deploying: see [docs/PUBLIC_DEPLOY.md](docs/PUBLIC_DEPLOY.md). Licence and bundled code: see [NOTICE.md](NOTICE.md).

```js
tempo(110)
key("C minor")

drums({ kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." })
bass("0 ~ 0 3 ~ 0 5 ~")
chords("<Cm7 Ab Fm7 G7>")
lead("~ 4 ~ 2 ~ 7 ~ 5").slow(2)
```

Ctrl/Cmd+Enter plays or updates; Ctrl/Cmd+. stops.
