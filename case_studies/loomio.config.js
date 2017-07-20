exports.url = "http://localhost:3000/dashboard";
// Runs your program in a loop. Each step has a "check" function, and a "next" function
// to transition to the next step in the loop.
// Deuterium oxide assumes your program is in the first step when it navigates to the URL,
// and that the last step transitions to the first step.
exports.loop = [
  {
    // (Optional) Name for debugging purposes.
    name: "login-username",
    // Return 'true' if the program has finished loading the current state
    // Can return a promise.
    check: function() {
      // Return 'true' if the element 'password-field' exists.
      const emailField = document.getElementsByTagName('input')[1];
      if (emailField) {
        return emailField.getAttribute('name') === 'email';
      }
      return false;
    },
    // Transitions to the next step. Can return a promise.
    next: function() {
      const emailField = document.getElementsByTagName('input')[1];
      emailField.value = 'default@loomio.org';
      // Notify Angular code of change.
      emailField.dispatchEvent(new Event("change"));
      const submitBtn = document.getElementsByTagName('button')[2];
      submitBtn.click();
    }
  },
  {
    name: "login-password",
    check: function() {
      //console.log("CHECK");
      //if (!window.__timer__) {
      //  window.__timer__ = Date.now();
      //}
      //if (Date.now() - window.__timer__ < 60000) {
      //  return false;
      //}
      //console.log("DONE");
      const pswdField = document.getElementsByTagName('input')[1];
      const modalHeader = document.getElementsByTagName('h2')[3];
      const submitBtn = document.getElementsByTagName('button')[3];
      return submitBtn && pswdField && pswdField.name === "password" && modalHeader && modalHeader.innerText === "Welcome back, default@loomio.org!" && submitBtn.innerText === "SIGN IN";
    },
    next: function() {
      const pswdField = document.getElementsByTagName('input')[1];
      pswdField.value = 'f5bc36a8';
      pswdField.dispatchEvent(new Event("change"));
      const submitBtn = document.getElementsByTagName('button')[3];
      submitBtn.click();
    }
  },
  {
    name: "thread-browse",
    check: function() {
      const tp = document.getElementsByClassName('thread-preview');
      if (tp.length > 0) {
        const thread = tp[0];
        return thread.childNodes.length > 0 && thread.childNodes[0].tagName === "A" && thread.childNodes[0].getAttribute('href') === "/d/Ysv5jUz1/how-to-use-loomio";
      }
      return false;
    },
    next: function() {
      document.getElementsByClassName('thread-preview')[0].childNodes[0].click();
    }
  },
  {
    name: "open-menu",
    check: function() {
      // Check if content has loaded.
      const paragraphs = document.getElementsByTagName('p');
      const h3 = document.getElementsByTagName('h3')[3];
      //document.getElementsByTagName('h3')[3].innerText
      // Loomio Helper Bot started a proposal
      return paragraphs.length > 6 && h3 && h3.innerText.indexOf("Loomio Helper Bot started a proposal") === 0 && paragraphs[5].innerText === "Welcome to Loomio, an online place to make decisions together.";
    },
    next: function() {
      // Opens menu w/ logout.
      document.getElementsByTagName('md_icon_button')[0].click();
    }
  },
  {
    name: "logout",
    check: function() {
      return document.getElementsByTagName('span')[12].innerText === "Sign out";
    },
    next: function() {
      // Log out of the application. Returns to login page.
      document.getElementsByTagName('span')[12].click();
    }
  }
];

// (Optional) How long to wait for a step transition to finish before declaring an error.
exports.timeout = 10000;
