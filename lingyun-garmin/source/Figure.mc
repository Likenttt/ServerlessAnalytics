import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;

// The hero, drawn from primitives so it scales to every screen. All sizes
// are in figure units u: the hero is about 10u tall with feet at the base.
module Figure {
  const SKIN = 0xffaa55;
  const HAIR = 0x555555;
  const TROUSERS = 0xaaaaaa;
  const SASH = 0xaa0000;

  const LEGS_STAND = 0;
  const LEGS_HORSE = 1; // 马步
  const LEGS_CRANE = 2; // 金鸡独立

  const ARMS_HANG = 0;
  const ARMS_SALUTE = 1; // 抱拳
  const ARMS_STRIKE = 2; // 推掌
  const ARMS_WINGS = 3; // 御风

  // Commoner hemp, then the sects: Shaolin saffron, Xiaoyao sky,
  // Wudang white, Emei violet.
  function robeColor(sect as Number) as Number {
    if (sect == 0) {
      return 0xffaa00;
    }
    if (sect == 1) {
      return 0x55aaff;
    }
    if (sect == 2) {
      return 0xffffff;
    }
    if (sect == 3) {
      return 0xaa55ff;
    }
    return 0xaa5500;
  }

  // Hover height in units: qinggong from realm 5, flight at realm 8.
  function lift(realm as Number) as Float {
    if (realm < 5) {
      return 0.0;
    }
    var lifts = [0.8, 1.5, 2.3, 3.0];
    return lifts[realm - 5];
  }

  // mood: 0 listless, 1 calm, 2 in high spirits. phase: animation frame.
  function draw(
    dc as Graphics.Dc,
    cx as Number,
    ground as Number,
    u as Float,
    realm as Number,
    sect as Number,
    mood as Number,
    phase as Number
  ) as Void {
    if (dc has :setAntiAlias) {
      dc.setAntiAlias(true);
    }
    var robe = robeColor(sect);
    var t = phase * 0.3;
    var up = lift(realm) * u;
    if (realm >= 5) {
      up += Math.sin(t) * 0.3 * u;
    }
    var base = ground - up;

    // The shadow shrinks as the hero rises.
    var sw = 2.6 * u - up * 0.3;
    if (sw < u) {
      sw = u;
    }
    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.fillEllipse(cx, ground, n(sw), n(0.4 * u));

    if (realm >= 4) {
      aura(dc, cx, base - 5.0 * u, u, robe, realm, phase);
    }
    if (realm >= 8) {
      cloud(dc, cx, base, u, phase);
    } else if (realm >= 5) {
      steps(dc, cx, base, u);
    }

    var legs = LEGS_STAND;
    var arms = ARMS_HANG;
    if (realm >= 8) {
      legs = LEGS_CRANE;
      arms = mood == 0 ? ARMS_SALUTE : ARMS_WINGS;
    } else if (realm >= 5) {
      legs = LEGS_CRANE;
      arms = mood == 0 ? ARMS_HANG : mood == 1 ? ARMS_SALUTE : ARMS_STRIKE;
    } else {
      legs = mood == 2 ? LEGS_HORSE : LEGS_STAND;
      if (mood == 2) {
        arms = ARMS_STRIKE;
      } else if (mood == 1 && realm > 0) {
        arms = ARMS_SALUTE;
      }
    }

    drawLegs(dc, cx, base, u, legs);
    drawBody(dc, cx, base, u, robe, sect, realm, t);
    drawArms(dc, cx, base, u, robe, arms, t);
    drawHead(dc, cx, base, u, realm, mood == 0 && realm < 8, t);
  }

