# Run TiLT in your web browser (on your own computer)

`tilt-local` is a small program that serves the TiLT interface to your normal browser while the real backend
(emulator, ROM library, disks) runs on **your** computer. It is the same backend the desktop app uses.

```bash
scripts/tilt-local.sh            # Linux / macOS  (builds the UI and the server first if needed)
scripts\tilt-local.ps1           # Windows PowerShell
```

It prints a private link such as `http://127.0.0.1:5174/?token=…` and opens it. Keep the terminal open; press
**Ctrl+C** to stop (a running Amiga is shut down safely first). Closing the browser tab does not stop a running machine.

* **Local only.** It listens on `127.0.0.1`, not on your network. Your ROMs, floppies and hard disks are read from
  your disk when you import them and never leave the machine. Do **not** expose this port to a network or the internet.
* **Private link.** Each run uses a random token, kept in an HttpOnly, SameSite=Strict cookie. Requests with the wrong
  token, a foreign `Origin`, or a `Host` other than `127.0.0.1`/`localhost` are refused (defence against other websites
  and DNS-rebinding). Open the link printed in the terminal; a plain `http://127.0.0.1:5174/` shows a hint instead.
* **File picking.** Browsers cannot hand over file paths, so every *Browse…* button opens TiLT's own file browser,
  which lists folders on this computer. You can also paste a full path.
* **Same limits as the desktop app:** the emulator opens in its **own window** (this is not a streamed display),
  and on Windows the official Amiberry build has no run-time control channel (see ADR-0001).
* Options: `--port N` (0 = any free port), `--root <dir>` (storage folder; default is the normal TiLT library),
  `--ui <dir>` (built UI), `--no-open`.

This mode is not a hosted service: the page at the public Vercel preview has no backend and only shows screenshots.
