"""Contact sheet of every hero pose in every outfit, for eyeballing."""
import sys
from PIL import Image
from pixel import PALETTE
import hero
from outfits import OUTFITS, recolour

scale = int(sys.argv[1]) if len(sys.argv) > 1 else 6
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/hero_sheet.png"
poses = list(hero.POSES)
cell = 32 * scale + 8
sheet = Image.new("RGB", (cell * len(poses), cell * len(OUTFITS)), (0, 0, 0x55))
for j, outfit in enumerate(OUTFITS):
    for i, pose in enumerate(poses):
        im = hero.hero(pose).image(recolour(PALETTE, outfit))
        im = im.resize((32 * scale, 32 * scale), Image.NEAREST)
        sheet.paste(im, (i * cell + 4, j * cell + 4), im)
sheet.save(out)
print(out, sheet.size)
