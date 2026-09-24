"""The chibi hero: one pose = head + robe + legs + arms, each outlined
separately so limbs read in front of the body. 32x32 canvas, feet on row 30.

Robe and sash use template colours (R r L / W V); export.py recolours them
per sect.
"""
from pixel import Layer

W, H = 32, 32
CX = 16


def head(eyes="open", dy=0, tilt=0):
    """16x16 head layer; eyes: open, closed, fierce, happy."""
    L = Layer(16, 16)
    L.disc(8, 2.6, 2.4, 2.1, "h")  # bun
    L.rect(6, 4, 9, 4, "W")  # hair tie in the sash colour
    L.disc(8, 9.6, 7.0, 6.1, "s")
    for y in range(16):
        for x in range(16):
            if L.get(x, y) != "s":
                continue
            side = y < 12 and (x < 2 or x > 13)
            if y < 7 or side:
                L.set(x, y, "h")
    # Fringe: uneven tips over the forehead.
    for x, y in [(3, 7), (4, 7), (6, 7), (7, 7), (8, 7), (10, 7), (11, 7), (12, 7), (4, 8), (7, 8), (11, 8), (2, 8), (13, 8)]:
        L.set(x, y, "h")
    L.set(4, 4, "g")
    L.set(5, 4, "g")
    L.set(3, 5, "g")
    # Skin shade along the right cheek.
    for y in range(8, 15):
        for x in range(15, 1, -1):
            if L.get(x, y) == "s":
                L.set(x, y, "d")
                break
    if eyes in ("open", "fierce"):
        for x in (4, 10):
            L.rect(x, 10, x + 1, 11, "k")
            L.set(x + 1, 10, "w")
        if eyes == "fierce":
            L.set(4, 9, "k")
            L.set(5, 9, "k")
            L.set(10, 9, "k")
            L.set(11, 9, "k")
    elif eyes == "happy":
        for x0 in (3, 9):
            L.set(x0, 11, "k")
            L.set(x0 + 1, 10, "k")
            L.set(x0 + 2, 11, "k")
    else:  # closed
        for x0 in (3, 10):
            L.set(x0, 11, "k")
            L.set(x0 + 1, 11, "k")
            L.set(x0 + 2, 11, "k")
    L.set(3, 12, "b")
    L.set(12, 12, "b")
    L.set(13, 12, "b") if L.get(13, 12) == "s" else None
    L.set(7, 13, "d")
    L.set(8, 13, "d")
    L.outline("k")
    out = Layer(16, 16)
    out.over(L, 0, 0)
    return out


