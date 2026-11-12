// Highlighting runs off the main thread.
//
// The page used to load highlight.min.js as a global script and decode every
// paste on the main thread, which blocks input for the duration of a large
// highlightAuto(). This worker owns the library instead: the main thread sends
// text, receives HTML.

self.importScripts('highlight.min.js');

self.onmessage = function (event) {
  var data = event.data;
  var result;

  try {
    if (data.language === 'txt') {
      result = { value: null, language: 'txt' };
    } else if (data.language) {
      result = self.hljs.highlight(data.language, data.text);
    } else {
      result = self.hljs.highlightAuto(data.text);
    }
  } catch (err) {
    // failed highlight, fall back on auto
    result = self.hljs.highlightAuto(data.text);
  }

  self.postMessage({
    id: data.id,
    value: result.value,
    language: result.language || data.language
  });
};