  // Swirling qi: two arcs orbit the hero, a third counter-rotates from realm 6.
  function aura(
    dc as Graphics.Dc,
    cx as Number,
    cy as Float,
    u as Float,
    color as Number,
    realm as Number,
    phase as Number
  ) as Void {
    dc.setColor(color, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.18 * u));
    var a = (phase * 12) % 360;
    var r = n(5.6 * u);
    arc(dc, cx, cy, r, a, 100);
    arc(dc, cx, cy, r, a + 180, 100);
    if (realm >= 6) {
      var b = 360 - a;
      var r2 = n(6.5 * u);
      arc(dc, cx, cy, r2, b + 90, 60);
      arc(dc, cx, cy, r2, b + 270, 60);
    }
    dc.setPenWidth(1);
  }

  // Treading on air: fading dashes under the feet.
  function steps(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float
  ) as Void {
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.15 * u));
    for (var i = 0; i < 3; i++) {
      var y = n(base + (0.5 + 0.5 * i) * u);
      var half = (1.6 - 0.45 * i) * u;
      dc.drawLine(n(cx - half), y, n(cx + half), y);
    }
    dc.setPenWidth(1);
  }

  // A cloud to ride, with wind streaks drifting behind.
  function cloud(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float,
    phase as Number
  ) as Void {
    dc.setColor(0x55aaff, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.15 * u));
    var drift = ((phase % 12) / 12.0) * 2.0 * u;
    for (var i = 0; i < 3; i++) {
      var y = n(base - (4.8 - 1.9 * i) * u);
      var x0 = cx - (3.0 + 0.4 * i) * u - drift;
      dc.drawLine(n(x0), y, n(x0 - (2.2 - 0.4 * i) * u), y);
    }
    dc.setPenWidth(1);
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    puff(dc, cx - 1.9 * u, base + 0.6 * u, 0.95 * u);
    puff(dc, cx + 1.9 * u, base + 0.6 * u, 0.95 * u);
    puff(dc, cx, base + 0.3 * u, 1.35 * u);
    puff(dc, cx - 0.95 * u, base + 1.1 * u, 0.9 * u);
    puff(dc, cx + 0.95 * u, base + 1.1 * u, 0.9 * u);
  }

  function drawLegs(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float,
    legs as Number
  ) as Void {
    dc.setColor(TROUSERS, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.55 * u));
    var hip = base - 3.4 * u;
    if (legs == LEGS_HORSE) {
      limb(
        dc,
        cx - 0.6 * u,
        hip,
        cx - 2.0 * u,
        base - 1.9 * u,
        cx - 2.2 * u,
        base,
        0.27 * u
      );
      limb(
        dc,
        cx + 0.6 * u,
        hip,
        cx + 2.0 * u,
        base - 1.9 * u,
        cx + 2.2 * u,
        base,
        0.27 * u
      );
    } else if (legs == LEGS_CRANE) {
      line(dc, cx - 0.5 * u, hip, cx - 0.5 * u, base);
      limb(
        dc,
        cx + 0.5 * u,
        hip,
        cx + 1.6 * u,
        base - 2.3 * u,
        cx + 0.8 * u,
        base - 1.1 * u,
        0.27 * u
      );
    } else {
      line(dc, cx - 0.6 * u, hip, cx - 0.9 * u, base);
      line(dc, cx + 0.6 * u, hip, cx + 0.9 * u, base);
    }
    dc.setPenWidth(1);
  }

  // Robe, sash, and from realm 3 streamers that flutter behind.
  function drawBody(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float,
    robe as Number,
    sect as Number,
    realm as Number,
    t as Float
  ) as Void {
    var wave = Math.sin(t * 1.7) * 0.4 * u;
    dc.setColor(robe, Graphics.COLOR_TRANSPARENT);
    if (realm >= 6) {
      dc.fillPolygon([
        [n(cx - 1.9 * u), n(base - 3.0 * u)],
        [n(cx - 1.3 * u), n(base - 4.8 * u)],
        [n(cx - 3.8 * u), n(base - 2.4 * u + wave)],
      ]);
    }
    dc.fillPolygon([
      [n(cx - 1.2 * u), n(base - 7.0 * u)],
      [n(cx + 1.2 * u), n(base - 7.0 * u)],
      [n(cx + 1.9 * u), n(base - 3.0 * u)],
      [n(cx - 1.9 * u), n(base - 3.0 * u)],
    ]);
    // Crossed collar.
    dc.setColor(HAIR, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.15 * u));
    line(dc, cx - 0.7 * u, base - 7.0 * u, cx + 0.3 * u, base - 5.4 * u);
    line(dc, cx + 0.7 * u, base - 7.0 * u, cx - 0.1 * u, base - 5.9 * u);

    var sash = sect < 0 ? HAIR : SASH;
    dc.setColor(sash, Graphics.COLOR_TRANSPARENT);
    dc.fillRectangle(
      n(cx - 1.5 * u),
      n(base - 5.1 * u),
      n(3.0 * u),
      pen(0.5 * u)
    );
    if (realm >= 3) {
      dc.setPenWidth(pen(0.25 * u));
      line(
        dc,
        cx - 1.4 * u,
        base - 4.9 * u,
        cx - 2.9 * u,
        base - 4.0 * u + wave
      );
      line(
        dc,
        cx - 1.4 * u,
        base - 4.8 * u,
        cx - 2.5 * u,
        base - 3.4 * u + wave * 0.6
      );
    }
    dc.setPenWidth(1);
  }

  function drawArms(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float,
    robe as Number,
    arms as Number,
    t as Float
  ) as Void {
    var sy = base - 6.7 * u;
    var lx = cx - 1.05 * u;
    var rx = cx + 1.05 * u;
    dc.setColor(robe, Graphics.COLOR_TRANSPARENT);
    dc.setPenWidth(pen(0.55 * u));
    if (arms == ARMS_SALUTE) {
      limb(
        dc,
        lx,
        sy,
        cx - 1.8 * u,
        base - 5.6 * u,
        cx - 0.1 * u,
        base - 6.1 * u,
        0.27 * u
      );
      limb(
        dc,
        rx,
        sy,
        cx + 1.8 * u,
        base - 5.6 * u,
        cx + 0.1 * u,
        base - 6.1 * u,
        0.27 * u
      );
      hand(dc, cx, base - 6.1 * u, 0.42 * u);
    } else if (arms == ARMS_STRIKE) {
      line(dc, rx, sy, cx + 3.7 * u, base - 6.6 * u);
      limb(
        dc,
        lx,
        sy,
        cx - 2.0 * u,
        base - 5.2 * u,
        cx - 1.2 * u,
        base - 4.8 * u,
        0.27 * u
      );
      hand(dc, cx + 3.7 * u, base - 6.6 * u, 0.38 * u);
      hand(dc, cx - 1.2 * u, base - 4.8 * u, 0.33 * u);
    } else if (arms == ARMS_WINGS) {
      var w = Math.sin(t) * 0.3 * u;
      line(dc, lx, sy, cx - 3.4 * u, base - 7.8 * u + w);
      line(dc, rx, sy, cx + 3.4 * u, base - 7.8 * u - w);
      hand(dc, cx - 3.4 * u, base - 7.8 * u + w, 0.36 * u);
      hand(dc, cx + 3.4 * u, base - 7.8 * u - w, 0.36 * u);
    } else {
      line(dc, lx, sy, cx - 1.7 * u, base - 4.0 * u);
      line(dc, rx, sy, cx + 1.7 * u, base - 4.0 * u);
      hand(dc, cx - 1.7 * u, base - 4.0 * u, 0.33 * u);
      hand(dc, cx + 1.7 * u, base - 4.0 * u, 0.33 * u);
    }
    dc.setPenWidth(1);
  }

  // A drooping head when listless; a hair ribbon streams from realm 5.
  function drawHead(
    dc as Graphics.Dc,
    cx as Number,
    base as Float,
    u as Float,
    realm as Number,
    droop as Boolean,
    t as Float
  ) as Void {
    var hx = droop ? cx + 0.25 * u : cx * 1.0;
    var hy = droop ? base - 7.6 * u : base - 7.95 * u;
    if (realm >= 5) {
      dc.setColor(SASH, Graphics.COLOR_TRANSPARENT);
      dc.setPenWidth(pen(0.25 * u));
      var wave = Math.sin(t * 1.3) * 0.35 * u;
      line(dc, hx - 0.3 * u, hy - 1.35 * u, hx - 2.0 * u, hy - 0.8 * u + wave);
      dc.setPenWidth(1);
    }
    dc.setColor(HAIR, Graphics.COLOR_TRANSPARENT);
    puff(dc, hx, hy - 0.3 * u, 1.05 * u);
    puff(dc, hx, hy - 1.5 * u, 0.45 * u);
    dc.setColor(SKIN, Graphics.COLOR_TRANSPARENT);
    puff(dc, hx, hy, 0.92 * u);
    if (droop) {
      dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
      dc.drawText(
        n(hx + 1.6 * u),
        n(hy - 2.2 * u),
        Graphics.FONT_XTINY,
        "z z",
        Graphics.TEXT_JUSTIFY_LEFT
      );
    }
  }

  // Counter-clockwise arc of span degrees starting at from (any angle).
  function arc(
    dc as Graphics.Dc,
    cx as Number,
    cy as Float,
    r as Number,
    first as Number,
    span as Number
  ) as Void {
    var a = first % 360;
    dc.drawArc(
      cx,
      n(cy),
      r,
      Graphics.ARC_COUNTER_CLOCKWISE,
      a,
      (a + span) % 360
    );
  }

  function line(dc as Graphics.Dc, x1, y1, x2, y2) as Void {
    dc.drawLine(n(x1), n(y1), n(x2), n(y2));
  }

  // Two segments joined at a rounded knee or elbow.
  function limb(dc as Graphics.Dc, x1, y1, x2, y2, x3, y3, r) as Void {
    line(dc, x1, y1, x2, y2);
    line(dc, x2, y2, x3, y3);
    dc.fillCircle(n(x2), n(y2), pen(r));
  }

  function hand(dc as Graphics.Dc, x, y, r) as Void {
    dc.setColor(SKIN, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(n(x), n(y), n(r));
  }

  function puff(dc as Graphics.Dc, x, y, r) as Void {
    dc.fillCircle(n(x), n(y), n(r));
  }

  function n(v) as Number {
    return v.toNumber();
  }

  // Pen widths never drop below one pixel.
  function pen(v) as Number {
    var p = v.toNumber();
    return p < 1 ? 1 : p;
  }
}
