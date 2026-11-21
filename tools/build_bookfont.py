#!/usr/bin/env python3
"""Make a Myanmar book font that shapes correctly on Kobo's built-in reader.

Kobo's text engine only understands the old 'mymr' OpenType script and
does not reorder or stack Burmese letters itself. Noto fonts only carry
'mym2' rules, so on Kobo their letters come out raw.

This script shapes every Burmese syllable (from a word list plus a
generated set) with HarfBuzz and the real Noto font, stores each result
as one composite glyph, and adds a 'mymr' script whose clig/liga
features replace the typed letters with that finished glyph. The 'mym2'
rules stay, so modern engines keep working.

Usage: build_bookfont.py BASE.ttf CLUSTERS.json OUT.ttf --family NAME --style Regular|Bold [--wght 400]
"""
import argparse, itertools, json, os, tempfile

import uharfbuzz as hb
from fontTools.otlLib.builder import buildLigatureSubstSubtable, buildLookup, buildSingleSubstSubtable
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as ot

CONS = [chr(c) for c in range(0x1000, 0x1022)] + ["ဿ"]
MED = ["", "ျ", "ြ", "ွ", "ှ", "ျွ", "ြွ", "ျှ", "ြှ", "ွှ", "ျွှ", "ြွှ"]
VOW = ["", "ိ", "ီ", "ု", "ူ", "ေ", "ဲ", "ာ", "ါ", "ော", "ေါ", "ို", "ံ", "ုံ", "ိုး"]
TONE = ["", "့", "း", "်", "ံ့", "့်", "ာ်", "ါ်"]


def candidates(corpus, slim=False):
    seen = set(corpus)
    if slim:
        # Real syllables plus the common simple shapes. Kobo can't handle very large fonts.
        for c, m, v in itertools.product(CONS, MED, VOW):
            seen.add(c + m + v)
        for c, v, t in itertools.product(CONS, VOW, TONE):
            seen.add(c + v + t)
        for c1, c2 in itertools.product(CONS, CONS):
            seen.add(c1 + "္" + c2)
        return sorted(seen)
    for c, m, v, t in itertools.product(CONS, MED, VOW, TONE):
        s = c + m + v + t
        if s not in seen:
            seen.add(s)
    # kinzi and stacked consonants: C + virama + C2 (+ medial/vowel)
    for c1, c2 in itertools.product(CONS, CONS):
        for v in ("", "ာ", "ိ", "ု", "ေ", "ော"):
            seen.add(c1 + "္" + c2 + v)
        seen.add("င်္" + c2)
    return sorted(seen)


def shape(hb_font, text):
    b = hb.Buffer()
    b.add_codepoints([ord(x) for x in text])
    b.guess_segment_properties()
    hb.shape(hb_font, b, {})
    return b.glyph_infos, b.glyph_positions


def instance(path, wght):
    font = TTFont(path)
    if "fvar" in font:
        from fontTools.varLib import instancer
        axes = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        axes["wght"] = wght
        font = instancer.instantiateVariableFont(font, axes)
    return font


def add_mymr(font, lookups):
    for tag in ("GSUB", "GPOS"):
        table = font[tag].table
        recs = table.ScriptList.ScriptRecord
        # Drop any old 'mymr' rules (e.g. Padauk's): they rely on features Kobo does not run.
        recs[:] = [r for r in recs if r.ScriptTag != "mymr"]
        ls = ot.LangSys()
        ls.LookupOrder = None
        ls.ReqFeatureIndex = 0xFFFF
        if tag == "GSUB":
            idx = []
            for ftag in ("clig", "liga"):
                fr = ot.FeatureRecord()
                fr.FeatureTag = ftag
                fr.Feature = ot.Feature()
                fr.Feature.FeatureParams = None
                fr.Feature.LookupListIndex = list(lookups)
                fr.Feature.LookupCount = len(lookups)
                table.FeatureList.FeatureRecord.append(fr)
                idx.append(len(table.FeatureList.FeatureRecord) - 1)
            ls.FeatureIndex = idx
        else:
            # No positioning: every syllable is already one finished glyph, and
            # Kobo's engine places leftover marks wrongly.
            ls.FeatureIndex = []
        ls.FeatureCount = len(ls.FeatureIndex)
        sr = ot.ScriptRecord()
        sr.ScriptTag = "mymr"
        sr.Script = ot.Script()
        sr.Script.DefaultLangSys = ls
        sr.Script.LangSysRecord = []
        sr.Script.LangSysCount = 0
        recs.append(sr)
        recs.sort(key=lambda r: r.ScriptTag)
        table.ScriptList.ScriptCount = len(recs)
        sort_features(table)


