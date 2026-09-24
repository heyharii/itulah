# Windows Store Edge

This package installs the Rust Store Edge backend for a Windows POS terminal.
The POS app defaults to `http://127.0.0.1:8082`; keep `BIND_ADDR` on that
loopback address so the API is not exposed to the LAN.

## Configure

Create a private `.env` file from `store.env.example`. Set a unique
`INVENTORY_NODE_ID`, `INVENTORY_SITE_ID`, database path, bootstrap admin
password, and per-origin `SYNC_UPLOAD_KEY`. `SYNC_UPLOAD_URL` must be the
reachable Cloud base URL; the edge sender appends `/api/v1/sync/ingest`.
Never commit `.env` or paste its contents into support chats.

## Install

Open an elevated PowerShell window in the extracted package and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./install-store-edge.ps1 -ConfigPath C:\secure\store-edge.env
```

The installer copies the binary and config to
`C:\ProgramData\Itulah\StoreEdge`, restricts that directory to Local System
and local administrators, and registers a restartable AtStartup task named
`Itulah Store Edge`. It does not modify the legacy `StoreEdge` Windows service
or an existing SQLite database.

Health is at `http://127.0.0.1:8082/api/v1/health`. Logs are written beside the
binary to `store-edge.log`; the secret config is `.env` and must not be shared.

To inspect the task:

```powershell
Get-ScheduledTask -TaskName 'Itulah Store Edge'
Get-ScheduledTaskInfo -TaskName 'Itulah Store Edge'
```
