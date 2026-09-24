import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Four pages: the hero, attributes, daily quests and records.
class MainView extends WatchUi.View {
  const PAGES = 4;

  hidden var _page = 0;
  hidden var _phase = 0;
  hidden var _timer;
  hidden var _msg as String? = null;
  hidden var _msgTicks = 0;

  // Texts are refreshed on show so the 4 fps animation loads no resources.
  hidden var _title = "";
  hidden var _xp = "";
  hidden var _status = "";
  hidden var _ready = false;

  function initialize() {
    View.initialize();
    _timer = new Timer.Timer();
  }

  // Every return to the main screen settles the activity done meanwhile.
  function onShow() as Void {
    var g = game();
    var first = g.isNew;
    g.sync();
    g.save();
    if (first) {
      say(Ui.s(Rez.Strings.Intro));
    } else if (g.awayGain > 0) {
      say(Lang.format(Ui.s(Rez.Strings.AwayFmt), [g.awayGain]));
      g.awayGain = 0;
    }
    _title = Ui.title(g);
    _xp =
      g.realm >= Rules.REALM_MAX
        ? Lang.format(Ui.s(Rez.Strings.XpMax), [g.sum()])
        : Lang.format(Ui.s(Rez.Strings.XpFmt), [
            g.sum(),
            Rules.REALM_XP[g.realm + 1],
          ]);
    _status = Ui.blockerText(g);
    _ready = g.blocker() == Rules.BLOCK_NONE;
    _timer.start(method(:onTick), 250, true);
  }

  function onHide() as Void {
    _timer.stop();
  }

  function onTick() as Void {
    _phase += 1;
    if (_msgTicks > 0) {
      _msgTicks -= 1;
      if (_msgTicks == 0) {
        _msg = null;
      }
    }
    if (_page == 0) {
      WatchUi.requestUpdate();
    }
  }

  function turn(step as Number) as Void {
    _page = (_page + step + PAGES) % PAGES;
    WatchUi.requestUpdate();
  }

  // Shows a message in the status line for about 8 seconds.
  function say(text as String) as Void {
    _msg = text;
    _msgTicks = 32;
  }

  function onUpdate(dc as Graphics.Dc) as Void {
    var g = game();
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
    dc.clear();
    if (_page == 0) {
      drawHero(dc, g);
    } else if (_page == 1) {
      drawAttributes(dc, g);
    } else if (_page == 2) {
      drawQuests(dc, g);
    } else {
      drawRecords(dc, g);
    }
    drawPageDots(dc);
  }

