# VaultBay

Professional NAS control software for turning spare external hard drives into password-protected network storage — built for shop backups, customer drop-offs, and cross-platform access on **macOS**, **Windows**, and **Linux**.

## What it does

- Discovers real USB / Thunderbolt / SATA spare drives on the host PC
- Full partition & format layouts (ExFAT, APFS, NTFS, ext4, XFS, Btrfs)
- AES-256 volume encryption with lock / unlock
- Password-protected SMB (and WebDAV / NFS) network shares
- User roles for admin, read/write, and read-only access
- One-click mapping guides for macOS, Windows, and Linux clients
- Auto-updates from GitHub Releases on any laptop

## Quick start (development)

```bash
npm install
npm run dev
```

## Packaged builds

| Target | Command | Output |
| --- | --- | --- |
| macOS DMG + portable ZIP | `npm run dist:mac` | `release/VaultBay-*-mac-*.dmg` / `.zip` |
| Windows installer + portable EXE | `npm run dist:win` | `release/VaultBay-*-win-setup-*.exe` / `*-portable-*.exe` |
| Linux AppImage + deb + tar.gz | `npm run dist:linux` | `release/VaultBay-*-linux-*` |

Portable artifacts:

- **Windows**: `VaultBay-*-win-portable-*.exe` (no install)
- **macOS**: `VaultBay-*-mac-*.zip` (unzip and run)
- **Linux**: `VaultBay-*-linux-portable-*.AppImage` (chmod +x and run)

Cross-platform Windows/Linux installers are produced by GitHub Actions (native runners). On macOS you can still package the Mac build locally.

## Publish an update (any laptop)

1. Bump `version` in `package.json`
2. Commit and tag: `git tag v1.0.1 && git push origin v1.0.1`
3. GitHub Actions builds macOS / Windows / Linux (installer + portable) and publishes a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github)
4. On any machine running VaultBay → **Settings → Check for updates**

Manual release from Actions: run **Build & Release** → publish `true`.

## Shop workflow

1. Plug spare drives into the VaultBay host PC  
2. Open **Drives** → partition / format → enable encryption  
3. Unlock volumes → publish them under **Shares**  
4. Create staff accounts under **Users**  
5. Hand customers the connection steps from **Access**

| OS | Connect |
| --- | --- |
| macOS | Finder → Go → Connect to Server → `smb://VaultBay-Shop/ShareName` |
| Windows | Explorer → `\\VaultBay-Shop\ShareName` |
| Linux | Files → Other Locations, or `mount -t cifs` |
