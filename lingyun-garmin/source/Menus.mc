import Toybox.Lang;
import Toybox.WatchUi;

// Breakthrough, the four trainings and the help page. Choosing one replaces
// the menu, so finishing it lands back on the hero with fresh numbers.
function openMainMenu() as Void {
  var g = game();
  var menu = new WatchUi.Menu2({ :title => Ui.s(Rez.Strings.MenuTitle) });
  menu.addItem(
    new WatchUi.MenuItem(
      Ui.s(Rez.Strings.MenuBreak),
      Ui.blockerText(g),
      :breakthrough,
      {}
    )
  );
  for (var i = 0; i < 4; i++) {
    menu.addItem(
      new WatchUi.MenuItem(Ui.trainName(i), Ui.trainSub(g, i), i, {})
    );
  }
  menu.addItem(
    new WatchUi.MenuItem(
      Ui.s(Rez.Strings.MenuHelp),
      Ui.s(Rez.Strings.MenuHelpSub),
      :help,
      {}
    )
  );
  addDebugItem(menu);
  WatchUi.pushView(menu, new MainMenuDelegate(), WatchUi.SLIDE_UP);
}

class MainMenuDelegate extends WatchUi.Menu2InputDelegate {
  function initialize() {
    Menu2InputDelegate.initialize();
  }

  function onSelect(item) as Void {
    var id = item.getId();
    var g = game();
    if (id == :breakthrough) {
      if (g.blocker() == Rules.BLOCK_NONE) {
        startTraining(Rules.TRIAL_TYPE[g.realm + 1], true);
      } else {
        showMessage(Ui.s(Rez.Strings.MenuBreak), Ui.blockerText(g));
      }
    } else if (id == :help) {
      showMessage(Ui.s(Rez.Strings.MenuHelp), Ui.s(Rez.Strings.HelpBody));
    } else if (id instanceof Number) {
      startTraining(id, false);
    } else {
      debugBoost();
      WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
  }
}

function startTraining(type as Number, trial as Boolean) as Void {
  var view = new TrainView(type, trial);
  WatchUi.switchToView(view, new TrainDelegate(view), WatchUi.SLIDE_LEFT);
}

function showMessage(title as String, body as String) as Void {
  WatchUi.switchToView(
    new MessageView(title, body),
    new MessageDelegate(),
    WatchUi.SLIDE_LEFT
  );
}