  hidden function drawHero(dc as Graphics.Dc, g as GameState) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    var ground = (h * 66) / 100;
    drawScenery(dc, w, h, ground);
    Figure.draw(dc, w / 2, ground, h / 30.0, g.realm, g.sect, g.mood(), _phase);

    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 15) / 100,
      Graphics.FONT_SMALL,
      _title,
      Ui.center()
    );

    var barW = (w * 56) / 100;
    var barH = h / 60 > 3 ? h / 60 : 3;
    Ui.bar(
      dc,
      (w - barW) / 2,
      (h * 74) / 100,
      barW,
      barH,
      g.progressPct(),
      Graphics.COLOR_YELLOW
    );
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 79) / 100, Graphics.FONT_XTINY, _xp, Ui.center());

    var color = _ready ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY;
    var status = _status;
    var msg = _msg;
    if (msg != null) {
      color = Graphics.COLOR_LT_GRAY;
      status = msg;
    }
    dc.setColor(color, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 87) / 100,
      Graphics.FONT_XTINY,
      status,
      Ui.center()
    );
  }

  // Night mountains under a moon, or the sun by day.
  hidden function drawScenery(
    dc as Graphics.Dc,
    w as Number,
    h as Number,
    ground as Number
  ) as Void {
    var hour = System.getClockTime().hour;
    var night = hour < 6 || hour >= 18;
    var mx = (w * 74) / 100;
    var my = (h * 30) / 100;
    var mr = h / 22;
    dc.setColor(night ? 0xffff55 : 0xff5500, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(mx, my, mr);
    if (night) {
      dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
      dc.fillCircle(mx + mr / 2, my - mr / 3, mr);
    }
    dc.setColor(0x000055, Graphics.COLOR_TRANSPARENT);
    dc.fillPolygon([
      [0, ground],
      [(w * 20) / 100, ground - (h * 17) / 100],
      [(w * 42) / 100, ground],
    ]);
    dc.fillPolygon([
      [(w * 28) / 100, ground],
      [(w * 62) / 100, ground - (h * 25) / 100],
      [w, ground],
    ]);
    dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(0, ground, w, ground);
  }

  hidden function drawAttributes(dc as Graphics.Dc, g as GameState) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    drawTitle(dc, Ui.s(Rez.Strings.PageAttr));
    var top = 1;
    for (var i = 0; i < 4; i++) {
      if (g.attr[i] > top) {
        top = g.attr[i];
      }
    }
    var need = 0;
    if (g.realm < Rules.REALM_MAX) {
      need = (Rules.REALM_XP[g.realm + 1] * Rules.MIN_ATTR_PCT) / 100;
    }
    var colors = [
      Graphics.COLOR_ORANGE,
      Graphics.COLOR_BLUE,
      Graphics.COLOR_YELLOW,
      Graphics.COLOR_PURPLE,
    ];
    var x = (w * 18) / 100;
    var bw = (w * 64) / 100;
    var bh = h / 50 > 3 ? h / 50 : 3;
    var left = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
    var right = Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER;
    for (var i = 0; i < 4; i++) {
      var y = (h * (27 + 14 * i)) / 100;
      var name = Ui.attrName(i);
      dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
      dc.drawText(x, y, Graphics.FONT_XTINY, name, left);
      dc.drawText(x + bw, y, Graphics.FONT_XTINY, g.attr[i].toString(), right);
      if (g.gain[i] > 0) {
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
          x + dc.getTextWidthInPixels(name, Graphics.FONT_XTINY) + w / 40,
          y,
          Graphics.FONT_XTINY,
          "+" + g.gain[i],
          left
        );
      }
      var color = g.attr[i] < need ? Graphics.COLOR_RED : colors[i];
      Ui.bar(dc, x, y + (h * 5) / 100, bw, bh, (g.attr[i] * 100) / top, color);
    }
    var hints = [
      Rez.Strings.Hint0,
      Rez.Strings.Hint1,
      Rez.Strings.Hint2,
      Rez.Strings.Hint3,
    ];
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 86) / 100,
      Graphics.FONT_XTINY,
      Ui.s(hints[g.weakest()]),
      Ui.center()
    );
  }

  hidden function drawQuests(dc as Graphics.Dc, g as GameState) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    drawTitle(dc, Ui.s(Rez.Strings.PageQuest));
    var moods = [Rez.Strings.Mood0, Rez.Strings.Mood1, Rez.Strings.Mood2];
    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      w / 2,
      (h * 23) / 100,
      Graphics.FONT_XTINY,
      Ui.s(moods[g.mood()]),
      Ui.center()
    );

    var names = [
      Rez.Strings.Quest0,
      g.hasFloors ? Rez.Strings.Quest1 : Rez.Strings.Quest1Alt,
      Rez.Strings.Quest2,
    ];
    var x = (w * 18) / 100;
    var bw = (w * 64) / 100;
    var bh = h / 50 > 3 ? h / 50 : 3;
    var left = Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER;
    var right = Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER;
    for (var q = 0; q < 3; q++) {
      var y = (h * (34 + 15 * q)) / 100;
      var value = g.questValue(q);
      var target = Rules.questTarget(q, g.realm, g.hasFloors);
      var done = (g.quest & (1 << q)) != 0;
      dc.setColor(
        done ? Graphics.COLOR_GREEN : Graphics.COLOR_WHITE,
        Graphics.COLOR_TRANSPARENT
      );
      dc.drawText(x, y, Graphics.FONT_XTINY, Ui.s(names[q]), left);
      dc.drawText(
        x + bw,
        y,
        Graphics.FONT_XTINY,
        value.toString() + "/" + target,
        right
      );
      Ui.bar(
        dc,
        x,
        y + (h * 5) / 100,
        bw,
        bh,
        (value * 100) / target,
        done ? Graphics.COLOR_GREEN : Graphics.COLOR_BLUE
      );
    }
    var allDone = (g.quest & 8) != 0;
    dc.setColor(
      allDone ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY,
      Graphics.COLOR_TRANSPARENT
    );
    var footer = allDone
      ? Lang.format(Ui.s(Rez.Strings.QuestAll), [g.currentStreak()])
      : Ui.s(Rez.Strings.QuestHint);
    dc.drawText(
      w / 2,
      (h * 84) / 100,
      Graphics.FONT_XTINY,
      footer,
      Ui.center()
    );
  }

  hidden function drawRecords(dc as Graphics.Dc, g as GameState) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    drawTitle(dc, Ui.s(Rez.Strings.PageRecord));
    var qinggong = [
      Rez.Strings.Qg0,
      Rez.Strings.Qg1,
      Rez.Strings.Qg2,
      Rez.Strings.Qg3,
      Rez.Strings.Qg4,
      Rez.Strings.Qg5,
      Rez.Strings.Qg6,
      Rez.Strings.Qg7,
      Rez.Strings.Qg8,
    ];
    var lines = [
      Lang.format(Ui.s(Rez.Strings.RecQg), [Ui.s(qinggong[g.realm])]),
      Lang.format(Ui.s(Rez.Strings.RecDays), [g.daysPlayed()]),
      Lang.format(Ui.s(Rez.Strings.RecStreak), [g.currentStreak()]),
      Lang.format(Ui.s(Rez.Strings.RecSteps), [g.best[0]]),
      g.hasFloors
        ? Lang.format(Ui.s(Rez.Strings.RecFloors), [g.best[1]])
        : Lang.format(Ui.s(Rez.Strings.RecIm), [g.best[2]]),
      Lang.format(Ui.s(Rez.Strings.RecTotal), [g.total[0]]),
    ];
    for (var i = 0; i < lines.size(); i++) {
      dc.setColor(
        i == 0 ? Graphics.COLOR_YELLOW : Graphics.COLOR_WHITE,
        Graphics.COLOR_TRANSPARENT
      );
      dc.drawText(
        w / 2,
        (h * (29 + 10 * i)) / 100,
        Graphics.FONT_XTINY,
        lines[i],
        Ui.center()
      );
    }
  }

  hidden function drawTitle(dc as Graphics.Dc, text as String) as Void {
    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    dc.drawText(
      dc.getWidth() / 2,
      (dc.getHeight() * 13) / 100,
      Graphics.FONT_SMALL,
      text,
      Ui.center()
    );
  }

  hidden function drawPageDots(dc as Graphics.Dc) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    var r = h / 90 > 2 ? h / 90 : 2;
    var x = w - (w * 5) / 100;
    for (var i = 0; i < PAGES; i++) {
      var y = h / 2 + ((2 * i - PAGES + 1) * h) / 50;
      dc.setColor(
        i == _page ? Graphics.COLOR_WHITE : Graphics.COLOR_DK_GRAY,
        Graphics.COLOR_TRANSPARENT
      );
      dc.fillCircle(x, y, r);
    }
  }
}
