import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.WatchUi;

// Draws the pixel-art scene: night sky, mountains, the hero and effects.
// Bitmaps load on first use; release() drops them when a view is hidden.
// All positions are in art pixels times `scale` (2..5 by screen size).
class Stage {
  var scale = 3;
  hidden var _frames = {};
  hidden var _art = {};

  // Twinkling stars, as fractions of the screen size.
  const STARS = [
    [18, 22],
    [33, 13],
    [52, 20],
    [80, 12],
    [88, 30],
    [12, 36],
    [44, 29],
    [64, 9],
    [26, 27],
    [72, 24],
  ];

  function initialize() {
    var probe = hero(0, Art.IDLE0);
    scale = probe.getWidth() / Art.HERO;
  }

  function release() as Void {
    _frames = {};
    _art = {};
  }

  // Sect -1 (commoner) wears outfit 0; sects 0..3 wear outfits 1..4.
  function hero(outfit as Number, pose as Number) {
    var key = outfit * 100 + pose;
    var bmp = _frames.get(key);
    if (bmp == null) {
      bmp = Art.hero(outfit, pose);
      _frames.put(key, bmp);
    }
    return bmp;
  }

  function art(id) {
    var bmp = _art.get(id);
    if (bmp == null) {
      bmp = WatchUi.loadResource(id);
      _art.put(id, bmp);
    }
    return bmp;
  }

  // The hero's feet stand on y; the sprite is centred on x.
  function drawHero(
    dc as Graphics.Dc,
    x as Number,
    y as Number,
    outfit as Number,
    pose as Number
  ) as Void {
    var bmp = hero(outfit, pose);
    dc.drawBitmap(x - bmp.getWidth() / 2, y - (Art.HERO - 1) * scale, bmp);
  }

  // Centres a bitmap on (x, y).
  function drawCentered(
    dc as Graphics.Dc,
    x as Number,
    y as Number,
    id
  ) as Void {
    var bmp = art(id);
    dc.drawBitmap(x - bmp.getWidth() / 2, y - bmp.getHeight() / 2, bmp);
  }

  function drawScenery(
    dc as Graphics.Dc,
    ground as Number,
    phase as Number
  ) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    var p = scale;
    dc.setColor(0x000055, 0x000055);
    dc.fillRectangle(0, ground - 30 * p, w, 30 * p);
    for (var i = 0; i < STARS.size(); i++) {
      if ((phase / 3 + i) % 7 == 0) {
        continue;
      }
      var star = STARS[i];
      dc.setColor(i % 3 == 0 ? 0xffffaa : 0xaaaaff, Graphics.COLOR_TRANSPARENT);
      dc.fillRectangle((w * star[0]) / 100, (h * star[1]) / 100, p, p);
    }
    drawCentered(dc, (w * 76) / 100, (h * 29) / 100, Rez.Drawables.moon);
    // A cloud drifts across the sky once a minute or so.
    var cloud = art(Rez.Drawables.cloud_a);
    var span = w + cloud.getWidth();
    var cx = (((phase * p) / 2) % span) - cloud.getWidth();
    dc.drawBitmap(cx, ground - 27 * p, cloud);
    var land = art(Rez.Drawables.land);
    dc.drawBitmap(
      (w - land.getWidth()) / 2,
      ground - Art.LAND_GROUND * p,
      land
    );
  }

  // The hero as the realm and mood show him: qinggong lifts him from
  // realm 5, a cloud carries him at realm 8, qi sparkles from realm 4.
  function drawHeroScene(
    dc as Graphics.Dc,
    ground as Number,
    realm as Number,
    sect as Number,
    mood as Number,
    phase as Number
  ) as Void {
    var w = dc.getWidth();
    var p = scale;
    var cx = w / 2;
    var outfit = sect + 1;
    var lifts = [0, 0, 0, 0, 0, 3, 5, 7, 8];
    var up = lifts[realm] * p;
    if (realm >= 5 && (phase / 2) % 2 == 1) {
      up += p;
    }
    var feet = ground - up;

    var shadow = art(Rez.Drawables.shadow);
    dc.drawBitmap(cx - shadow.getWidth() / 2, ground - p, shadow);
    if (realm >= 4) {
      drawQi(dc, cx, feet - 14 * p, realm, phase);
    }
    if (realm >= 8) {
      var ride = art(
        (phase / 2) % 2 == 0 ? Rez.Drawables.ride_0 : Rez.Drawables.ride_1
      );
      dc.drawBitmap(cx - ride.getWidth() / 2, feet - 4 * p, ride);
    }
    drawHero(dc, cx, feet, outfit, pose(realm, mood, phase));
    if (mood == 0 && realm < 8) {
      var zy = feet - 36 * p - ((phase / 2) % 2) * p;
      dc.drawBitmap(cx + 6 * p, zy, art(Rez.Drawables.zzz));
    }
  }

  // Sparkles orbiting the hero; more of them at higher realms.
  function drawQi(
    dc as Graphics.Dc,
    cx as Number,
    cy as Number,
    realm as Number,
    phase as Number
  ) as Void {
    var p = scale;
    var count = realm >= 6 ? 6 : 4;
    for (var i = 0; i < count; i++) {
      var a = phase * 0.12 + (i * 2 * Math.PI) / count;
      var x = cx + (Math.cos(a) * 17 * p).toNumber();
      var y = cy + (Math.sin(a) * 9 * p).toNumber();
      drawCentered(
        dc,
        x,
        y,
        i % 2 == 0 ? Rez.Drawables.twinkle_a : Rez.Drawables.twinkle_b
      );
    }
  }

  function pose(realm as Number, mood as Number, phase as Number) as Number {
    var alt = (phase / 4) % 2 == 0;
    if (realm >= 8) {
      if (mood == 0) {
        return Art.MEDITATE;
      }
      return alt ? Art.FLY0 : Art.FLY1;
    }
    if (mood == 0) {
      return Art.SLEEP;
    }
    if (realm >= 5) {
      return Art.CRANE;
    }
    if (mood == 2) {
      return alt ? Art.STRIKE0 : Art.STRIKE1;
    }
    return alt ? Art.IDLE0 : Art.IDLE1;
  }
}
