import Toybox.Lang;
import Toybox.WatchUi;

class MainDelegate extends WatchUi.BehaviorDelegate {
  hidden var _view;

  function initialize(view as MainView) {
    BehaviorDelegate.initialize();
    _view = view;
  }
}