def sort_features(table):
    frs = table.FeatureList.FeatureRecord
    order = sorted(range(len(frs)), key=lambda i: (frs[i].FeatureTag, i))
    remap = {old: new for new, old in enumerate(order)}
    table.FeatureList.FeatureRecord = [frs[i] for i in order]
    table.FeatureList.FeatureCount = len(frs)
    for sr in table.ScriptList.ScriptRecord:
        for ls in [sr.Script.DefaultLangSys] + [r.LangSys for r in sr.Script.LangSysRecord]:
            if ls:
                ls.FeatureIndex = sorted(remap[i] for i in ls.FeatureIndex)


def scale_metrics(font, s):
    hhea, os2 = font["hhea"], font["OS/2"]
    hhea.ascent, hhea.descent = round(hhea.ascent * s), round(hhea.descent * s)
    os2.sTypoAscender, os2.sTypoDescender = hhea.ascent, hhea.descent
    os2.sTypoLineGap = hhea.lineGap = 0
    if os2.version >= 4:
        os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    glyf = font["glyf"]
    tops = [glyf[n].yMax for n in font.getGlyphOrder() if glyf[n].numberOfContours]
    bottoms = [glyf[n].yMin for n in font.getGlyphOrder() if glyf[n].numberOfContours]
    os2.usWinAscent = max(hhea.ascent, max(tops))
    os2.usWinDescent = max(-hhea.descent, -min(bottoms))


def set_line_height(font, total, center=0.24):
    """Default line height ("normal") of `total` em, centred on Burmese letters.

    Burmese marks stack above and below, so it needs more space between lines
    than English. Ink of a typical line runs from about +0.95 to -0.47 em; its
    middle is `center` em above the baseline.
    """
    upm = font["head"].unitsPerEm
    asc = round((center + total / 2) * upm)
    desc = asc - round(total * upm)
    hhea, os2 = font["hhea"], font["OS/2"]
    hhea.ascent, hhea.descent, hhea.lineGap = asc, desc, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, desc, 0
    if os2.version >= 4:
        os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    glyf = font["glyf"]
    boxes = [glyf[n] for n in font.getGlyphOrder() if glyf[n].numberOfContours]
    os2.usWinAscent = max(asc, max(g.yMax for g in boxes))
    os2.usWinDescent = max(-desc, -min(g.yMin for g in boxes))


