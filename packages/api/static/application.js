/* global window, document, history, fetch, Worker */

///// represents a single document

// Highlighting happens in a Web Worker so a large paste never blocks input.
// `value === null` from the worker means "escape it yourself" (the `txt` path).
var highlighter = (function () {
  var worker = new Worker('highlight-worker.js');
  var nextId = 1;
  var pending = {};

  worker.onmessage = function (event) {
    var job = pending[event.data.id];
    delete pending[event.data.id];
    if (job) job(event.data);
  };

  return function highlight(text, language, done) {
    var id = nextId++;
    pending[id] = done;
    worker.postMessage({ id: id, text: text, language: language });
  };
})();


var haste_document = function() {
  this.locked = false;
};

// Escapes HTML tag characters
haste_document.prototype.htmlEscape = function(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/>/g, '&gt;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
};

// Get this document from the server and lock it here
haste_document.prototype.load = function(key, callback, lang) {
  var _this = this;
  fetch('/documents/' + encodeURIComponent(key), {
    headers: { Accept: 'application/json' }
  })
    .then(function(res) {
      if (!res.ok) throw new Error('request failed');
      return res.json();
    })
    .then(function(res) {
      _this.locked = true;
      _this.key = key;
      _this.data = res.data;
      highlighter(res.data, lang, function (high) {
        callback({
          value: high.value === null ? _this.htmlEscape(res.data) : high.value,
          key: key,
          language: high.language || lang,
          lineCount: res.data.split('\n').length
        });
      });
    })
    .catch(function() {
      callback(false);
    });
};

// Save this document to the server and lock it here
haste_document.prototype.save = function(data, callback) {
  if (this.locked) {
    return false;
  }
  this.data = data;
  var _this = this;
  fetch('/documents', {
    method: 'post',
    body: data,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      Accept: 'application/json'
    }
  })
    .then(function(res) {
      if (!res.ok) {
        return res.text().then(function(text) {
          var parsed;
          try { parsed = JSON.parse(text); }
          catch (e) { parsed = { message: 'Something went wrong!' }; }
          callback(parsed);
        });
      }
      return res.json().then(function (res) {
        _this.locked = true;
        _this.key = res.key;
        highlighter(data, undefined, function (high) {
          callback(null, {
            value: high.value === null ? _this.htmlEscape(data) : high.value,
            key: res.key,
            language: high.language,
            lineCount: data.split('\n').length
          });
        });
      });
    })
    .catch(function() {
      callback({ message: 'Something went wrong!' });
    });
  return true;
};

///// represents the paste application

var haste = function(appName, options) {
  this.appName = appName;
  this.$textarea = document.querySelector('textarea');
  this.$box = document.querySelector('#box');
  this.$code = document.querySelector('#box code');
  this.$linenos = document.querySelector('#linenos');
  this.options = options;
  this.configureShortcuts();
  this.configureButtons();
  // If twitter is disabled, hide the button
  if (!options.twitter) {
    document.querySelector('#box2 .twitter').style.display = 'none';
  }
};

// Set the page title - include the appName
haste.prototype.setTitle = function(ext) {
  var title = ext ? this.appName + ' - ' + ext : this.appName;
  document.title = title;
};

// Show a message box
haste.prototype.showMessage = function(msg, cls) {
  var msgBox = document.createElement('li');
  msgBox.className = (cls || 'info');
  msgBox.textContent = msg;
  document.querySelector('#messages').prepend(msgBox);
  setTimeout(function() {
    msgBox.remove();
  }, 3000);
};

// Show the light key
haste.prototype.lightKey = function() {
  this.configureKey(['new', 'save']);
};

// Show the full key
haste.prototype.fullKey = function() {
  this.configureKey(['new', 'duplicate', 'twitter', 'raw']);
};

// Set the key up for certain things to be enabled
haste.prototype.configureKey = function(enable) {
  var buttons = document.querySelectorAll('#box2 .function');
  for (var i = 0; i < buttons.length; i++) {
    var el = buttons[i];
    if (enable.some(function(name) { return el.classList.contains(name); })) {
      el.classList.add('enabled');
    }
    else {
      el.classList.remove('enabled');
    }
  }
};

// Remove the current document (if there is one)
// and set up for a new one
haste.prototype.newDocument = function(hideHistory) {
  this.$box.style.display = 'none';
  this.doc = new haste_document();
  if (!hideHistory) {
    window.history.pushState(null, this.appName, '/');
  }
  this.setTitle();
  this.lightKey();
  var textarea = this.$textarea;
  textarea.value = '';
  textarea.style.display = '';
  textarea.focus();
  this.removeLineNumbers();
};