def robe(flutter=0, hem=24, wide=0):
    """Robe from the shoulders (row 15) to the hem, with sash and collar.
    flutter > 0 adds tails streaming to the left (flight)."""
    L = Layer(W, H)
    L.poly([(12, 15), (20, 15), (22 + wide, hem + 1), (10 - wide, hem + 1)], "R")
    if flutter:
        L.poly([(10, hem - 3), (12, hem - 1), (4 - flutter, hem + 1 + flutter // 2), (6 - flutter, hem - 2)], "R")
        L.poly([(21, hem - 2), (23, hem), (18, hem + 2)], "R")
    # Shade the right side, light the left edge.
    def tone(x, y, c):
        if c != "R":
            return c
        if x >= 19 + (y - 15) * 0.25:
            return "r"
        if L.get(x - 1, y) is None:
            return "L"
        return c
    L.map(tone)
    # Crossed collar and inner shirt.
    for i in range(3):
        L.set(14 + i, 15 + i, "L")
        L.set(18 - i, 15 + i, "L")
    L.set(16, 15, "w")
    L.set(15, 15, "w")
    L.set(17, 15, "w")
    # Sash with a knot and a hanging tail.
    for y in (19, 20):
        for x in range(W):
            if L.get(x, y) in ("R", "r", "L"):
                L.set(x, y, "W" if y == 19 else "V")
    L.set(13, 21, "W")
    L.set(13, 22, "V")
    L.set(12, 22, "W")
    L.set(12, 23, "V")
    L.outline("k")
    return L


LEGS = {
    # hip -> knee -> foot for the left and right leg
    "stand": [((14, 24), (14, 27), (13, 29)), ((18, 24), (18, 27), (19, 29))],
    "horse": [((13, 23), (10, 26), (9, 29)), ((19, 23), (22, 26), (23, 29))],
    "crane": [((14, 24), (14, 27), (14, 29)), ((18, 23), (21, 24), (19, 27))],
    "crouch": [((13, 24), (10, 27), (12, 29)), ((19, 24), (22, 27), (20, 29))],
    "air": [((14, 23), (12, 26), (14, 27)), ((18, 23), (21, 25), (20, 28))],
    "trail": [((14, 23), (12, 26), (9, 27)), ((18, 23), (16, 26), (13, 28))],
}


def legs(kind):
    L = Layer(W, H)
    feet = []
    for hip, knee, foot in LEGS[kind]:
        L.line(*hip, *knee, "t", 2)
        L.line(*knee, *foot, "t", 2)
        feet.append(foot)
    for fx, fy in feet:
        L.rect(fx - 1, fy + 1, fx + 1, fy + 1, "f")
    L.map(lambda x, y, c: "u" if c == "t" and L.get(x + 1, y) is None else c)
    L.outline("k")
    return L


def arm(shoulder, elbow, hand, fist=True):
    L = Layer(W, H)
    L.line(*shoulder, *elbow, "R", 2)
    L.line(*elbow, *hand, "R", 2)
    L.map(lambda x, y, c: "r" if L.get(x, y + 1) is None else c)
    hx, hy = hand
    L.rect(hx - 1, hy - 1, hx, hy, "s")
    if not fist:
        L.set(hx + 1, hy - 1, "s")
    L.outline("k")
    return L


ARMS = {
    # (shoulder, elbow, hand) for back arm then front arm
    "hang": [((12, 16), (11, 19), (11, 22)), ((20, 16), (21, 19), (22, 22))],
    "salute": [((12, 16), (11, 19), (15, 18)), ((20, 16), (21, 19), (17, 18))],
    "chamber": [((12, 16), (11, 19), (12, 21)), ((20, 16), (22, 19), (21, 21))],
    "push": [((12, 16), (11, 19), (12, 21)), ((20, 16), (24, 17), (28, 17))],
    "hold": [((12, 16), (10, 18), (13, 20)), ((20, 16), (22, 18), (19, 20))],
    "wings": [((12, 16), (8, 15), (4, 13)), ((20, 16), (24, 15), (28, 13))],
    "knees": [((12, 16), (10, 20), (9, 24)), ((20, 16), (22, 20), (23, 24))],
    "up": [((12, 16), (10, 12), (9, 9)), ((20, 16), (22, 12), (23, 9))],
    "crane": [((12, 16), (8, 16), (6, 14)), ((20, 16), (23, 14), (22, 11))],
    "slump": [((12, 17), (11, 20), (11, 23)), ((20, 17), (21, 20), (21, 23))],
}


def seated():
    """Cross-legged meditation: folded legs as one shape."""
    L = Layer(W, H)
    L.poly([(9, 25), (23, 25), (25, 29), (7, 29)], "t")
    L.rect(8, 28, 12, 29, "u")
    L.rect(20, 28, 24, 29, "u")
    L.rect(13, 27, 19, 29, "t")
    L.outline("k")
    return L


POSES = {
    # name: (legs, arms, eyes, head dy, robe flutter, body dy)
    "idle0": ("stand", "hang", "open", 0, 0, 0),
    "idle1": ("stand", "hang", "open", 1, 0, 0),
    "sleep": ("stand", "slump", "closed", 2, 0, 0),
    "salute": ("stand", "salute", "happy", 0, 0, 0),
    "strike0": ("horse", "chamber", "fierce", 1, 0, 1),
    "strike1": ("horse", "push", "fierce", 1, 0, 1),
    "horse": ("horse", "hold", "closed", 1, 0, 1),
    "crane": ("crane", "crane", "open", 0, 0, 0),
    "fly0": ("trail", "wings", "happy", 0, 4, 0),
    "fly1": ("trail", "wings", "happy", 0, 6, 0),
    "meditate": ("seated", "knees", "closed", 4, 0, 4),
    "jump0": ("crouch", "chamber", "fierce", 3, 0, 3),
    "jump1": ("air", "up", "happy", -2, 0, -2),
}


def hero(pose):
    leg_kind, arm_kind, eyes, hdy, flutter, bdy = POSES[pose]
    canvas = Layer(W, H)
    back, front = ARMS[arm_kind]
    if leg_kind == "seated":
        lower = seated()
    else:
        lower = legs(leg_kind)
    body = robe(flutter=flutter, wide=1 if leg_kind in ("horse", "crouch") else 0)
    if arm_kind in ("hang", "slump", "chamber", "knees"):
        canvas.over(arm(*back), 0, bdy)
    canvas.over(lower, 0, 0 if leg_kind != "seated" else 0)
    canvas.over(body, 0, bdy)
    if arm_kind not in ("hang", "slump", "chamber", "knees"):
        canvas.over(arm(*back), 0, bdy)
    canvas.over(arm(*front), 0, bdy)
    canvas.over(head(eyes), CX - 8, 0 + hdy + (bdy if bdy > 0 else 0) - (0 if bdy > 0 else 0))
    return canvas
