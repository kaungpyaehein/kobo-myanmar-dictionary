#!/usr/bin/env python3
"""Copy the built Kobo files into site/files and write site/manifest.json.

Run after tools/convert.py. Usage: python3 tools/build_site.py
"""
import gzip, hashlib, json, os, re, shutil, zipfile

VERSION = "1.1"
DATE = "2026-11-21"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = os.path.join(ROOT, "site")

# (id, file in dist/, places on the Kobo, reading-font family or None)
FILES = [
    ("dictionary", ".kobo/custom-dict/dicthtml-en-my.zip", [".kobo/custom-dict/dicthtml-en-my.zip"], None),
    ("font", "fonts/NotoSansMyanmarKoboDict-Regular.ttf",
     ["fonts/NotoSansMyanmarKoboDict-Regular.ttf", "fonts/kobo/NotoSansMyanmarKoboDict-Regular.ttf"], None),
]
# Fonts for reading Burmese books (made by tools/build_bookfont.py). Each family is optional.
for fam in ("Noto Sans Myanmar Kobo Reader", "Thitsar Kobo Reader", "Pyidaungsu Kobo Reader"):
    for style in ("Regular", "Bold"):
        name = f"fonts/{fam.replace(' ', '')}-{style}.ttf"
        if os.path.exists(os.path.join(DIST, name)):
            FILES.append(("readingFont", name, [name], fam))


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
    for fid, src, dest, family in FILES:
        path = os.path.join(DIST, src)
        for other in dest[1:]:
            if sha256(os.path.join(DIST, other)) != sha256(path):
                raise SystemExit(f"dist/{other} differs from dist/{src}")
        name = os.path.basename(src)
        shutil.copyfile(path, os.path.join(out, name))
        entry = {"id": fid, "url": f"files/{name}", "size": os.path.getsize(path),
                 "sha256": sha256(path), "dest": dest}
        if family:
            entry.update(optional=True, family=family)
        files.append(entry)
    manifest = {
        "name": "Kobo Myanmar Dictionary & Font Installer",
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