def rename(font, family, style):
    ps = family.replace(" ", "") + "-" + style
    name = font["name"]
    name.names = [n for n in name.names if n.nameID not in (16, 17, 21, 22, 25)]
    for n in name.names:
        if n.nameID == 1:
            n.string = family
        elif n.nameID == 2:
            n.string = style
        elif n.nameID == 3:
            n.string = ps + "-kobo-book"
        elif n.nameID == 4:
            n.string = family if style == "Regular" else f"{family} {style}"
        elif n.nameID == 6:
            n.string = ps
    bold = style == "Bold"
    os2 = font["OS/2"]
    os2.usWeightClass = 700 if bold else 400
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if bold else 0b1000000)
    font["head"].macStyle = 1 if bold else 0
    for t in ("STAT", "fvar", "gvar", "avar", "HVAR", "MVAR"):
        if t in font:
            del font[t]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base")
    ap.add_argument("clusters")
    ap.add_argument("out")
    ap.add_argument("--family", required=True)
    ap.add_argument("--style", choices=["Regular", "Bold"], default="Regular")
    ap.add_argument("--wght", type=float, default=400)
    ap.add_argument("--line", type=float, default=0,
                    help="default line height in em (e.g. 2.0); 0 keeps the base font's")
    ap.add_argument("--slim", action="store_true",
                    help="only real syllables (from CLUSTERS.json) and common shapes: a much smaller font")
    ap.add_argument("--scale", type=float, default=0.82,
                    help="Burmese size inside the em; smaller fits Kobo's fixed line height")
    a = ap.parse_args()
    s = a.scale

    font = instance(a.base, a.wght)
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "base.ttf")
        font.save(p)
        font = TTFont(p)
        hb_font = hb.Font(hb.Face(hb.Blob.from_file_path(p)))
        cmap = font.getBestCmap()
        order = font.getGlyphOrder()
        glyf, hmtx = font["glyf"], font["hmtx"]
        dotted = cmap.get(0x25CC)
        ligs, made = {}, {}
        corpus = json.load(open(a.clusters, encoding="utf-8"))
        singles, small = {}, {}
        gs = font.getGlyphSet()

        def scaled(n):
            # A plain (not composite) copy of glyph n at size s, so composites never need scaled components.
            if n not in small:
                rec = DecomposingRecordingPen(gs)
                gs[n].draw(rec)
                pen = TTGlyphPen(None)
                rec.replay(TransformPen(pen, (s, 0, 0, s, 0, 0)))
                g = pen.glyph()
                small[n] = f"{n}.kobo"
                order.append(small[n])
                glyf[small[n]] = g
                g.recalcBounds(glyf)
                hmtx[small[n]] = (round(hmtx[n][0] * s), g.xMin if g.numberOfContours else 0)
            return small[n]
        for text in candidates(corpus, a.slim) + [chr(c) for c in range(0x1000, 0x10A0)]:
            if any(ord(ch) not in cmap for ch in text):
                continue
            infos, poss = shape(hb_font, text)
            names = [order[i.codepoint] for i in infos]
            if any(i.cluster != 0 for i in infos) or dotted in names:
                continue  # not one valid syllable
            nominal = [cmap[ord(ch)] for ch in text]
            key = tuple((n, p.x_advance, p.x_offset, p.y_offset) for n, p in zip(names, poss))
            if key not in made:
                pen, x = TTGlyphPen(glyf), 0
                for n, p in zip(names, poss):
                    if glyf[n].numberOfContours != 0:
                        pen.addComponent(scaled(n), (1, 0, 0, 1, round((x + p.x_offset) * s), round(p.y_offset * s)))
                    x += p.x_advance
                x = round(x * s)
                g = pen.glyph()
                gname = f"mm{len(made):05d}"
                order.append(gname)
                glyf[gname] = g
                g.recalcBounds(glyf)
                hmtx[gname] = (x, g.xMin if g.numberOfContours else 0)
                made[key] = gname
            if len(nominal) == 1:
                singles[nominal[0]] = made[key]
            else:
                ligs[tuple(nominal)] = made[key]
        if len(order) > 65535:
            raise SystemExit(f"too many glyphs: {len(order)}")
        font.setGlyphOrder(order)
        scale_metrics(font, s)
        if a.line:
            set_line_height(font, a.line)
        # Whole syllables first, then single letters that need a change.
        ll = font["GSUB"].table.LookupList
        first = len(ll.Lookup)
        ll.Lookup.append(buildLookup([buildLigatureSubstSubtable(ligs)]))
        if singles:
            ll.Lookup.append(buildLookup([buildSingleSubstSubtable(singles)]))
        ll.LookupCount = len(ll.Lookup)
        add_mymr(font, list(range(first, ll.LookupCount)))
        rename(font, a.family, a.style)
        font.save(a.out)
    print(f"{a.out}: {len(ligs)} syllables, {len(singles)} single letters, {len(made)} new glyphs, {os.path.getsize(a.out)//1024} KB")


if __name__ == "__main__":
    main()
