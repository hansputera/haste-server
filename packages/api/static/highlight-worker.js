// Highlighting runs off the main thread.
//
// The page used to load highlight.min.js as a global script and decode every
// paste on the main thread, which blocks input for the duration of a large
// highlightAuto(). This worker owns the library instead: the main thread sends
// text, receives HTML.
//
// The bundle is Highlight.js 11 (see scripts/build-highlight.js), whose API is
// `highlight(code, { language })` — the v10 `highlight(language, code)` form is
// gone.

self.importScripts('highlight.min.js');

self.onmessage = function (event) {
  var data = event.data;
  var result;

  try {
    if (data.language === 'txt') {
      result = { value: null, language: 'txt' };
    } else if (data.language) {
      result = self.hljs.highlight(data.text, { language: data.language });
    } else {
      result = self.hljs.highlightAuto(data.text);
    }
  } catch (err) {
    // An unknown or failed grammar falls back to auto-detection. A paste whose
    // extension maps to a grammar this build does not ship must still render.
    result = self.hljs.highlightAuto(data.text);
  }

  self.postMessage({
    id: data.id,
    value: result.value,
    language: result.language || data.language
  });
};
