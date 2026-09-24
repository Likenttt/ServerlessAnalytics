import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// A title over a few centred lines; select or back returns.
class MessageView extends WatchUi.View {
  hidden var _title;
  hidden var _body;

  function initialize(title as String, body as String) {
    View.initialize();
    _title = title;
    _body = body;
  }

  function onUpdate(dc as Graphics.Dc) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
    dc.drawText(
      w / 2,
      (h * 15) / 100,
      Graphics.FONT_SMALL,
      _title,
      Ui.center()
    );
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 55) / 100, Graphics.FONT_XTINY, _body, Ui.center());
  }
}

class MessageDelegate extends WatchUi.BehaviorDelegate {
  function initialize() {
    BehaviorDelegate.initialize();
  }

  function onSelect() as Boolean {
    WatchUi.popView(WatchUi.SLIDE_RIGHT);
    return true;
  }
}
