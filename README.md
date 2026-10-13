# Storyverse Tracker

Keep track of roleplay story universes: characters, scene prompts and world notes, organized by story.

## Get the app

**Android app (APK):** open the [Releases page](../../releases/latest) on your phone, download `storyverse-tracker.apk`, and open it. Android will ask you to allow installs from your browser the first time.

**Web app:** open the GitHub Pages link for this repo in Chrome, then tap ⋮ → **Install app** (or **Add to Home screen**). It works offline.

## How it's built

- `www/` is the whole app: one `index.html`, plus icons, the offline service worker and the web manifest.
- Every push to `main` runs `.github/workflows/build.yml`, which:
  - publishes `www/` to GitHub Pages, and
  - wraps it with [Capacitor](https://capacitorjs.com/) and builds an Android APK, posted to the Releases page as `latest`.
- `assets/` holds the source images for the Android icon and splash screen.

## One-time setup

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. Without it the web app step fails (the APK still builds).

## Accounts, friends and shared universes (Firebase)

Until `www/firebase-config.js` holds a config, the app runs on-device only. To turn on accounts:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (Google Analytics can be off).
2. **Build → Authentication → Get started → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** (production mode, any nearby location).
4. In Firestore, open **Rules**, replace everything with the contents of `firestore.rules`, and tap **Publish**.
5. **Project settings → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` values into `www/firebase-config.js`.

Push the change and the next build signs people in.

How sharing works: everyone picks a username. Friends send requests by username; once accepted, you can add a friend to any story. Everyone in a story sees its whole cast and story bible, edits the bible together, and edits only their own characters. The person who started a story can rename or delete it and remove characters from it.

## Your data

Without an account, stories are saved on the device you use. Use the **Backup** section to copy them out, or after signing in, to copy them into your account.

## Signing

`signing/debug.keystore` is the app's fixed signing key, so every build installs over the previous one as an update. It is a debug-style key (password `android`), fine for sharing the APK directly. For a Play Store release, create a private upload key instead and keep it out of the repo.
