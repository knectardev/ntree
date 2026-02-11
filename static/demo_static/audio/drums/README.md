# Local Drum Samples (drums2.js)

Place your own drum one-shots in this folder tree to override fallback sounds.

## Recommended format

- WAV
- 24-bit
- 44.1 kHz or 48 kHz
- Mono for kick/snare/tom/conga/clave (stereo is fine for cymbal)

## Folder + filename convention

Use any of the listed names per piece (first existing files are loaded):

- `kick/kick.wav`, `kick/kick_01.wav`, `kick/kick_02.wav`
- `snare/snare.wav`, `snare/snare_01.wav`, `snare/snare_02.wav`
- `hihat/hihat_closed.wav`, `hihat/hihat.wav`, `hihat/hihat_01.wav`
- `tom/tom.wav`, `tom/tom_01.wav`, `tom/tom_02.wav`
- `conga/conga.wav`, `conga/conga_01.wav`, `conga/conga_02.wav`
- `cymbal/cymbal.wav`, `cymbal/crash.wav`, `cymbal/ride.wav`
- `clave/clave.wav`, `clave/clave_01.wav`

Examples:

- `static/demo_static/audio/drums/kick/kick.wav`
- `static/demo_static/audio/drums/snare/snare_01.wav`

## Behavior

- If local files are found for a piece, `drums2.js` uses them (local mode).
- If local files are not found for a piece, it falls back to remote sample sources for that piece.
- Multiple local files per piece are round-robined to reduce machine-gun repetition.

## Compatibility aliases (current project)

`drums2.js` also accepts these existing folder patterns so you do not need to rename immediately:

- Hi-hat from `hat/hat1.wav`, `hat/hat2.wav`, `hat/hat3.wav`
- Cymbal from `ride/ride1.wav`
- Conga fallback from `tabla/*.wav`, `timbale/*.wav`, `cajon/cajon1.wav`
- Clave fallback from `log/*.wav`, `clap/clap1.wav`

For best control, still prefer dedicated folders: `hihat/`, `cymbal/`, `conga/`, `clave/`.
