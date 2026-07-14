# Cat Ski

A free browser game inspired by SkiFree (1991). You play a cat skiing down an endless mountain, dodging trees, launching off ramps, grabbing flags, and outrunning a snowman that appears when you slow down.

Play it at https://ski.mike-lee.me

## What it is

Cat Ski is one self-contained HTML file, about 200 KB of vanilla HTML, CSS, and JavaScript. There is no build step, no framework, and no runtime dependency beyond a Supabase endpoint that stores the global leaderboard. The two fonts are self-hosted. The game draws to an HTML5 canvas at a low internal resolution of 360 by 270 and scales it up with pixelated rendering, so the pixel art stays sharp on any screen.

## Features

- Three mountain themes: Alps, Rockies, and Himalayas. Each palette comes from landscape photography of the real range.
- Four cat variants: black, tabby, calico, and orange.
- Mid-air tricks that chain for extra points: Meow Roll, Whisker Twist, Cat Nap.
- A snowman chaser in the role of the SkiFree yeti, plus dog breeds that match each region.
- Two difficulty sliders, intensity and dog count, with four presets from Easy to Insta Death.
- A 9-lives casual mode on by default, or 1-life classic if you want the original pressure.
- A global top-3 leaderboard, tracked separately for each mode.
- Keyboard and touch controls, and English or rioplatense Spanish text.
- Installable as a Progressive Web App for offline play.

## Controls

Steer with the arrow keys or WASD. Press Space to start, pause, and restart. On a phone, use the on-screen joystick and the trick buttons.

## Run it locally

Cat Ski is a static site, so any static file server works:

    python3 -m http.server 8000

Open http://localhost:8000 and play. There is nothing to compile.

## Stack

Vanilla HTML, CSS, and JavaScript. HTML5 Canvas for rendering. Web Audio API for procedural sound, so there are no audio files. Supabase Postgres stores the leaderboard, with anonymous read and write through row-level security and no accounts. Hosted on Vercel, deployed automatically from this repository.

## More

The full story of how the game was built, including the color-from-photography approach and the design criteria for each element, is in [readme.html](https://ski.mike-lee.me/readme.html).

Built by Mike Lee. Inspired by SkiFree by Chris Pirih, 1991.
