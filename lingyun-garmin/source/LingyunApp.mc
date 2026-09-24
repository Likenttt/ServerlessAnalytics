import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class LingyunApp extends Application.AppBase {
  function initialize() {
    AppBase.initialize();
  }

  function onStart(state as Dictionary?) as Void {}

  // Runs in the glance too, so it must not touch foreground-only code.
  // The game saves itself after every change instead.
  function onStop(state as Dictionary?) as Void {}

  function getInitialView() {
    var view = new MainView();
    return [view, new MainDelegate(view)];
  }

  (:glance)
  function getGlanceView() {
    return [new LingyunGlanceView()];
  }
}
