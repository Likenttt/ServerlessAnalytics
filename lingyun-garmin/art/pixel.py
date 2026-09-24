"""Tiny pixel-art toolkit: layers of palette keys, shapes, outlines, PNG out.

Colours are keys into PALETTE. All colours are on Garmin's 64-colour grid
(channels 00/55/AA/FF) so memory-in-pixel watches show them exactly.
"""
from PIL import Image

PALETTE = {
    "k": (0x00, 0x00, 0x00),  # outline
    "s": (0xFF, 0xAA, 0x55),  # skin
    "d": (0xAA, 0x55, 0x55),  # skin shade
    "b": (0xFF, 0x55, 0x55),  # blush
    "h": (0x00, 0x00, 0x00),  # hair
    "g": (0x55, 0x55, 0x55),  # hair shine
    "w": (0xFF, 0xFF, 0xFF),  # white
    "t": (0xAA, 0xAA, 0xAA),  # trousers
    "u": (0x55, 0x55, 0x55),  # trousers shade
    "f": (0x55, 0x00, 0x00),  # shoes
    # Outfit template colours, recoloured per sect by export.py.
    "R": (0xFF, 0x00, 0xFF),  # robe
    "r": (0x80, 0x00, 0x80),  # robe shade
    "L": (0xFF, 0x80, 0xFF),  # robe light
    "W": (0x00, 0xFF, 0xFF),  # sash
    "V": (0x00, 0x80, 0x80),  # sash shade
    # Scenery and effects.
    "n": (0x00, 0x00, 0x55),  # night blue
    "N": (0x00, 0x00, 0xAA),  # blue
    "c": (0x55, 0xAA, 0xFF),  # sky / qi
    "C": (0xAA, 0xFF, 0xFF),  # pale cyan
    "y": (0xFF, 0xFF, 0xAA),  # moon
    "Y": (0xFF, 0xFF, 0x55),  # yellow
    "o": (0xFF, 0xAA, 0x00),  # gold
    "a": (0xAA, 0xAA, 0x55),  # moon shade
    "m": (0x00, 0x55, 0x55),  # far mountain
    "M": (0x00, 0x55, 0xAA),  # mountain light
    "p": (0x00, 0x55, 0x00),  # pine
    "P": (0x00, 0xAA, 0x55),  # pine light
    "e": (0x55, 0x55, 0xAA),  # mist
    "x": (0x55, 0x00, 0x55),  # dark violet
    "X": (0xAA, 0x00, 0x00),  # dark red
    "q": (0xAA, 0xAA, 0xFF),  # lavender
}


class Layer:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def line(self, x0, y0, x1, y1, c, width=1):
        """Bresenham line; width 2/3 thickens it to the right/down."""
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            for ox in range(width):
                for oy in range(width):
                    self.set(x0 + ox - width // 2, y0 + oy - width // 2, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def poly(self, pts, c):
        """Even-odd scanline fill, sampling pixel centres."""
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            cy = y + 0.5
            xs = []
            for i in range(len(pts)):
                (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % len(pts)]
                if (ya <= cy < yb) or (yb <= cy < ya):
                    xs.append(xa + (cy - ya) * (xb - xa) / (yb - ya))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(round(xs[i])), int(round(xs[i + 1]))):
                    self.set(x, y, c)

    def disc(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                    self.set(x, y, c)

    def stamp(self, art, x0, y0, keymap=None):
        """Paste ASCII art; '.' is transparent."""
        for dy, row in enumerate(art.strip("\n").split("\n")):
            for dx, ch in enumerate(row):
                if ch != "." and ch != " ":
                    self.set(x0 + dx, y0 + dy, keymap.get(ch, ch) if keymap else ch)

    def outline(self, c="k", diagonal=False):
        """Adds a 1 px outline around the opaque pixels."""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] is not None:
                    continue
                n = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                if diagonal:
                    n += [(1, 1), (-1, 1), (1, -1), (-1, -1)]
                if any(self.get(x + a, y + b) not in (None, c) for a, b in n):
                    add.append((x, y))
        for x, y in add:
            self.px[y][x] = c
        return self

    def over(self, other, ox=0, oy=0):
        """Composites other on top of self."""
        for y in range(other.h):
            for x in range(other.w):
                c = other.px[y][x]
                if c is not None:
                    self.set(x + ox, y + oy, c)
        return self

    def map(self, fn):
        for y in range(self.h):
            for x in range(self.w):
                c = self.px[y][x]
                if c is not None:
                    self.px[y][x] = fn(x, y, c)
        return self

    def flip(self):
        out = Layer(self.w, self.h)
        for y in range(self.h):
            out.px[y] = list(reversed(self.px[y]))
        return out

    def image(self, palette=PALETTE):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y in range(self.h):
            for x in range(self.w):
                c = self.px[y][x]
                if c is not None:
                    im.putpixel((x, y), palette[c] + (255,))
        return im
