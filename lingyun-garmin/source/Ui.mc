import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Text lookups and small drawing helpers shared by the views.
module Ui {
  function s(id) as String {
    return WatchUi.loadResource(id) as String;
  }

  function realmName(r as Number) as String {
    var ids = [
      Rez.Strings.Realm0,
      Rez.Strings.Realm1,
      Rez.Strings.Realm2,
      Rez.Strings.Realm3,
      Rez.Strings.Realm4,
      Rez.Strings.Realm5,
      Rez.Strings.Realm6,
      Rez.Strings.Realm7,
      Rez.Strings.Realm8,
    ];
    return s(ids[r]);
  }

  function sectName(i as Number) as String {
    var ids = [
      Rez.Strings.Sect0,
      Rez.Strings.Sect1,
      Rez.Strings.Sect2,
      Rez.Strings.Sect3,
    ];
    return i < 0 ? s(Rez.Strings.SectNone) : s(ids[i]);
  }

  function attrName(i as Number) as String {
    var ids = [
      Rez.Strings.Attr0,
      Rez.Strings.Attr1,
      Rez.Strings.Attr2,
      Rez.Strings.Attr3,
    ];
    return s(ids[i]);
  }

  // "少林 · 三流好手"; commoners have no sect yet.
  function title(g as GameState) as String {
    if (g.sect < 0) {
      return realmName(g.realm);
    }
    return sectName(g.sect) + " · " + realmName(g.realm);
  }

  // What stands between the player and the next realm.
  function blockerText(g as GameState) as String {
    var b = g.blocker();
    if (b == Rules.BLOCK_NONE) {
      return s(Rez.Strings.CanBreak);
    }
    if (b == Rules.BLOCK_MAX) {
      return s(Rez.Strings.AtPeak);
    }
    var need = Rules.REALM_XP[g.realm + 1];
    if (b == Rules.BLOCK_XP) {
      return Lang.format(s(Rez.Strings.NeedXp), [need - g.sum()]);
    }
    if (b == Rules.BLOCK_ATTR) {
      return Lang.format(s(Rez.Strings.NeedAttr), [
        attrName(g.weakest()),
        (need * Rules.MIN_ATTR_PCT) / 100,
      ]);
    }
    if (b == Rules.BLOCK_STEPS) {
      return Lang.format(s(Rez.Strings.NeedSteps), [Rules.PREREQ_STEPS]);
    }
    if (b == Rules.BLOCK_FLOORS) {
      return g.hasFloors
        ? Lang.format(s(Rez.Strings.NeedFloors), [Rules.PREREQ_FLOORS])
        : Lang.format(s(Rez.Strings.NeedIm), [Rules.PREREQ_IM]);
    }
    return Lang.format(s(Rez.Strings.NeedStreak), [
      Rules.PREREQ_STREAK,
      g.currentStreak(),
    ]);
  }

  function center() as Number {
    return Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
  }

  // Horizontal progress bar; pct 0..100.
  function bar(dc as Graphics.Dc, x, y, w, h, pct, color as Number) as Void {
    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.fillRectangle(x, y, w, h);
    if (pct > 0) {
      dc.setColor(color, Graphics.COLOR_TRANSPARENT);
      dc.fillRectangle(x, y, (w * (pct > 100 ? 100 : pct)) / 100, h);
    }
  }
}
