# Cat Ski

A free browser game inspired by SkiFree (1991). You play a cat skiing down an endless mountain, dodging trees, launching off ramps, grabbing flags, and escaping dog and snowman chasers.

Play it at https://ski.unwoke.ninja/

## What it is

The game code is in one HTML file, with separate artwork, icons, and self-hosted fonts. There is no build step, no framework, and no game backend. A service worker caches the game assets for offline play. The game draws to an HTML5 canvas at a low internal resolution of 360 by 270 and scales it up with pixelated rendering.

## Features

- Three mountain themes: Alps, Rockies, and Himalayas. Each palette comes from landscape photography of the real range.
- Four cat variants: black, tabby, calico, and orange.
- Mid-air tricks that chain for extra points: Meow Roll, Whisker Twist, Cat Nap.
- A snowman chaser in the role of the SkiFree yeti, plus dog breeds that match each region.
- Two difficulty sliders, intensity and dog count, with four presets from Easy to Insta Death.
- A 9-lives casual mode on by default, or 1-life classic if you want the original pressure.
- A top-3 leaderboard kept in the browser, with separate boards for each lives mode.
- Keyboard and touch controls, and English or rioplatense Spanish text.
- Installable as a Progressive Web App for offline play.

## Controls

Choose START, press Space, or tap the start screen to play. You begin with nine lives. Steer around obstacles, collect flags, and use ramps to jump.

| Input | Action |
| --- | --- |
| Left/right arrows or A/D | Steer |
| Up arrow or W | Slow down |
| Down arrow or S | Tuck for speed |
| 1, 2, 3 while airborne | Perform tricks |
| Space | Start, retry, or resume |
| P or Esc | Pause or resume |
| R | Restart the current run |

On a phone, drag the joystick left/right to steer, up to slow down, or down to tuck. Tap the trick buttons while airborne; SWAP exchanges the joystick and button positions.

Opening Settings pauses the run and moves the touch controls out of the way. Resume or Restart closes Settings and returns to the game. Installation instructions also pause play; close them, then resume when ready.

Cat, mountain, difficulty, dog count, and lives settings apply when the next run starts. Changing them during or after a run keeps that run's score and settings together.

The snowman arrives 20–40 seconds after the final dog wave clears. A catch costs a life; losing the last life ends the run.

## Scores and privacy

Each browser has its own leaderboard, filled by your saved runs. Each lives-mode board combines all difficulty settings; the BEST shown after a run is specific to its intensity, dog count, and lives mode. Saved nicknames and the board stay in localStorage; clearing site storage resets them.

The site uses Google Analytics 4 and Mixpanel. Mixpanel game events, including run scores and difficulty, require acceptance of the analytics banner; nicknames are not included. Google Analytics cookies remain disabled until acceptance, but the current Consent Mode setup can send cookieless measurements before a choice or after declining. See the [privacy notes](https://ski.unwoke.ninja/readme.html#privacy).

## Run it locally

Cat Ski is a static site, so any static file server works:

    python3 -m http.server 8000

Open http://localhost:8000 and play. There is nothing to compile.

## Regression checks

The test tools are development dependencies; the game still runs without a build or package install. With Node.js 20 or newer:

    npm ci
    npx playwright install chromium webkit firefox
    npm test

The suite checks timing across simulated refresh rates, safe starts, run results, keyboard and touch controls, phone settings, sharing and installation, storage failures and score resets across tabs, consent, and offline cache failures. It also covers restored startup settings, accessible game actions and reduced motion, natural dog/snowman progression, and an upgrade from the previous release. Chromium, WebKit, and Firefox each run the keyboard, score-saving, preferences, guide, and phone-layout smoke flow. Browser tests use local files and block external analytics requests. To use an existing Chrome installation for the Chromium checks, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path.

GitHub Actions runs the suite on pushes and pull requests. The `Regression tests` check is required for `main`, including admin pushes. To release, push a working branch, wait for its checks to pass, then merge or fast-forward the checked commit into `main`. Vercel publishes from `main` after that gate.

See [release checks](RELEASING.md) for native-device checks that browser automation does not cover.

## Stack

Vanilla HTML, CSS, and JavaScript. HTML5 Canvas for rendering. Web Audio API for procedural sound, so there are no audio files. The leaderboard lives in localStorage, so there is no database and no accounts. Hosted on Vercel, deployed automatically from this repository.

## More

See [How to play](https://ski.unwoke.ninja/readme.html) for gameplay details and privacy notes. The [build story](https://unwoke.ninja/cat-ski/built-with-ai) covers the color-from-photography approach and the design criteria for each element.

Built by Mike Lee. Inspired by SkiFree by Chris Pirih, 1991.
