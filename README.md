# Kobo Myanmar Dictionary

English → Burmese dictionary for Kobo eReaders, with Burmese shown correctly in the dictionary popup. No firmware patch is needed.

Tested on a Kobo Libra Colour, firmware 4.46.23852.

## Install

Connect the Kobo, tap **Connect**, and copy these 3 files to the same paths on the `KOBOeReader` drive. Copy files, not whole folders: on a Mac, dragging a folder like `.kobo` can replace the Kobo's folder instead of merging it.

| File in `dist/` | Copy to Kobo |
| --- | --- |
| `.kobo/custom-dict/dicthtml-en-my.zip` | `.kobo/custom-dict/` (create the folder if missing) |
| `fonts/NotoSansMyanmarKoboDict-Regular.ttf` | `fonts/` |
| `fonts/kobo/NotoSansMyanmarKoboDict-Regular.ttf` | `fonts/kobo/` |

`.kobo` is hidden. On a Mac press **Cmd + Shift + .** in Finder; on Windows tick **View → Hidden items**.

Both font copies are required. With only one of them, Burmese stays blank.

**Optional, for the name `English - ဗမာ (Custom)` in the dictionary list:** open `.kobo/Kobo/Kobo eReader.conf` in a plain-text editor and add this line under `[ApplicationPreferences]`:

```
GeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Noto Sans Myanmar Kobo Dict
```

Without it, Burmese definitions still work, but the list shows boxes. If you skip this step, rename the dictionary to `dicthtml-en-mm.zip` so the list shows the file name instead.

Then eject, power the Kobo fully off and on, open a book, long-press an English word, and pick the dictionary.

**Noto Sans Myanmar Kobo Dict** will appear in the book font list. Don't use it for books: it is made for the dictionary.

## Uninstall

Delete the 3 files, remove the settings line if you added it, and restart.

## How it works

Kobo's dictionary popup has no Burmese font, and its text engine places some Burmese marks wrongly, such as `ြ`. `tools/convert.py` shapes every Burmese run with HarfBuzz ahead of time, turns each distinct shaped glyph into one Private Use Area character, and builds a font with exactly those glyphs. The Kobo then only draws glyphs left to right.

What was tested on the device:

| Font in `fonts/` | Font in `fonts/kobo/` | Settings line | Burmese |
| --- | --- | --- | --- |
| Yes | No | No | Blank |
| Yes | No | Yes | Blank |
| No | Yes | No | Blank |
| Yes | Yes | No | Shows |
| Yes | Yes | Yes | Shows, and list name shows `ဗမာ` |

## Web installer: Kobo Myanmar Dictionary & Font Installer

`site/` is a static website that installs, checks and removes the dictionary straight from the browser (Chrome or Edge on a computer). Other browsers (Safari, Firefox, phones) are asked to open the page in a Chromium browser. English is the default; Burmese is one click away.

Run it locally:

```bash
python3 tools/build_site.py
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. `build_site.py` copies the files from `dist/` into `site/files/` and writes `site/manifest.json` with their checksums. The site checks every file it writes, backs up the Kobo settings file to `.adds/kobo-myanmar-kit/`, and Remove puts the settings back.

Tests for the install/remove logic: `npm test`.

### Fonts the kit installs

| Font name on the Kobo | What it is for |
| --- | --- |
| Noto Sans Myanmar Kobo Dict | The dictionary popup only. Don't pick it for books: Burmese looks broken there. |
| Noto Sans Myanmar Kobo Reader | Reading Burmese books (Aa → font). Optional, ticked by default. |
| Thitsar Kobo Reader | Same, made from Padauk (renamed: Padauk is a reserved font name). Optional, ticked by default. |
| Pyidaungsu Kobo Reader | Same, made from Pyidaungsu. Optional, ticked by default. |

Installing also removes fonts with the kit's older names (Noto Sans Myanmar Kobo, Noto Sans Myanmar Kobo Book).

The reading fonts are made by `tools/build_bookfont.py`: it shapes every Burmese syllable with HarfBuzz and stores each one as a single glyph, because Kobo's reader cannot shape Burmese itself. They work for Unicode Burmese books only; old Zawgyi books look wrong in any Unicode font.

- **Small on purpose.** Each font holds the ~12,000 syllables found in real books plus common shapes (`--slim`), about 1.1–1.7 MB. Fonts with every possible combination were 3.8 MB each, and with about 40 MB of them in `fonts/` the Burmese dictionary stopped showing. Lots of extra fonts do the same, so the kit warns above 50 fonts.
- **Taller lines.** Burmese marks stack above and below the letters, so the fonts set a default line height of 2.0 em (`--line 2.0`), centred on the Burmese letters. Books that set their own `line-height` in CSS override this, and Kobo's line spacing slider too.

Build one (CLUSTERS.json is a syllable count from your books and the dictionary):

```bash
python3 tools/build_bookfont.py NotoSansMyanmar.ttf CLUSTERS.json NotoSansMyanmarKoboReader-Regular.ttf \
  --family "Noto Sans Myanmar Kobo Reader" --style Regular --wght 400 --scale 0.82 --slim --line 2.0
```

## Build your own

```bash
pip install -r tools/requirements.txt
python3 tools/convert.py SOURCE-dicthtml.zip NotoSansMyanmar-Regular.ttf dist
```

`SOURCE-dicthtml.zip` is any Kobo dicthtml dictionary with normal Unicode Burmese. The base font is Noto Sans Myanmar (for example from Google Fonts or the `@fontsource/noto-sans-myanmar` package). A dictionary and its font must come from the same run.

The same input always builds the same files.

## Credits and licenses

- Code: MIT, see `LICENSE`.
- Fonts: built from Noto Sans Myanmar, © 2022 The Noto Project Authors, SIL Open Font License 1.1, see `licenses/`. Noto is a trademark of Google LLC; this is an unofficial modified version.
- Reading fonts also built from Padauk (© SIL International) and Pyidaungsu (© MCF), SIL Open Font License 1.1, see `licenses/OFL-1.1-reading-fonts.txt`.
- Dictionary data: from [Ornagai](https://www.ornagai.com). **License not confirmed yet.** Do not make this repository public until the dictionary's terms are confirmed.
- Not affiliated with Kobo or Rakuten.
