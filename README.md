# BLeak v1.2.2

[![Build Status](https://travis-ci.org/plasma-umass/BLeak.svg?branch=master)](https://travis-ci.org/plasma-umass/BLeak)
[![Build status](https://ci.appveyor.com/api/projects/status/b92sknh0pu38943q/branch/master?svg=true)](https://ci.appveyor.com/project/jvilk/bleak/branch/master)
[![npm version](https://badge.fury.io/js/bleak-detector.svg)](https://www.npmjs.com/package/bleak-detector)
[![Coverage Status](https://coveralls.io/repos/github/plasma-umass/BLeak/badge.svg)](https://coveralls.io/github/plasma-umass/BLeak)

[BLeak](http://bleak-detector.org/) automatically finds, ranks, and diagnoses memory leaks in the client-side of web applications.

BLeak uses a short developer-provided script to drive the application in a loop through specific visual states (e.g., the inbox view and email view of a mail client) as an oracle to find memory leaks. In our experience, BLeak's precision is often **100%** (e.g., no false positives), and fixing the leaks it finds reduces heap growth by **94%** on average on a corpus of real production web apps.

For more information please see [the BLeak website](http://bleak-detector.org/) and the [our academic paper](https://github.com/plasma-umass/BLeak/blob/master/paper.pdf), which appeared at PLDI 2018.

## Prerequisites

The following must be installed for BLeak to work:

* [mitmproxy](https://mitmproxy.org/) V4 (Tested with 4.0.1)
* Python 3.6 or greater
  * Our mitmproxy plugin uses new Python async features

Also, make sure port 8080 is free, as that is the port that MITMProxy uses by default.

## Installing

```
npm install -g bleak-detector
```

After installing, you should be able to run `bleak` from the command line.


## Using

1. **Build** BLeak (see above).
1. **Write** a *configuration file* for your web application (see below).
2. **Run** `bleak run --config path/to/config.js --out path/to/where/you/want/output`
    * The output directory should be unique for this specific run of BLeak, otherwise it will overwrite files in the directory. It will be created if needed.
3. **Wait.** BLeak typically runs in <10 minutes, but its speed depends on the number of states in your loop and the speed of your web application.
4. **Run the BLeak Results Viewer** by running `bleak viewer` and navigating to http://localhost:8889/ in a web browser. Upload `path/to/where/you/want/output/bleak_results.json` to the web application to view the results!
    * Alternatively, BLeak prints out a report in `bleak_report.log` in the same directory, but the results viewer presents additional information not captured in that log file.

## Configuration File

BLeak uses a configuration file to find memory leaks in the client-side of a web application. Only a few fields are required.

```javascript
// URL to the web application.
exports.url = "http://path/to/my/site";
// Runs your program in a loop. Each item in the array is a `state`. Each `state` has a "check"
// function, and a "next" function to transition to the next state in the loop. These run
// in the global scope of your web app.
// BLeak assumes that the app is in the first state when it navigates to the URL. If you specify
// optional setup states, then it assumes that the final setup state transitions the web app to
// the first state in the loop.
// The last state in the loop must transition back to the first.
exports.loop = [
  // First state
  {
    // Return 'true' if the web application is ready for `next` to be run.
    check: function() {
      // Example: `group-listing` must be on the webpage
      return !!document.getElementById('group-listing');
    },
    // Transitions to the next state.
    next: function() {
      // Example: Navigate to the first thread
      document.getElementById("thread-001").click();
    }
  },
  // Second (and last) state
  {
    check: function() {
      // Example: Make sure the body of the thread has loaded.
      return !!document.getElementById('thread-body');
    },
    // Since this is the last state in the loop, it must transition back to the first state.
    next: function() {
      // Example: Click back to group listing
      document.getElementById('group-001').click();
    }
  }
];

// (Optional) Number of loop iterations to perform during leak detection (default: 8)
exports.iterations = 8;

// (Optional) An array of states describing how to login to the application. Executed *once*
// to set up the session. See 'config.loop' for a description of a state.
exports.login = [
  {
    check: function() {
      // Return 'true' if the element 'password-field' exists.
      return !!document.getElementById('password-field');
    },
    next: function() {
      // Log in to the application.
      const pswd = document.getElementById('password-field');
      const uname = document.getElementById('username-field');
      const submitBtn = document.getElementById('submit');
      uname.value = 'spongebob';
      pswd.value = 'squarepants';
      submitBtn.click();
    }
  }
];
// (Optional) An array of states describing how to get from config.url to the first state in
// the loop. Executed each time the tool explicitly re-navigates to config.url. See
// config.loop for a description of states.
exports.setup = [

];
// (Optional) How long (in milliseconds) to wait for a state transition to finish before declaring an error.
// Defaults to 10 minutes
exports.timeout = 10 * 60 * 1000;
// (Optional) How long (in milliseconds) to wait between a check() returning 'true' and transitioning to the next step or taking a heap snapshot.
// Default: 1000
exports.postCheckSleep = 1000;
// (Optional) How long (in milliseconds) to wait between transitioning to the next step and running check() for the first time.
// Default: 0
exports.postNextSleep = 0;
// (Optional) How long (in milliseconds) to wait between submitting login credentials and reloading the page for a run.
// Default: 5000
exports.postLoginSleep = 5000;
// (Optional) An array of numerical IDs identifying leaks with fixes in your code. Used to
// evaluate memory savings with different leak configurations and the effectiveness of bug fixes.
// In the code, condition the fix on $$$SHOULDFIX$$$(ID), or add logic to `exports.rewrite` (see below),
// and BLeak will run the web app with the fixes applied.
exports.fixedLeaks = [0, 1, 2];
// (Optional) Proxy re-write rule that runs in a Node.js environment, *not* in the browser.
// Lets you rewrite the web app's JavaScript/HTML/CSS to test bug fixes. Especially useful for evaluating
// fixes on web apps you do not control.
// Return a Node.js Buffer containing the replacement resource contents, or the original contents if not
// modifying.
exports.rewrite = function(url /* URL of the resource */,
                  type /* MIME type of resource */,
                  data /* Contents of resource, as a Node.js Buffer */,
                  fixes /* Array of numerical IDs corresponding to bug fixes that are active during the session (see fixedLeaks) */) {
  function hasFix(n) {
    return fixes.indexOf(n) !== -1;
  }
  // Example: Filter out non-JavaScript resources.
  if (type.indexOf("javascript") !== -1) {
    if (url.indexOf("19/common.js") !== -1) {
      let src = data.toString();
      // Example: Replace a specific string in `19/common.js` to fix bug 0.
      if (hasFix(0)) {
        src = src.replace(`window.addEventListener("scroll",a,!1)`, 'window.onscroll=a');
      }
      return Buffer.from(src, 'utf8');
    }
  }
  return data;
};
```

## Developing

Interested in fixing bugs or building on BLeak? Excellent! Read below on how to build BLeak from source and run our unit tests.

### Prerequisites

* [Yarn](https://yarnpkg.com/en/docs/install) package manager
  * NPM *may* work, but we do not test against it

### Building

```
# Install NPM dependencies (only need to run once)
yarn install
# Build BLeak
yarn run build
```

### Testing

```
yarn test
```

### Debugging Tips

The bleak executable (runnable via `./bleak` once built) has a number of useful debug commands. For example, use `proxy-session` to debug issues with BLeak's proxy / diagnoses phase.

### MITMProxy issue

Solve:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
node index.js
```