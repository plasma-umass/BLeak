# BLeak

Find memory leaks in your single page web application!

More documentation coming soon...

## Configuration File

```javascript
exports = {
  // (Optional) Name for debugging purposes.
  name: "config name",
  // URL to the website.
  url: "http://path/to/my/site",
  // (Optional) Globs for script files that should be *black boxed* during leak detection. Reported stack frames will begin at your code.
  blackBox: ["vendor/**/*.js", "jQuery.js"],
  // (Optional) An array of numbers identifying leaks with fixes in your code. Used to evaluate memory savings with different leak configurations. In the code, condition the fix on $$$SHOULDFIX$$$(number), and make sure the number is in this array.
  fixedLeaks: [0, 1, 2],
  // (Optional) An array of steps describing how to log in to the application. Executed once to set up the session. See 'config.loop' for a description of a step.
  login: [
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
  ]
  // (Optional) An array of Steps describing how to get from config.url to the first step in the loop. Executed each time the tool explicitly re-navigates to config.url. See config.loop for a description of steps.
  setup: [

  ],
  // Runs your program in a loop. Each step has a "check" function, and a "next" function
  // to transition to the next step in the loop.
  // BLeak assumes your program is in the first step after executing the setup steps
  // (or when it navigates to the URL, if there are no setup steps), and that the
  // last step transitions to the first step.
  loop: [
    {
      // (Optional) Step name for debugging purposes.
      name: "navigateToThread",
      // Return 'true' if the web application is ready for `next` to be run.
      check: function() {
        return !!document.getElementById('group-listing');
      },
      // Transitions to the next step.
      next: function() {
        // Navigate to a thread
        document.getElementById("thread-001").click();
      }
    },
    {
      name: "navigateToGroup",
      check: function() {
        // Check if content has loaded.
        return !!document.getElementById('thread-body');
      },
      next: function() {
        // Click back to group page
        document.getElementById('group-001').click();
      }
    }
  ],
  // (Optional) How long to wait for a step transition to finish before declaring an error.
  timeout: 10000
};
```
