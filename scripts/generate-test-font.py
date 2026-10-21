"""Optional fixture regeneration: pip install fonttools; python scripts/generate-test-font.py.
The tiny rectangle glyphs are original test data, distributed under the project MIT license.
Normal development, tests and builds use the checked-in TTF and do not need Python.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[1]
fb = FontBuilder(1000, isTTF=True)
names = [".notdef", "space", "A"]
fb.setupGlyphOrder(names)
fb.setupCharacterMap({32: "space", 65: "A"})
glyphs = {}
for name in names:
    pen = TTGlyphPen(None)
    if name != "space":
        pen.moveTo((100, 0)); pen.lineTo((500, 0)); pen.lineTo((500, 700)); pen.lineTo((100, 700)); pen.closePath()
    glyphs[name] = pen.glyph()
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: (600, 0) for name in names})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Castorice Test", "styleName": "Regular", "uniqueFontIdentifier": "CastoriceTest-Regular", "fullName": "Castorice Test Regular", "psName": "CastoriceTest-Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost(); fb.setupMaxp()
dest = root / "backend/internal/testsite/testfont.ttf"
dest.parent.mkdir(parents=True, exist_ok=True)
fb.save(dest)
print(dest)
