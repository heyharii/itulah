# ERPNext Indonesia localization research clones

Clones fetched for the research in [`docs/erpnext-finance-localization-research-2026-09-23.md`](../../docs/erpnext-finance-localization-research-2026-09-23.md).

| Local path | Origin | Current branch / commit | Snapshot |
|---|---|---|---|
| `andrimuhyidin/` | `https://github.com/andrimuhyidin/erpnext-indonesia-localization.git` | `develop` / `1f9702bb92666bd1b2302e36611de92e53226ce9` | Full history fetched; latest commit 29 Jan 2026 |
| `agile-technica/` | `https://github.com/agile-technica/erpnext-indonesia-localization.git` | `develop` / `82d5be9` | Full history and tags fetched; latest commit 19 Jun 2026; tag `v1.4.1` |

The main ERPNext checkout already exists at `../../erpnext` relative to this folder (`/Users/hari/Documents/erpnext`), branch `develop`, commit `3c251254b8ff4ffa90d565045c43f64c8e78fe45`. It is already a shallow checkout; I reused it instead of making another copy or fetching its full history.

The two localization histories share 281 commits. Their latest common commit is `feee84f` (the v1.2.0 merge on 13 Nov 2025); the Andri-hosted branch then diverges, while Agile Technica continues to v1.4.1.

To inspect the code, open each repository folder above. To update a localization clone to its remote `develop` head:

```sh
git -C research/erpnext-indonesia/andrimuhyidin fetch --tags origin
git -C research/erpnext-indonesia/andrimuhyidin switch develop
git -C research/erpnext-indonesia/andrimuhyidin pull --ff-only

git -C research/erpnext-indonesia/agile-technica fetch --tags origin
git -C research/erpnext-indonesia/agile-technica switch develop
git -C research/erpnext-indonesia/agile-technica pull --ff-only
```

These source repositories are reference material. No dependency installation, app installation, test execution, or source edits were performed.
