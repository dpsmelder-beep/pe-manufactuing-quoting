// Portable OpenCV.js loader (browser-side).
//
// Loads the official OpenCV.js build via a dynamically injected <script> tag and
// resolves once the `cv` module is ready. No Base44-specific services are used;
// the only runtime dependency is the OpenCV.js script URL (defaulting to the
// official docs CDN). When the app is exported from Base44 and self-hosted, this
// continues to work as-is, or OPENCV_JS_URL can be pointed at a self-hosted copy.
//
// The loader tolerates both common OpenCV.js builds: the MODULARIZE build where
// `cv` is a factory function returning a promise, and the global build where
// `cv` is a module object that fires `onRuntimeInitialized`.

export const OPENCV_JS_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let loadPromise = null;

export function loadOpenCV(url = OPENCV_JS_URL, timeoutMs = 90000) {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    let done = false;
    const finish = (cv) => { if (!done) { done = true; resolve(cv); } };
    const fail = (err) => {
      if (!done) { done = true; loadPromise = null; reject(err); }
    };

    if (typeof window !== 'undefined' && window.cv && window.cv.Mat) {
      return finish(window.cv);
    }

    let funcTried = false;
    let attached = false;
    const poll = () => {
      if (done) return;
      const c = window.cv;
      if (c) {
        if (c.Mat) return finish(c);
        if (typeof c === 'function' && !funcTried) {
          // MODULARIZE build: call the factory, which returns a ready promise.
          funcTried = true;
          try {
            Promise.resolve(c()).then((m) => { window.cv = m; }).catch(() => {});
          } catch {
            /* ignore */
          }
        } else if (typeof c === 'object' && !attached) {
          // Global build: hook the runtime-initialized callback.
          attached = true;
          try { c.onRuntimeInitialized = () => finish(window.cv); } catch {
            /* ignore */
          }
        }
      }
      setTimeout(poll, 150);
    };

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = poll;
    script.onerror = () => fail(new Error('Failed to load OpenCV.js from ' + url));
    document.head.appendChild(script);
    setTimeout(() => fail(new Error('OpenCV.js load timed out')), timeoutMs);
  });
  return loadPromise;
}