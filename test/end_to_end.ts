import {Server as HTTPServer} from 'http';
import BLeak from '../src/lib/bleak';
import createHTTPServer from './util/http_server';
import ChromeDriver from '../src/lib/chrome_driver';
import {readFileSync} from 'fs';
import {equal as assertEqual} from 'assert';
import NopProgressBar from '../src/lib/nop_progress_bar';

const HTTP_PORT = 8875;
const DEBUG = false;

interface TestFile {
  mimeType: string;
  data: Buffer;
}

function getHTMLDoc(docStr: string): { mimeType: string, data: Buffer } {
  return {
    mimeType: 'text/html',
    data: Buffer.from(docStr, 'utf8')
  };
}

function getHTMLConfig(name: string): { mimeType: string, data: Buffer } {
  return getHTMLDoc(`<!DOCTYPE html><html><head><title>${name}</title></head><body><button id="btn">Click Me</button><script type="text/javascript" src="/${name}.js"></script></body></html>`);
}

// 'Files' present in the test HTTP server
const FILES: {[name: string]: TestFile} = {
  '/test.html': getHTMLConfig('test'),
  '/test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`var obj = {};
    var i = 0;
    var power = 2;
    document.getElementById('btn').addEventListener('click', function() {
      var top = Math.pow(2, power);
      power++;
      for (var j = 0; j < top; j++) {
        obj[Math.random()] = Math.random();
      }
    });
    `, 'utf8')
  },
  '/closure_test.html': getHTMLConfig('closure_test'),
  '/closure_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      window.objfcn = function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      };
    })();
    document.getElementById('btn').addEventListener('click', function() {
      window.objfcn();
    });`)
  },
  '/closure_test_dom.html': getHTMLConfig('closure_test_dom'),
  '/closure_test_dom.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      });
    })();
    `, 'utf8')
  },
  '/closure_test_dom_on_property.html': getHTMLConfig('closure_test_dom_on_property'),
  '/closure_test_dom_on_property.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      document.getElementById('btn').onclick = function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      };
    })();
    `, 'utf8')
  },
  '/closure_test_irrelevant_dom.html': getHTMLDoc(`<!DOCTYPE html><html><head><title>Closure test irrelevant dom</title></head><body><button id="btn2">Don't click me</button><button id="btn">Click Me</button><button id="btn3">Don't click me, either</button><script type="text/javascript" src="/closure_test_irrelevant_dom.js"></script></body></html>`),
  '/closure_test_irrelevant_dom.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      });
    })();
    `, 'utf8')
  },
  '/closure_test_disconnected_dom.html': getHTMLDoc(`<!DOCTYPE html><html><head><title>Closure test disconnected dom</title></head><body><button id="btn">Click Me</button><script type="text/javascript" src="/closure_test_disconnected_dom.js"></script></body></html>`),
  '/closure_test_disconnected_dom.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      var btn = document.createElement('button');
      btn.addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      });
      window.$$btn = btn;
    })();
    (function() {
      document.getElementById('btn').addEventListener('click', function() {
        window.$$btn.click();
      });
    })();
    `, 'utf8')
  },
  /*'/closure_test_disconnected_dom_collection.html': getHTMLDoc(`<!DOCTYPE html><html><head><title>Closure test disconnected dom collection</title></head><body><button id="btn">Click Me</button><script type="text/javascript" src="/closure_test_disconnected_dom_collection.js"></script></body></html>`),
  '/closure_test_disconnected_dom_collection.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      document.body.appendChild(document.createElement('button'));
      var buttons = document.getElementsByTagName('button');
      buttons[1].addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      });
      document.body.removeChild(buttons[1]);
      window.$$btns = buttons;
    })();
    (function() {
      document.getElementById('btn').addEventListener('click', function() {
        window.$$btns[1].click();
      });
    })();
    `, 'utf8')
  },*/
  '/reassignment_test.html': getHTMLConfig('reassignment_test'),
  '/reassignment_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`
    (function() {
      var obj = [];
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj = obj.concat({ val: Math.random() });
        }
      });
    })();
    `, 'utf8')
  },
  '/multiple_paths_test.html': getHTMLConfig('multiple_paths_test'),
  '/multiple_paths_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var obj2 = obj;
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          if (obj === obj2) {
            var target = Math.random() > 0.5 ? obj : obj2;
            target[Math.random()] = Math.random();
          }
        }
      });
    })();
    `, 'utf8')
  },
  '/irrelevant_paths_test.html': getHTMLConfig('irrelevant_paths_test'),
  '/irrelevant_paths_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`var obj = {};
    var i = 0;
    var power = 2;
    document.getElementById('btn').addEventListener('click', function() {
      var top = Math.pow(2, power);
      power++;
      for (var j = 0; j < top; j++) {
        obj[Math.random()] = Math.random();
      }
      // Adds more properties, but properly deletes them.
      // Not a leak.
      var second = Math.random();
      obj[second] = second;
      delete obj[second];
    });`, 'utf8')
  },
  '/event_listener_leak.html': getHTMLConfig('event_listener_leak'),
  '/event_listener_leak.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`
    // Make unique functions so we can register many listeners.
    function getAddListener() {
      return function() {
        document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener());
      };
    }
    getAddListener()();`, 'utf8')
  },
  '/event_listener_removal.html': getHTMLConfig('event_listener_removal'),
  '/event_listener_removal.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`
    // Make unique functions so we can register many listeners.
    function getAddListener() {
      return function() {
        document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener()); document.getElementById('btn').addEventListener('click', getAddListener());
      };
    }
    getAddListener()();
    // Responsible function
    document.getElementById('btn').addEventListener('click', function() {
      var b = document.getElementById('btn');
      var l = getAddListener();
      b.addEventListener('click', l);
      b.removeEventListener('click', l);
    });`, 'utf8')
  },
  '/dom_growth_test.html': getHTMLConfig('dom_growth_test'),
  '/dom_growth_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`var body = document.getElementsByTagName('body')[0];
    document.getElementById('btn').addEventListener('click', function() {
      body.appendChild(document.createElement('div'));
    });`, 'utf8')
  },
  '/bleak_agent.js': {
    mimeType: 'text/javascript',
    data: readFileSync(require.resolve('../src/lib/bleak_agent'))
  }
};

describe('End-to-end Tests', function() {
  // 10 minute timeout.
  this.timeout(600000);
  let httpServer: HTTPServer;
  let driver: ChromeDriver;
  before(async function() {
    httpServer = await createHTTPServer(FILES, HTTP_PORT);
    if (!DEBUG) {
      // Silence debug messages.
      console.debug = () => {};
    }
    driver = await ChromeDriver.Launch(console, true, 1920, 1080);
  });

  function createStandardLeakTest(description: string, rootFilename: string, expected_line: number): void {
    it(description, async function() {
      // let i = 0;
      const result = await BLeak.FindLeaks(`
        exports.url = 'http://localhost:${HTTP_PORT}/${rootFilename}.html';
        // Due to throttling (esp. when browser is in background), it may take longer
        // than anticipated for the click we fire to actually run. We want to make
        // sure all snapshots occur after the click processes.
        var startedClickCount = 0;
        var completedClickCount = 0;
        exports.loop = [
          {
            name: 'Click Button',
            check: function() {
              return document.readyState === "complete" && startedClickCount === completedClickCount;
            },
            next: function() {
              startedClickCount++;
              if (completedClickCount === 0) {
                document.getElementById('btn').addEventListener('click', function() {
                  completedClickCount++;
                });
              }
              document.getElementById('btn').click();
            }
          }
        ];
        exports.timeout = 30000;
        exports.iterations = 3;
        exports.postCheckSleep = 100;
      `, new NopProgressBar(), driver/*, (ss) => {
        const stream = createWriteStream(`${rootFilename}${i}.heapsnapshot`);
        ss.onSnapshotChunk = function(chunk, end) {
          stream.write(chunk);
          if (end) {
            stream.end();
          }
        };
        i++;
        return Promise.resolve();
      }*/);
      assertEqual(result.leaks.length > 0, true);
      result.leaks.forEach((leak) => {
        const stacks = leak.stacks;
        assertEqual(stacks.length > 0, true);
        stacks.forEach((s) => {
          assertEqual(s.length > 0, true);
          const topFrame = result.stackFrames[s[0]];
          //console.log(topFrame.toString());
          assertEqual(topFrame[1], expected_line);
          assertEqual(topFrame[0].indexOf(`${rootFilename}.js`) !== -1, true);
        });
      });
    });
  }

  createStandardLeakTest('Catches leaks', 'test', 8);
  createStandardLeakTest('Catches leaks in closures', 'closure_test', 9);
  createStandardLeakTest('Catches leaks in closures on dom', 'closure_test_dom', 9);
  createStandardLeakTest('Catches leaks in closures when event listener is assigned on a property', 'closure_test_dom_on_property', 9);
  createStandardLeakTest('Catches leaks in closures, even with irrelevant DOM objects', 'closure_test_irrelevant_dom', 9);
  createStandardLeakTest('Catches leaks in closures, even with disconnected DOM fragments', 'closure_test_disconnected_dom', 10);
  // Not supported.
  // createStandardLeakTest('Catches leaks in closures, even with disconnected DOM collections', 'closure_test_disconnected_dom_collection', 11);
  createStandardLeakTest('Catches leaks when object is copied and reassigned', 'reassignment_test', 10);
  createStandardLeakTest('Catches leaks when object stored in multiple paths', 'multiple_paths_test', 12);
  createStandardLeakTest('Ignores code that does not grow objects', 'irrelevant_paths_test', 8);
  createStandardLeakTest('Catches event listener leaks', 'event_listener_leak', 5);
  createStandardLeakTest('Ignores responsible event listener removal', 'event_listener_removal', 5);
  createStandardLeakTest('Catches leaks that grow DOM unboundedly', 'dom_growth_test', 3);

  after(function(done) {
    //setTimeout(function() {
    // Shutdown both HTTP server and proxy.
    function finish() {
      httpServer.close((e: any) => {
        if (e) {
          done(e);
        } else {
          driver.shutdown().then(() => {
            done();
          }).catch(done);
        }
      });
    }
    DEBUG ? setTimeout(finish, 99999999) : finish();
    //}, 99999999);
  });
});