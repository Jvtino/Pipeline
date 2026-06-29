# Setting up Pipeline on a new Mac

You no longer manage any files by hand. **GitHub is the source of truth.** A
double-click icon on your Desktop downloads the latest code from GitHub, keeps
itself updated, and runs the app.

## Two ways to run Pipeline

There are two launchers in the **`launchers`** folder — pick whichever you prefer
(you can keep both on your Desktop):

- **`Pipeline.command`** → opens the **web app** in your browser.
- **`Pipeline Desktop.command`** → opens the **native desktop app** (its own
  window, no browser). The first run downloads Electron, so it takes a few extra
  minutes; later runs are quick.

Both stay in sync with GitHub automatically, and both update their own Desktop
icon on every run.

## The one-time setup (about 3 minutes)

1. **Get a launcher onto your Desktop.** On the new Mac, open
   https://github.com/Jvtino/Pipeline → open the **`launchers`** folder →
   click the launcher you want (**`Pipeline.command`** for the browser, or
   **`Pipeline Desktop.command`** for the native app) → click the
   **⋯ / Download raw file** button. Drag the downloaded file onto your **Desktop**.
   (Grab both if you like — repeat for the other one.)

   *(Those are the only files you ever copy by hand. From then on they update themselves.)*

2. **Allow it to run the first time.** Because it came from the internet, macOS
   blocks it on the first launch. **Right-click** the icon → **Open** → **Open**.
   After that, a normal double-click works.

3. **Let it do the rest.** The first run installs the tools it needs and may ask
   you to install **Node.js** (from https://nodejs.org — click the green **LTS**
   button) and **git** (a macOS box pops up — click **Install**). Double-click the
   icon again after installing. When it finishes, the app opens in your browser.

## Your private credentials (not on GitHub, by design)

Your Google/Microsoft sign-in secrets are **never** uploaded to GitHub. To connect
your mailbox on the new Mac, double-click **`connect-google.command`** (in the
downloaded `Pipeline` folder in your Home folder) and follow the prompts — same as
before. See `GOOGLE-VERIFICATION.md` / `WEB-OAUTH.md` for details.

## Everyday use

Double-click **`Pipeline`** (browser) or **`Pipeline Desktop`** (native window) on
the Desktop. Either one pulls the newest version from GitHub first, so you're never
out of date. Leave the Terminal window open while you use the app; close it to stop.

> **Note:** both apps share the same downloaded folder but use different installers
> under the hood. If you switch from the web app to the desktop app, the desktop
> launcher may spend an extra minute reinstalling Electron — this is normal and it
> repairs itself automatically.
