import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class MainView extends WatchUi.View {
  function initialize() {
    View.initialize();
  }

  function onUpdate(dc as Graphics.Dc) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
    dc.drawText(
      w / 2,
      h / 2,
      Graphics.FONT_MEDIUM,
      WatchUi.loadResource(Rez.Strings.AppName),
      Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
    );
  }
}
