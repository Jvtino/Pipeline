# Setting up Pipeline on a new computer

Everything you need is in this repo **except `config.json`** (your OAuth
credentials), which is deliberately kept out of GitHub. Follow these steps.

## 1. Install the tools
- **Node.js** (includes npm): https://nodejs.org  → download the "LTS" version, install.
- **Git**: on macOS, run `git --version` in Terminal; if missing it offers to install.

## 2. Get the code
```bash
git clone https://github.com/Jvtino/Pipeline.git
cd Pipeline
npm install
```
> If the repo is **private**, the clone will ask you to sign in to GitHub, or you
> can download it as a ZIP from the repo's green **Code** button.

## 3. Restore your credentials (the one file that isn't in GitHub)
Recreate `config.json` in the project folder. Copy the template and fill it in:
```bash
cp config.example.json config.json
```
Then paste your saved values into it:
```json
{
  "microsoft": { "clientId": "YOUR-AZURE-CLIENT-ID" },
  "google":    { "clientId": "YOUR-GOOGLE-CLIENT-ID.apps.googleusercontent.com",
                 "clientSecret": "YOUR-GOOGLE-CLIENT-SECRET" }
}
```
> 💡 Before leaving your old laptop, copy its `config.json` (AirDrop it to
> yourself, or save its contents in your notes / password manager). It lives at
> the project root next to `package.json`.

## 4. Run or build
```bash
npm start            # run the app in development
npm run dist:mac     # build a macOS .dmg in dist/
```
For a Windows build, see `.github/workflows/build.yml` (GitHub builds it for you).

## Full provider/OAuth details
See `DESKTOP.md`.
