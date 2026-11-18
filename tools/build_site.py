#!/usr/bin/env python3
"""Copy the built Kobo files into site/files and write site/manifest.json.

Run after tools/convert.py. Usage: python3 tools/build_site.py
"""
import gzip, hashlib, json, os, re, shutil, zipfile

VERSION = "1.0"
DATE = "2026-11-18"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = os.path.join(ROOT, "site")

FILES = [
    ("dictionary", ".kobo/custom-dict/dicthtml-en-my.zip", [".kobo/custom-dict/dicthtml-en-my.zip"]),
    ("font", "fonts/NotoSansMyanmarKobo-Regular.ttf",
     ["fonts/NotoSansMyanmarKobo-Regular.ttf", "fonts/kobo/NotoSansMyanmarKobo-Regular.ttf"]),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def count_words(path):
    with zipfile.ZipFile(path) as z:
        return sum(len(re.findall(rb"<w>", gzip.decompress(z.read(n))))
                   for n in z.namelist() if n.endswith(".html"))


def main():
    out = os.path.join(SITE, "files")
    os.makedirs(out, exist_ok=True)
    files = []
    for fid, src, dest in FILES:
        path = os.path.join(DIST, src)
        for other in dest[1:]:
            if sha256(os.path.join(DIST, other)) != sha256(path):
                raise SystemExit(f"dist/{other} differs from dist/{src}")
        name = os.path.basename(src)
        shutil.copyfile(path, os.path.join(out, name))
        files.append({"id": fid, "url": f"files/{name}", "size": os.path.getsize(path),
                      "sha256": sha256(path), "dest": dest})
    manifest = {
        "name": "Ornagai Dictionary Kit for Kobo eReader",
        "version": VERSION,
        "date": DATE,
        "words": count_words(os.path.join(DIST, FILES[0][1])),
        "files": files,
        "tested": [{"serialPrefix": "N428", "model": "Kobo Libra Colour", "firmware": "4.46.23852"}],
    }
    with open(os.path.join(SITE, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"site/manifest.json: version {VERSION}, {manifest['words']} words, {len(files)} files")


if __name__ == "__main__":
    main()
