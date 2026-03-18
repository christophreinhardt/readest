# iOS Fork Build

This project already supports iOS via Tauri, but the checked-in upstream config is tied to the official Readest App Store app:

- bundle identifier: `com.bilingify.readest`
- Apple development team: `J5W48D69VR`

For a personal fork, do not edit those upstream values in place. Use a local Tauri override config and local env files instead.

## Scope

This guide is for:

- local simulator/device development on a Mac
- fork-specific archive builds
- optional App Store Connect upload from your own Apple account

This guide is not for:

- Windows-only development. You can edit code on Windows, but iOS build/sign/archive must run on macOS with Xcode.

## 1. Prepare the repo on your Mac

```bash
git clone https://github.com/christophreinhardt/readest.git
cd readest
git checkout feat/ios-gesture-brightness-color-temp
git submodule update --init --recursive
pnpm install
pnpm --filter @readest/readest-app setup-vendors
```

## 2. Create local env files

In `apps/readest-app`, create:

- `.env.ios-appstore-dev.local`
- `.env.ios-appstore.local`

Minimal content for development:

```dotenv
NEXT_PUBLIC_APP_PLATFORM=tauri
DBUS_ID=de.christophreinhardt.readest
```

For App Store Connect upload, add your API credentials to `.env.ios-appstore.local`:

```dotenv
NEXT_PUBLIC_APP_PLATFORM=tauri
DBUS_ID=de.christophreinhardt.readest
APPLE_API_KEY=YOUR_APP_STORE_CONNECT_KEY_ID
APPLE_API_ISSUER=YOUR_APP_STORE_CONNECT_ISSUER_ID
```

If your fork uses different backend services, also copy values from `.env.local.example` as needed.

## 3. Create a local Tauri iOS override

Copy the example file:

```bash
cp apps/readest-app/src-tauri/tauri.ios.local.example.json apps/readest-app/src-tauri/tauri.ios.local.conf.json
```

Then replace:

- `identifier` with your own bundle ID
- `bundle.iOS.developmentTeam` with your Apple Developer team ID
- updater endpoints if you do not want to ship upstream update URLs

Suggested bundle ID for your fork:

```text
de.christophreinhardt.readest
```

## 4. Initialize the iOS project once

```bash
cd apps/readest-app
pnpm tauri ios init
```

This creates the Xcode workspace under `src-tauri/gen/apple`.

## 5. Run on simulator or device

Use the local override config explicitly:

```bash
pnpm tauri ios dev --config src-tauri/tauri.ios.local.conf.json
```

For a real device on the same network:

```bash
pnpm tauri ios dev --host --config src-tauri/tauri.ios.local.conf.json
```

If signing fails, open the generated Xcode project once and let Xcode fix provisioning for your Apple team.

## 6. Build an archive for your fork

Development archive:

```bash
dotenv -e .env.ios-appstore-dev.local -- pnpm tauri ios build --config src-tauri/tauri.ios.local.conf.json
```

App Store archive:

```bash
dotenv -e .env.ios-appstore.local -- pnpm tauri ios build --export-method app-store-connect --config src-tauri/tauri.ios.local.conf.json
```

## 7. Optional App Store Connect upload

The existing script can be adapted by passing the same local config manually before upload:

```bash
dotenv -e .env.ios-appstore.local -- pnpm tauri ios build --export-method app-store-connect --config src-tauri/tauri.ios.local.conf.json
xcrun altool --upload-app --type ios --file src-tauri/gen/apple/build/arm64/Readest.ipa --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
```

## 8. Fork-specific recommendations

- Do not use the upstream bundle ID `com.bilingify.readest`.
- Do not use the upstream Apple team ID unless you control that account.
- Replace updater endpoints before distributing builds publicly.
- If you plan to publish on TestFlight/App Store, review all product IDs under `src/hooks/useAvailablePlans.ts` because they currently reference upstream IAP identifiers.

## 9. GitHub Actions secrets for Windows users

If you do not have a Mac locally, use the GitHub workflow `.github/workflows/ios-ipa.yml`.

Set these in your fork under `Settings` -> `Secrets and variables` -> `Actions`.

Repository secrets:

- `APPLE_TEAM_ID`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_PROVISIONING_PROFILE` (recommended for device-installable development IPAs)

Repository variables:

- `IOS_BUNDLE_IDENTIFIER`
- `IOS_DBUS_ID`

Recommended values for this fork:

```text
IOS_BUNDLE_IDENTIFIER=de.christophreinhardt.readest
IOS_DBUS_ID=de.christophreinhardt.readest
```

### How to create `APPLE_CERTIFICATE`

You need access to a Mac once for this step.

1. Sign in to Xcode with your Apple Developer account.
2. Ensure an `Apple Development` certificate exists in Keychain Access.
3. In `Keychain Access` -> `My Certificates`, find:
   `Apple Development: Your Name (TEAM_ID)`
4. Export that certificate including the private key as `.p12`.
5. Choose an export password.
6. Base64-encode the file and store the result in GitHub as `APPLE_CERTIFICATE`.

PowerShell encoding example:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\ios-dev-cert.p12")) | Set-Clipboard
```

Use the export password as `APPLE_CERTIFICATE_PASSWORD`.

Use the exact certificate name as `APPLE_SIGNING_IDENTITY`, for example:

```text
Apple Development: Christoph Reinhardt (ABCDE12345)
```

### How to create `APPLE_PROVISIONING_PROFILE`

For sideloading to a real iPhone, a development provisioning profile is strongly recommended.

1. Go to the Apple Developer portal.
2. Register your target iPhone under `Devices`.
3. Create an App ID for your fork bundle ID, for example:
   `de.christophreinhardt.readest`
4. Create an iOS App Development provisioning profile for that App ID.
5. Include:
   - your `Apple Development` certificate
   - your target iPhone device
6. Download the resulting `.mobileprovision` file.
7. Base64-encode it and store the result in GitHub as `APPLE_PROVISIONING_PROFILE`.

PowerShell encoding example:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\fork-dev.mobileprovision")) | Set-Clipboard
```

### How to run the workflow

1. Open your fork on GitHub.
2. Go to `Actions`.
3. Run `Build iOS IPA for Sideloading`.
4. Download the generated `.ipa` artifact.
5. Install it on Windows with Sideloadly.

If the workflow fails at signing, the most common mismatch is:

- bundle ID in GitHub variable does not match the provisioning profile
- certificate does not belong to the same Apple team
- target iPhone is not included in the provisioning profile

## Current status of this fork branch

The branch `feat/ios-gesture-brightness-color-temp` contains the iOS reader gesture change:

- one-finger vertical swipe adjusts brightness
- two-finger vertical swipe adjusts warm/cool color temperature

For paginated reading this is ready for on-device validation on iPhone/iPad.