// Map of common extensions
// Note: this list does not need to include anything that IS its extension,
// due to the behavior of lookupTypeByExtension and lookupExtensionByType
// Note: optimized for lookupTypeByExtension
haste.extensionMap = {
  rb: 'ruby', py: 'python', pl: 'perl', php: 'php', scala: 'scala', go: 'go',
  xml: 'xml', html: 'xml', htm: 'xml', css: 'css', js: 'javascript', vbs: 'vbscript',
  lua: 'lua', pas: 'delphi', java: 'java', cpp: 'cpp', cc: 'cpp', m: 'objectivec',
  vala: 'vala', sql: 'sql', sm: 'smalltalk', lisp: 'lisp', ini: 'ini',
  diff: 'diff', bash: 'bash', sh: 'bash', tex: 'latex', erl: 'erlang', hs: 'haskell',
  md: 'markdown', txt: '', coffee: 'coffeescript', swift: 'swift'
};

// Look up the extension preferred for a type
// If not found, return the type itself - which we'll place as the extension
haste.prototype.lookupExtensionByType = function(type) {
  for (var key in haste.extensionMap) {
    if (haste.extensionMap[key] === type) return key;
  }
  return type;
};

// Look up the type for a given extension
// If not found, return the extension - which we'll attempt to use as the type
haste.prototype.lookupTypeByExtension = function(ext) {
  return haste.extensionMap[ext] || ext;
};

// Add line numbers to the document
// For the specified number of lines
haste.prototype.addLineNumbers = function(lineCount) {
  var h = '';
  for (var i = 0; i < lineCount; i++) {
    h += (i + 1).toString() + '<br/>';
  }
  this.$linenos.innerHTML = h;
};

// Remove the line numbers
haste.prototype.removeLineNumbers = function() {
  this.$linenos.innerHTML = '&gt;';
};

// Load a document and show it
haste.prototype.loadDocument = function(key) {
  // Split the key up
  var parts = key.split('.', 2);
  // Ask for what we want
  var _this = this;
  _this.doc = new haste_document();
  _this.doc.load(parts[0], function(ret) {
    if (ret) {
      _this.$code.innerHTML = ret.value;
      _this.setTitle(ret.key);
      _this.fullKey();
      _this.$textarea.value = '';
      _this.$textarea.style.display = 'none';
      _this.$box.style.display = '';
      _this.$box.focus();
      _this.addLineNumbers(ret.lineCount);
    }
    else {
      _this.newDocument();
    }
  }, this.lookupTypeByExtension(parts[1]));
};

// Duplicate the current document - only if locked
haste.prototype.duplicateDocument = function() {
  if (this.doc.locked) {
    var currentData = this.doc.data;
    this.newDocument();
    this.$textarea.value = currentData;
  }
};

// Lock the current document
haste.prototype.lockDocument = function() {
  var _this = this;
  this.doc.save(this.$textarea.value, function(err, ret) {
    if (err) {
      _this.showMessage(err.message, 'error');
    }
    else if (ret) {
      _this.$code.innerHTML = ret.value;
      _this.setTitle(ret.key);
      var file = '/' + ret.key;
      if (ret.language) {
        file += '.' + _this.lookupExtensionByType(ret.language);
      }
      window.history.pushState(null, _this.appName + '-' + ret.key, file);
      _this.fullKey();
      _this.$textarea.value = '';
      _this.$textarea.style.display = 'none';
      _this.$box.style.display = '';
      _this.$box.focus();
      _this.addLineNumbers(ret.lineCount);
    }
  });
};

haste.prototype.configureButtons = function() {
  var _this = this;
  this.buttons = [
    {
      $where: document.querySelector('#box2 .save'),
      label: 'Save',
      shortcutDescription: 'control + s',
      shortcut: function(evt) {
        return evt.ctrlKey && (evt.keyCode === 83);
      },
      action: function() {
        if (_this.$textarea.value.replace(/^\s+|\s+$/g, '') !== '') {
          _this.lockDocument();
        }
      }
    },
    {
      $where: document.querySelector('#box2 .new'),
      label: 'New',
      shortcut: function(evt) {
        return evt.ctrlKey && evt.keyCode === 78;
      },
      shortcutDescription: 'control + n',
      action: function() {
        _this.newDocument(!_this.doc.key);
      }
    },
    {
      $where: document.querySelector('#box2 .duplicate'),
      label: 'Duplicate & Edit',
      shortcut: function(evt) {
        return _this.doc.locked && evt.ctrlKey && evt.keyCode === 68;
      },
      shortcutDescription: 'control + d',
      action: function() {
        _this.duplicateDocument();
      }
    },
    {
      $where: document.querySelector('#box2 .raw'),
      label: 'Just Text',
      shortcut: function(evt) {
        return evt.ctrlKey && evt.shiftKey && evt.keyCode === 82;
      },
      shortcutDescription: 'control + shift + r',
      action: function() {
        window.location.href = '/raw/' + _this.doc.key;
      }
    },
    {
      $where: document.querySelector('#box2 .twitter'),
      label: 'Twitter',
      shortcut: function(evt) {
        return _this.options.twitter && _this.doc.locked && evt.shiftKey && evt.ctrlKey && evt.keyCode == 84;
      },
      shortcutDescription: 'control + shift + t',
      action: function() {
        window.open('https://twitter.com/share?url=' + encodeURI(window.location.href));
      }
    }
  ];
  for (var i = 0; i < this.buttons.length; i++) {
    this.configureButton(this.buttons[i]);
  }
};

