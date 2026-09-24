import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Realm title and progress to the next realm. The foreground app writes a
// ready-to-draw summary to storage ("glance" = [title, percent, detail]) so
// the glance needs no game code.
(:glance)
class LingyunGlanceView extends WatchUi.GlanceView {
  function initialize() {
    GlanceView.initialize();
  }

  function onUpdate(dc as Graphics.Dc) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
    dc.clear();

    var title = WatchUi.loadResource(Rez.Strings.AppName) as String;
    var pct = 0;
    var detail = WatchUi.loadResource(Rez.Strings.GlanceStart) as String;
    var data = Application.Storage.getValue("glance");
    if (data instanceof Array && data.size() >= 3) {
      title = data[0];
      pct = data[1];
      detail = data[2];
    }

    var left = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(0, h / 4, Graphics.FONT_TINY, title, left);

    var barW = (w * 9) / 10;
    var barH = h / 12 > 3 ? h / 12 : 3;
    var barY = h / 2 - barH / 2;
    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.fillRectangle(0, barY, barW, barH);
    dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
    dc.fillRectangle(0, barY, (barW * pct) / 100, barH);

    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(0, (h * 3) / 4, Graphics.FONT_XTINY, detail, left);
  }
}
