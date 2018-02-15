exports.url = "http://localhost:3000/dashboard";
exports.login = [
  {
    // Return 'true' if the program has finished loading the current state
    check: function() {
      // Return 'true' if the element 'password-field' exists.
      const emailField = document.getElementsByTagName('input')[1];
      if (emailField) {
        return emailField.getAttribute('name') === 'email';
      }
      return false;
    },
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
    check: function() {
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
  }
];
exports.setup = [
  {
    check: function() {
      const tp = document.getElementsByClassName('thread-preview');
      if (tp.length > 0) {
        const thread = tp[0];
        return thread.childNodes.length > 0 && thread.childNodes[0].tagName === "A" && thread.childNodes[0].getAttribute('href') === "/d/Ysv5jUz1/how-to-use-loomio";
      }
      return false;
    },
    next: function() {
      document.getElementsByTagName('md_icon_button')[0].click();
    }
  }
];
exports.loop = [
  {
    check: function() {
      const span = document.getElementsByTagName('span')[6];
      return !!span && span.innerText === "Fun Group 1";
    },
    next: function() {
      document.getElementsByTagName('span')[6].click();
    }
  },
  {
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
  }
];

// 30 second timeout
exports.timeout = 30000;

// Maps leak roots to distinct fix IDs, which are referenced in the code.
exports.fixMap = {
  'window.angular.element.cache[3].events["resize.mentio"]': 0,
  'window.angular.element.cache[2].events["click.mentio"]': 1,
  'window.angular.element.cache[2].events["paste.mentio"]': 3,
  'window.angular.element.cache[2].events["keypress.mentio"]': 4,
  'window.angular.element.cache[2].events["keydown.mentio"]': 2,
  'window.Loomio.records.discussions.collection.DynamicViews': 5,
  'window.dataLayer': -1,
  'List of \'$translateChangeSuccess\' listeners on window.angular.element.cache[4].data.$scope.$parent': 99,
  'window.Loomio.records.stanceChoices.collection.DynamicViews': 13,
  'window.Loomio.records.versions.collection.DynamicViews': 14
};
