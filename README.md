# VaultBay

Simple backup-drive transfer for shops: install on the PC with the external drive, run the portable app on a customer PC, and move files with a PIN.

## How to use it

### Shop / host PC
1. Install VaultBay ([Releases](https://github.com/LogicRepairs/vaultbay/releases))
2. Plug in the backup/external drive
3. Open VaultBay → **This PC has the drive**
4. Pick the drive folder, set a PIN, click **Start sharing**

### Customer / client PC
1. Run the **portable** VaultBay build for that OS (no install needed)
2. Open VaultBay → **Connect to the drive**
3. Pick the shop host (or enter its IP), enter the PIN
4. Upload / download files

Both PCs need to be on the same Wi‑Fi / LAN.

## Updates

| Build | How to update |
| --- | --- |
| Full installer (Windows setup, macOS DMG, Linux deb) | **Settings → Check for updates** → download → restart |
| Portable (Windows portable EXE, mac ZIP, Linux AppImage) | **Settings → Check for updates**, or download the newest portable from Releases and replace the old file |

Both channels publish from the same [GitHub Releases](https://github.com/LogicRepairs/vaultbay/releases).

## Advanced tools

Partitioning, encryption, SMB share metadata, and users are still available under **Advanced tools**.

## Develop

```bash
npm install
npm run dev
```

## Release

```bash
# bump version in package.json, then:
git tag v1.1.0
git push origin v1.1.0
# or run the "Build & Release" workflow
```
