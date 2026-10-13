#!/usr/bin/env python3
"""Check a built Windows package without running it, then write SHA256SUMS.

Verifies, for the installer (NSIS) and the portable zip: it is what it says it is (PE / NSIS / zip), carries a
64-bit TiLT.exe and the Amiberry engine, the licence and source-offer files, and NO ROM-like or Workbench-like file.
Exit status 1 on the first failed expectation."""
import hashlib, pathlib, shutil, struct, subprocess, sys, tempfile, zipfile

out = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parent.parent
fails = []


def check(cond, msg):
    print(("  ok    " if cond else "  FAIL  ") + msg)
    if not cond:
        fails.append(msg)


def pe_machine(p):
    d = p.read_bytes()[:4096]
    if d[:2] != b"MZ":
        return None
    off = struct.unpack_from("<I", d, 0x3C)[0]
    if d[off:off + 4] != b"PE\0\0":
        return None
    return struct.unpack_from("<H", d, off + 4)[0]


def contents_ok(label, base):
    files = [p for p in base.rglob("*") if p.is_file()]
    names = {str(p.relative_to(base)).replace("\\", "/") for p in files}
    exes = [p for p in files if p.name.lower() in ("tilt.exe", "tilt-desktop.exe")]
    check(len(exes) == 1, f"{label}: one TiLT executable ({[e.name for e in exes]})")
    if exes:
        check(pe_machine(exes[0]) == 0x8664, f"{label}: TiLT executable is a 64-bit Windows (PE x86-64) program")
    am = [p for p in files if p.name == "Amiberry.exe"]
    check(len(am) == 1 and pe_machine(am[0]) == 0x8664, f"{label}: Amiberry.exe present and 64-bit")
    check(any(n.endswith("engine/SDL3.dll") for n in names), f"{label}: engine DLLs present")
    for need in ("notices/LICENSE.txt", "notices/SOURCE_OFFER.txt", "notices/THIRD_PARTY_LICENSES.md"):
        check(any(n.endswith(need) for n in names), f"{label}: {need}")
    check(not any("/roms/" in "/" + n or n.endswith((".rom", ".adf", ".hdf", ".dms")) for n in names),
          f"{label}: no ROM / disk image files by name")
    check(not any("whdboot" in n for n in names), f"{label}: no WHDLoad data")
    g = subprocess.run([sys.executable, str(root / "scripts/check-no-proprietary.py"), str(base)], capture_output=True, text=True)
    check(g.returncode == 0, f"{label}: proprietary-media guard passes ({(g.stdout + g.stderr).strip()[:80]})")
    return names


installers = sorted(out.glob("*-setup.exe")) or sorted(out.glob("*.exe"))
check(len(installers) == 1, f"one installer in {out} ({[i.name for i in installers]})")
if installers:
    inst = installers[0]
    check(pe_machine(inst) == 0x8664 or pe_machine(inst) == 0x14C, "installer is a Windows PE program")
    check(b"Nullsoft" in inst.read_bytes()[:200000] or b"NSIS" in inst.read_bytes()[:400000], "installer carries the NSIS signature")
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        r = subprocess.run(["7z", "x", "-y", f"-o{tmp}", str(inst)], capture_output=True, text=True)
        check(r.returncode == 0, "installer can be unpacked (7z)")
        contents_ok("installer", tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

zips = sorted(out.glob("*.zip"))
check(len(zips) == 1, f"one portable zip ({[z.name for z in zips]})")
if zips:
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(zips[0]) as z:
            check(z.testzip() is None, "portable zip is intact")
            z.extractall(tmp)
        check((tmp / "TiLT-portable/portable.flag").is_file(), "portable zip has portable.flag (data stays beside the program)")
        contents_ok("portable zip", tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if not fails:
    lines = []
    for p in sorted(out.iterdir()):
        if p.is_file() and p.name != "SHA256SUMS":
            lines.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}")
    (out / "SHA256SUMS").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("\npackage verified (structure only; never executed on Windows)")
sys.exit(1 if fails else 0)
