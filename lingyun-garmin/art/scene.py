"""Scenery, effects and icons."""
import random
from pixel import Layer

LAND_W, LAND_H, GROUND = 128, 40, 33  # ground line row inside the strip


def ridge(layer, peaks, base, colour, light, snow=None):
    """Fill a mountain range under straight slopes between peaks."""
    xs = range(layer.w)
    for x in xs:
        top = base
        for px, py, half in peaks:
            d = abs(x - px)
            if d <= half:
                top = min(top, py + (base - py) * d / half)
        top = int(round(top))
        for y in range(top, base + 1):
            layer.set(x, y, colour)
        # Moonlight on the left-facing slopes.
        for px, py, half in peaks:
            if px - half <= x < px and abs(top - (py + (base - py) * (px - x) / half)) < 1:
                layer.set(x, top, light)
                if snow and top < py + 2:
                    layer.set(x, top, snow)


def pine(layer, x, y, h):
    """A small pine with its foot at (x, y)."""
    for i in range(h):
        half = (h - i) // 2
        if i % 2 == 0:
            half = max(0, half - 1)
        layer.rect(x - half, y - i, x + half, y - i, "p")
        layer.set(x - half, y - i, "P")
    layer.set(x, y - h, "P")


def land():
    L = Layer(LAND_W, LAND_H)
    ridge(L, [(12, 6, 22), (44, 2, 26), (80, 8, 22), (112, 3, 24)], 24, "m", "M", snow="q")
    # Pavilion on the tallest peak.
    L.stamp("""
...XX...
.XXXXXX.
XXXXXXXX
.kyk.kyk
.k.k.k.k
""", 40, 0)
    ridge(L, [(0, 19, 20), (30, 17, 18), (64, 21, 20), (96, 16, 18), (128, 19, 18)], GROUND, "k", "n")
    rnd = random.Random(7)
    for x in [4, 10, 19, 27, 88, 97, 105, 114, 122]:
        pine(L, x, GROUND - 1, rnd.choice([6, 7, 8]))
    L.rect(0, GROUND, LAND_W - 1, GROUND, "x")
    L.rect(0, GROUND + 1, LAND_W - 1, LAND_H - 1, "k")
    for x in range(1, LAND_W, 5):
        L.set(x, GROUND + 1, "x")
    return L


def moon():
    L = Layer(13, 13)
    L.disc(6.5, 6.5, 6, 6, "y")
    L.disc(9, 4.5, 5, 5, None)
    for x, y in [(3, 8), (4, 9), (2, 6), (5, 10)]:
        if L.get(x, y) == "y":
            L.set(x, y, "a")
    return L


def drift_cloud(variant=0):
    L = Layer(20, 7)
    if variant == 0:
        L.rect(3, 3, 17, 5, "e")
        L.disc(7, 3, 3, 2.5, "e")
        L.disc(12, 2.5, 4, 2.5, "e")
        L.rect(4, 5, 16, 5, "n")
    else:
        L.rect(2, 3, 14, 5, "e")
        L.disc(6, 3, 3.5, 2.5, "e")
        L.disc(11, 3.5, 3, 2, "e")
        L.rect(3, 5, 13, 5, "n")
    return L


def ride_cloud(frame=0):
    """祥云: a curled cloud to ride, 32x11."""
    L = Layer(32, 11)
    shift = frame
    for cx, cy, r in [(9, 5, 4), (16, 4, 5), (23, 5, 4), (12 + shift, 7, 3), (20 - shift, 7, 3)]:
        L.disc(cx, cy, r, r * 0.8, "w")
    L.map(lambda x, y, c: "q" if y >= 7 else c)
    # Curls.
    for x, y in [(8, 4), (9, 3), (10, 4), (22, 4), (23, 3), (24, 4)]:
        L.set(x, y, "C")
    # Trailing wisps.
    L.rect(1 + shift, 8, 5 + shift, 8, "q")
    L.rect(26 - shift, 9, 30 - shift, 9, "q")
    L.outline("e")
    return L


def shadow():
    L = Layer(16, 3)
    L.disc(8, 1.5, 7.5, 1.5, "u")
    return L


def zzz():
    L = Layer(9, 9)
    L.stamp("""
.....qqqq
.......q.
......q..
.....qqqq
qqq......
..q......
.q.......
qqq......
""", 0, 0)
    return L


def orb(r):
    """Breathing orb: a core with glow rings; r is the outer radius."""
    size = 2 * r + 2
    L = Layer(size, size)
    c = size / 2
    L.disc(c, c, r, r, "N")
    L.disc(c, c, r * 0.78, r * 0.78, "c")
    L.disc(c, c, r * 0.5, r * 0.5, "C")
    L.disc(c, c, r * 0.25, r * 0.25, "w")
    return L


def twinkle(colour="Y"):
    L = Layer(5, 5)
    L.stamp("""
..a..
..a..
aawaa
..a..
..a..
""", 0, 0, keymap={"a": colour})
    return L


def spark():
    L = Layer(11, 11)
    L.stamp("""
.....Y.....
..Y..Y..Y..
...Y.o.Y...
....ooo....
YYooowoooYY
....ooo....
...Y.o.Y...
..Y..Y..Y..
.....Y.....
""", 0, 1)
    return L


ICONS = {
    # 9x9: body fist, agility feather, qi flame, mind lotus, steps, floors, intensity heart
    "fist": """
.........
kk.....kk
kgk...kgk
kgkkkkkgk
kgwwwwwgk
kgkkkkkgk
kgk...kgk
kk.....kk
.........
""",
    "feather": """
.......kk
......kCk
.....kCCk
....kCcCk
...kCcCk.
..kCcCk..
.kCcck...
.kcck....
k.kk.....
""",
    "flame": """
....k....
...kYk...
..kYok...
.kYooYk..
.kooXok..
kYoXXoYk.
kooXXook.
.kooook..
..kkkk...
""",
    "lotus": """
....k....
...kbk...
.k.kbk.k.
kbkbwbkbk
kbbbwbbbk
.kbbbbbk.
..kkkkk..
.kPPPPPk.
..kkkkk..
""",
    "foot": """
.k.k.k...
ksksksk..
kssssssk.
.kssssk..
.kssssk..
..kssk...
..kssk...
...kk....
.........
""",
    "stairs": """
......kkk
......kwk
....kkkwk
....kwwwk
..kkkwwwk
..kwwwwwk
kkkwwwwwk
kwwwwwwwk
kkkkkkkkk
""",
    "heart": """
.kk...kk.
kbbk.kbbk
kbwbkbbbk
kbbbbbbbk
kbbbbbbbk
.kbbbbbk.
..kbbbk..
...kbk...
....k....
""",
}


def icon(name):
    L = Layer(9, 9)
    L.stamp(ICONS[name], 0, 0)
    return L
