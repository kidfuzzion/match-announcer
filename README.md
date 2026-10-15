# Match Announcer

A pre-match PA announcer for high school volleyball. It runs in a browser on an iPhone or laptop plugged into the gym PA by aux cable, and works fully offline once it's set up.

**Match order:** Welcome (optional sportsmanship statement) → National anthem (recorded file or live singer) → Visitor roster → Home roster with music → Closing. Each cue starts with one tap.

## Install on iPhone

1. Open the app's GitHub Pages link in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Always open it from the Home Screen icon. That keeps your rosters and approved names from being cleared by Safari, and lets it run with no internet.

## Before the season

- **Teams:** enter your home team, coach, and roster (paste it in). Rosters are read in the order shown.
- **Script:** edit the welcome, sportsmanship, anthem intros, roster intros, athlete line, and closing. Words in `{braces}` fill in automatically.
- **Voice:** pick the device voice or ElevenLabs, and compare both on your real names. Set the pacing and music behavior.

## Before each match

1. **Match:** choose the opponent (or add a new one and paste their roster). Load the anthem and home music files.
2. **Names:** listen to every name, fix any with a respelling (for example, *Ava WIN*), and approve it.
3. **Match → Generate voice clips** (ElevenLabs only), on Wi-Fi.
4. **Export a match pack** as a backup.

## At the match

Turn on airplane mode, connect the aux cable, open **Run**, tap **Start session**, then tap **Play / Next** for each cue.

- **Pause** finishes the current name and holds before the next one.
- **Stop** fades everything out and leaves the cue ready to replay.
- Any line without an ElevenLabs clip is read automatically by the device voice.

## Notes

- Your data is stored only on the device. The ElevenLabs API key is never written into a match pack.
- Audio files must be on the device (Files app). Songs streamed from Spotify or Apple Music can't be used.
- No build step. These are plain HTML, CSS, and JavaScript files. After changing app files, bump `VERSION` in `sw.js` so installed copies update.
