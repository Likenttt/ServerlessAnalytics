import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class MainView extends WatchUi.View {
  hidden var _msg as String? = null;

  function initialize() {
    View.initialize();
  }

  // Every return to the main screen settles the activity done meanwhile.
  function onShow() as Void {
    var g = game();
    var first = g.isNew;
    g.sync();
    g.save();
    if (first) {
      _msg = Ui.s(Rez.Strings.Intro);
    } else if (g.awayGain > 0) {
      _msg = Lang.format(Ui.s(Rez.Strings.AwayFmt), [g.awayGain]);
      g.awayGain = 0;
    }
  }

  function onUpdate(dc as Graphics.Dc) as Void {
    var g = game();
    var w = dc.getWidth();
    var h = dc.getHeight();
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
    dc.drawText(w / 2, h / 3, Graphics.FONT_MEDIUM, Ui.title(g), Ui.center());
    dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, xpText(g), Ui.center());
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 2) / 3,
      Graphics.FONT_XTINY,
      _msg != null ? _msg : Ui.blockerText(g),
      Ui.center()
    );
  }

  hidden function xpText(g as GameState) as String {
    if (g.realm >= Rules.REALM_MAX) {
      return Lang.format(Ui.s(Rez.Strings.XpMax), [g.sum()]);
    }
    return Lang.format(Ui.s(Rez.Strings.XpFmt), [
      g.sum(),
      Rules.REALM_XP[g.realm + 1]
    ]);
  }
}
