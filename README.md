# BLeak

Find memory leaks in your single page web application!

More documentation coming soon...

## Configuration File

```javascript
exports = {
  url: "http://path/to/my/site",
  // (Optional) Globs for script files that should be *black boxed* during leak detection.
  blackBox: ["vendor/**/*.js", "jQuery.js"],
  // Runs your program in a loop. Each step has a "check" function, and a "next" function
  // to transition to the next step in the loop.
  // Deuterium oxide assumes your program is in the first step when it navigates to the URL,
  // and that the last step transitions to the first step.
  loop: [
    {
      // (Optional) Name for debugging purposes.
      name: "login",
      // Return 'true' if the program has finished loading the current state
      // Can return a promise.
      check: function() {
        // Return 'true' if the element 'password-field' exists.
        return !!document.getElementById('password-field');
      },
      // Transitions to the next step. Can return a promise.
      next: function() {
        // Log in to the application.
        const pswd = document.getElementById('password-field');
        const uname = document.getElementById('username-field');
        const submitBtn = document.getElementById('submit');
        uname.value = 'spongebob';
        pswd.value = 'squarepants';
        submitBtn.click();
      }
    },
    {
      name: "logout",
      check: function() {
        // Check if content has loaded.
        return !!document.getElementById('content');
      },
      next: function() {
        // Log out of the application. Returns to login page.
        document.getElementById('logout').click();
      }
    }
  ],
  // (Optional) How long to wait for a step transition to finish before declaring an error.
  timeout: 10000
};
```
