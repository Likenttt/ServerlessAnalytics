import Toybox.Lang;
import Toybox.Math;

// Counts sharp wrist movements (punches, jump landings) in accelerometer
// samples (milli-g). An impact is the magnitude rising above `high`; the
// counter re-arms once it falls below `low` and `gap` samples have passed.
class ImpactCounter {
  var count = 0;
  hidden var _high;
  hidden var _low;
  hidden var _gap;
  hidden var _armed = true;
  hidden var _since = 0;

  function initialize(high as Number, low as Number, gap as Number) {
    _high = high;
    _low = low;
    _gap = gap;
    _since = gap;
  }

  function feed(
    x as Array<Number>,
    y as Array<Number>,
    z as Array<Number>
  ) as Void {
    for (var i = 0; i < x.size(); i++) {
      var m = magnitude(x[i], y[i], z[i]);
      _since += 1;
      if (_armed) {
        if (m > _high && _since >= _gap) {
          count += 1;
          _armed = false;
          _since = 0;
        }
      } else if (m < _low) {
        _armed = true;
      }
    }
  }
}

// Steady seconds for the standing stance. The listener delivers one batch
// per second; a batch is steady when the magnitude spread stays under
// `limit` milli-g.
class Stillness {
  var steady = 0;
  var shaky = false;
  hidden var _limit;

  function initialize(limit as Number) {
    _limit = limit;
  }

  function feed(
    x as Array<Number>,
    y as Array<Number>,
    z as Array<Number>
  ) as Void {
    if (x.size() == 0) {
      return;
    }
    var lo = 100000.0;
    var hi = 0.0;
    for (var i = 0; i < x.size(); i++) {
      var m = magnitude(x[i], y[i], z[i]);
      if (m < lo) {
        lo = m;
      }
      if (m > hi) {
        hi = m;
      }
    }
    shaky = hi - lo > _limit;
    if (!shaky) {
      steady += 1;
    }
  }
}

function magnitude(x as Number, y as Number, z as Number) as Float {
  return Math.sqrt(x * x + y * y + z * z);
}