haste.prototype.configureButton = function(options) {
  var where = options.$where;
  // Handle the click action
  where.addEventListener('click', function(evt) {
    evt.preventDefault();
    if (!options.clickDisabled && where.classList.contains('enabled')) {
      options.action();
    }
  });
  // Show the label
  where.addEventListener('mouseenter', function() {
    document.querySelector('#box3 .label').textContent = options.label;
    document.querySelector('#box3 .shortcut').textContent = options.shortcutDescription || '';
    document.querySelector('#box3').style.display = '';
    var pointer = document.querySelector('#pointer');
    pointer.style.display = '';
    where.append(pointer);
  });
  // Hide the label
  where.addEventListener('mouseleave', function() {
    document.querySelector('#box3').style.display = 'none';
    document.querySelector('#pointer').style.display = 'none';
  });
};

// Configure keyboard shortcuts for the textarea
haste.prototype.configureShortcuts = function() {
  var _this = this;
  document.body.addEventListener('keydown', function(evt) {
    var button;
    for (var i = 0 ; i < _this.buttons.length; i++) {
      button = _this.buttons[i];
      if (button.shortcut && button.shortcut(evt)) {
        evt.preventDefault();
        button.action();
        return;
      }
    }
  });
};

///// Tab behavior in the textarea - 2 spaces per tab

var configureTab = function() {
  document.querySelector('textarea').addEventListener('keydown', function(evt) {
    if (evt.keyCode === 9) {
      evt.preventDefault();
      var myValue = '  ';
      // http://stackoverflow.com/questions/946534/insert-text-into-textarea-with-jquery
      // For browsers like Internet Explorer
      if (document.selection) {
        this.focus();
        var sel = document.selection.createRange();
        sel.text = myValue;
        this.focus();
      }
      // Mozilla and Webkit
      else if (this.selectionStart || this.selectionStart == '0') {
        var startPos = this.selectionStart;
        var endPos = this.selectionEnd;
        var scrollTop = this.scrollTop;
        this.value = this.value.substring(0, startPos) + myValue +
          this.value.substring(endPos,this.value.length);
        this.focus();
        this.selectionStart = startPos + myValue.length;
        this.selectionEnd = startPos + myValue.length;
        this.scrollTop = scrollTop;
      }
      else {
        this.value += myValue;
        this.focus();
      }
    }
  });
};

///// boot. This script is loaded in <head>, so the elements it binds only
///// exist once the document has been parsed.

var app = null;

// Handle pops
var handlePop = function(target) {
  var path = target.location.pathname;
  if (path === '/') { app.newDocument(true); }
  else { app.loadDocument(path.substring(1, path.length)); }
};

window.addEventListener('popstate', function(evt) {
  try { handlePop(evt.target); } catch(err) { /* not loaded yet */ }
});

// The v2 recommendation banner. Dismissal is remembered so a returning author
// is not nagged; the `v2` button in the toolbar is untouched by this, so the
// entry point survives a dismissal.
var V2_BANNER_DISMISSED = 'haste:v2-banner-dismissed';

var configureV2Banner = function() {
  var banner = document.querySelector('#v2-banner');
  if (!banner) { return; }

  var dismissed = false;
  try { dismissed = window.localStorage.getItem(V2_BANNER_DISMISSED) === '1'; }
  catch (err) { /* storage blocked: show it every time rather than hide it */ }

  if (dismissed) { return; }

  banner.hidden = false;
  // The banner is fixed above the editor, so the toolbar has to move down.
  document.body.classList.add('has-v2-banner');

  banner.querySelector('button').addEventListener('click', function() {
    banner.hidden = true;
    document.body.classList.remove('has-v2-banner');
    try { window.localStorage.setItem(V2_BANNER_DISMISSED, '1'); }
    catch (err) { /* nothing to persist to */ }
  });
};

document.addEventListener('DOMContentLoaded', function() {
  app = new haste('hastebin', { twitter: true });
  configureTab();
  configureV2Banner();
  handlePop(window);
});
