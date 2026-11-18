# Kobo Myanmar Dictionary

English → Burmese dictionary for Kobo eReaders, with Burmese shown correctly in the dictionary popup. No firmware patch is needed.

Tested on a Kobo Libra Colour, firmware 4.46.23852.

## Install

Connect the Kobo, tap **Connect**, and copy these 3 files to the same paths on the `KOBOeReader` drive. Copy files, not whole folders: on a Mac, dragging a folder like `.kobo` can replace the Kobo's folder instead of merging it.

| File in `dist/` | Copy to Kobo |
| --- | --- |
| `.kobo/custom-dict/dicthtml-en-my.zip` | `.kobo/custom-dict/` (create the folder if missing) |
| `fonts/NotoSansMyanmarKobo-Regular.ttf` | `fonts/` |
| `fonts/kobo/NotoSansMyanmarKobo-Regular.ttf` | `fonts/kobo/` |

`.kobo` is hidden. On a Mac press **Cmd + Shift + .** in Finder; on Windows tick **View → Hidden items**.

Both font copies are required. With only one of them, Burmese stays blank.

**Optional, for the name `English - ဗမာ (Custom)` in the dictionary list:** open `.kobo/Kobo/Kobo eReader.conf` in a plain-text editor and add this line under `[ApplicationPreferences]`:

```
GeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Noto Sans Myanmar Kobo
```

Without it, Burmese definitions still work, but the list shows boxes. If you skip this step, rename the dictionary to `dicthtml-en-mm.zip` so the list shows the file name instead.

Then eject, power the Kobo fully off and on, open a book, long-press an English word, and pick the dictionary.

**Noto Sans Myanmar Kobo** will appear in the book font list. Don't use it for books: it is made for the dictionary.

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

## Web installer: Kobo English–Myanmar Dictionary Kit

`site/` is a static website that installs, checks and removes the dictionary straight from the browser (Chrome or Edge on a computer). Other browsers get download links and manual steps. English is the default; Burmese is one click away.

Run it locally:

```bash
python3 tools/build_site.py
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. `build_site.py` copies the files from `dist/` into `site/files/` and writes `site/manifest.json` with their checksums. The site checks every file it writes, backs up the Kobo settings file to `.adds/kobo-myanmar-kit/`, and Remove puts the settings back.

Tests for the install/remove logic: `npm test`.

## Build your own

```bash
pip install -r tools/requirements.txt
python3 tools/convert.py SOURCE-dicthtml.zip NotoSansMyanmar-Regular.ttf dist
```

`SOURCE-dicthtml.zip` is any Kobo dicthtml dictionary with normal Unicode Burmese. The base font is Noto Sans Myanmar (for example from Google Fonts or the `@fontsource/noto-sans-myanmar` package). A dictionary and its font must come from the same run.

The same input always builds the same files.

## Credits and licenses

- Code: MIT, see `LICENSE`.
- Font: built from Noto Sans Myanmar, © 2022 The Noto Project Authors, SIL Open Font License 1.1, see `licenses/`. Noto is a trademark of Google LLC; this is an unofficial modified version.
- Dictionary data: from [Ornagai](https://www.ornagai.com). **License not confirmed yet.** Do not make this repository public until the dictionary's terms are confirmed.
- Not affiliated with Kobo or Rakuten.
