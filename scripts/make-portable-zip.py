#!/usr/bin/env python3
"""Assemble TiLT-portable-win64.zip: TiLT.exe + engine/ + notices/ + portable.flag (data stays next to the program)."""
import sys, zipfile, os, pathlib

exe, res, dest = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
top = "TiLT-portable/"
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.write(exe, top + "TiLT.exe")
    z.writestr(top + "portable.flag", "")
    for sub in ("engine", "notices"):
        for p in sorted((res / sub).rglob("*")):
            if not p.is_file() or p.name == "README.txt":
                continue
            z.write(p, top + str(p.relative_to(res)).replace(os.sep, "/"))
print(f"wrote {dest}")
