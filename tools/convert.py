#!/usr/bin/env python3
"""Make a Kobo dicthtml dictionary show Burmese correctly.

Kobo's dictionary popup has no Burmese font and places Burmese marks
wrongly (for example U+103C). This script shapes every Burmese run with
HarfBuzz ahead of time, stores each distinct shaped glyph as one
Private Use Area character, wraps the runs in a font-family span, and
builds a matching font. The Kobo then only has to draw glyphs left to
right.

Usage:
  python3 convert.py SOURCE_DICTHTML.zip NotoSansMyanmar.(ttf|woff) OUT_DIR
      [--family "Noto Sans Myanmar Kobo"] [--name dicthtml-en-my.zip]

Output (copy into the Kobo drive at the same paths):
  OUT_DIR/.kobo/custom-dict/<name>
  OUT_DIR/fonts/<Family>-Regular.ttf
  OUT_DIR/fonts/kobo/<Family>-Regular.ttf
The dictionary and font must come from the same run.
"""
import argparse, collections, gzip, os, re, shutil, zipfile

import uharfbuzz as hb
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

PUA_START, PUA_END = 0xE000, 0xF8FF
SCALE = 0.85  # shaped glyphs relative to the surrounding Latin text
# Line metrics proven to display well in the Kobo popup.
HHEA = dict(ascent=1324, descent=-860, lineGap=0)
RUN = re.compile("[က-႟ꧠ-꧿ꩠ-ꩿ]+")


def load_base(path, tmp):
    font = TTFont(path)
    font.flavor = None
    font.save(tmp)
    return TTFont(tmp), hb.Font(hb.Face(hb.Blob.from_file_path(tmp)))


class Shaper:
    def __init__(self, hb_font):
        self.hb_font = hb_font
        self.shapes = {}

    def __call__(self, run):
        buf = hb.Buffer()
        buf.add_str(run)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {})
        out = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            key = (info.codepoint, pos.x_advance, pos.x_offset, pos.y_offset)
            if key not in self.shapes:
                cp = PUA_START + len(self.shapes)
                if cp > PUA_END:
                    raise SystemExit("too many distinct shapes for the Private Use Area")
                self.shapes[key] = cp
            out.append(chr(self.shapes[key]))
        return "".join(out)


def convert_dictionary(src, dst, shape, family):
    span = f'<span style="font-family:{family}">'
    runs = 0

    def text(s):
        nonlocal runs

        def sub(m):
            nonlocal runs
            runs += 1
            return span + shape(m.group(0)) + "</span>"

        return RUN.sub(sub, s)

    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        if "words" not in zi.namelist():
            raise SystemExit("not a Kobo dicthtml zip: no 'words' file")
        for info in zi.infolist():
            data = zi.read(info)
            if info.filename.endswith(".html"):
                html = gzip.decompress(data).decode("utf-8")
                parts = re.split(r"(<[^>]*>)", html)
                html = "".join(p if p.startswith("<") else text(p) for p in parts)
                data = gzip.compress(html.encode("utf-8"), 9, mtime=0)
            zo.writestr(info.filename, data)
    return runs


def build_font(base, shapes, family, out):
    glyphs = base.getGlyphSet()
    scale = SCALE * 1000 / base["head"].unitsPerEm
    order = base.getGlyphOrder()
    for (gid, adv, dx, dy), cp in sorted(shapes.items(), key=lambda kv: kv[1]):
        name = f"pua{cp:04X}"
        rec = DecomposingRecordingPen(glyphs)
        glyphs[base.getGlyphName(gid)].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(pen, (scale, 0, 0, scale, dx * scale, dy * scale)))
        glyph = pen.glyph()
        order.append(name)
        base["glyf"][name] = glyph
        glyph.recalcBounds(base["glyf"])
        base["hmtx"][name] = (round(adv * scale), glyph.xMin if glyph.numberOfContours else 0)
        for table in base["cmap"].tables:
            if table.isUnicode():
                table.cmap[cp] = name
    base.setGlyphOrder(order)
    ps = family.replace(" ", "") + "-Regular"
    for rec in base["name"].names:
        if rec.nameID in (1, 4, 16):
            rec.string = family
        elif rec.nameID == 2:
            rec.string = "Regular"
        elif rec.nameID == 3:
            rec.string = ps + "-kobo-dictionary"
        elif rec.nameID == 6:
            rec.string = ps
    for attr, value in HHEA.items():
        setattr(base["hhea"], attr, value)
    os2 = base["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = HHEA["ascent"], HHEA["descent"], 0
    os2.usWinAscent, os2.usWinDescent = HHEA["ascent"], -HHEA["descent"]
    base.save(out)
    return ps + ".ttf"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dictionary")
    ap.add_argument("base_font")
    ap.add_argument("out_dir")
    ap.add_argument("--family", default="Noto Sans Myanmar Kobo")
    ap.add_argument("--name", default="dicthtml-en-my.zip")
    a = ap.parse_args()

    dict_dir = os.path.join(a.out_dir, ".kobo", "custom-dict")
    kobo_dir = os.path.join(a.out_dir, "fonts", "kobo")
    os.makedirs(dict_dir, exist_ok=True)
    os.makedirs(kobo_dir, exist_ok=True)
    tmp = os.path.join(a.out_dir, ".base.ttf")
    base, hb_font = load_base(a.base_font, tmp)
    shape = Shaper(hb_font)
    runs = convert_dictionary(a.dictionary, os.path.join(dict_dir, a.name), shape, a.family)
    font_file = os.path.join(a.out_dir, "fonts", "font.ttf")
    final = build_font(base, shape.shapes, a.family, font_file)
    os.replace(font_file, os.path.join(a.out_dir, "fonts", final))
    shutil.copyfile(os.path.join(a.out_dir, "fonts", final), os.path.join(kobo_dir, final))
    os.remove(tmp)
    print(f"{runs} Burmese runs, {len(shape.shapes)} shapes -> fonts/{final}, .kobo/custom-dict/{a.name}")


if __name__ == "__main__":
    main()
