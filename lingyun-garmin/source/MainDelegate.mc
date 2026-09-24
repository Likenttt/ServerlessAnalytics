import Toybox.Lang;
import Toybox.WatchUi;

class MainDelegate extends WatchUi.BehaviorDelegate {
  hidden var _view;

  function initialize(view as MainView) {
    BehaviorDelegate.initialize();
    _view = view;
  }

  function onNextPage() as Boolean {
    _view.turn(1);
    return true;
  }

  function onPreviousPage() as Boolean {
    _view.turn(-1);
    return true;
  }

  function onSelect() as Boolean {
    openMainMenu();
    return true;
  }

  function onMenu() as Boolean {
    openMainMenu();
    return true;
  }
}
