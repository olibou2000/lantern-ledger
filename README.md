# Lantern Ledger

Keep track of roleplay story universes: characters, scene prompts and world notes, organized by story.

## Get the app

**Android app (APK):** open the [Releases page](../../releases/latest) on your phone, download `lantern-ledger.apk`, and open it. Android will ask you to allow installs from your browser the first time.

**Web app:** open the GitHub Pages link for this repo in Chrome, then tap ⋮ → **Install app** (or **Add to Home screen**). It works offline.

## How it's built

- `www/` is the whole app: one `index.html`, plus icons, the offline service worker and the web manifest.
- Every push to `main` runs `.github/workflows/build.yml`, which:
  - publishes `www/` to GitHub Pages, and
  - wraps it with [Capacitor](https://capacitorjs.com/) and builds an Android APK, posted to the Releases page as `latest`.
- `assets/` holds the source images for the Android icon and splash screen.

## One-time setup

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. Without it the web app step fails (the APK still builds).

## Your data

Stories are saved on the device you use. Use the **Backup** section to copy them out or move them to another phone.
