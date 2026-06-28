# Setting up Pipeline on a new Mac

You no longer manage any files by hand. **GitHub is the source of truth.** A single
double-click icon on your Desktop downloads the latest code from GitHub, keeps
itself updated, and runs the app.

## The one-time setup (about 3 minutes)

1. **Get the launcher onto your Desktop.** On the new Mac, open
   https://github.com/Jvtino/Pipeline → open the **`launchers`** folder →
   click **`Pipeline.command`** → click the **⋯ / Download raw file** button.
   Drag the downloaded `Pipeline.command` onto your **Desktop**.

   *(That's the only file you ever copy by hand. From then on it updates itself.)*

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

Just double-click **`Pipeline`** on the Desktop. It always pulls the newest version
from GitHub first, so you're never out of date. Leave the window open while you use
the app; close it to stop.
