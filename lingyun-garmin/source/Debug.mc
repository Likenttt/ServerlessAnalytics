import Toybox.Lang;
import Toybox.WatchUi;

// Simulator helpers, compiled into debug builds only. The release variants
// keep the call sites valid.
(:debug)
function addDebugItem(menu as WatchUi.Menu2) as Void {
  menu.addItem(new WatchUi.MenuItem("DEBUG", "+500 each, records", :debug, {}));
}

(:release)
function addDebugItem(menu as WatchUi.Menu2) as Void {}

// Enough cultivation and records to try the next breakthrough quickly.
(:debug)
function debugBoost() as Void {
  var g = game();
  for (var i = 0; i < 4; i++) {
    g.add(i, 500);
  }
  g.best = [20000, 30, 90];
  g.streak = 7;
  g.fullDay = g.day;
  g.save();
}

(:release)
function debugBoost() as Void {}
