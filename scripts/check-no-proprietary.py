#!/usr/bin/env python3
"""Fail if a directory tree contains something that looks like a Kickstart ROM, a DMS/ADF disk,
or a hard disk image. Amiga Studio must never ship or commit user-supplied/proprietary media.

Usage: check-no-proprietary.py <dir> [<dir> ...]
Skips .git, node_modules and target. Exit status 1 when anything suspicious is found.
"""
import os
import struct
import sys

SKIP = {".git", "node_modules", "target", "dist"}
ADF_SIZES = {901120, 1802240}


def kick_like(head: bytes, size: int) -> bool:
    return (
        size in (0x20000, 0x40000, 0x80000, 0x100000)
        and len(head) >= 4
        and head[0:2] in (b"\x11\x11", b"\x11\x14")
        and head[2:4] == b"\x4e\xf9"
    )


def main(roots):
    bad = []
    for root in roots:
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP]
            for name in fn:
                p = os.path.join(dp, name)
                try:
                    size = os.path.getsize(p)
                    with open(p, "rb") as f:
                        head = f.read(16)
                except OSError:
                    continue
                if kick_like(head, size):
                    bad.append((p, "looks like a Kickstart ROM"))
                elif head.startswith(b"AMIROMTYPE1"):
                    bad.append((p, "encrypted Amiga Forever ROM"))
                elif head.startswith(b"DMS!"):
                    bad.append((p, "DMS archive"))
                elif size in ADF_SIZES and head[:3] == b"DOS":
                    bad.append((p, "AmigaDOS disk image"))
                elif size >= 4096 and head[:4] == b"RDSK":
                    bad.append((p, "hard disk image with an RDB"))
    for p, why in bad:
        print(f"PROPRIETARY-MEDIA GUARD: {p}: {why}", file=sys.stderr)
    if not bad:
        print("no Amiga ROM/disk media found")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["."]))
