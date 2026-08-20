// Portable OpenCV.js loader — local, bundled dependency.
//
// OpenCV.js is imported from the installed npm package (`@techstark/opencv-js`),
// NOT fetched from a CDN at runtime. The package is bundled with the app, so it
// remains portable and works after the app is exported from Base44 and
// self-hosted. No Base44-specific services are used.
//
// The package's default export can be a Promise (module factory), an already
// ready module (with `Mat`), or a module that fires `onRuntimeInitialized`. All
// three forms are handled, and a timeout + explicit error path prevent the
// diagnostic from hanging on "Detecting lines…" / "Removing lines…".

import cvModule from '@techstark/opencv-js';

let cvPromise = null;

/**
 * Resolve with the ready OpenCV.js `cv` module. Rejects with the actual
 * initialization error on failure (or a timeout), so callers can surface it.
 */
export function loadOpenCV(timeoutMs = 60000) {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    let cv;

    if (cvModule && cvModule.Mat) {
      // Already ready (synchronous import).
      cv = cvModule;
    } else if (cvModule instanceof Promise) {
      // Factory form: await the ready promise, with a timeout guard.
      cv = await Promise.race([
        cvModule,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenCV.js initialization timed out')), timeoutMs)
        ),
      ]);
      if (!cv || !cv.Mat) {
        throw new Error('OpenCV.js module resolved but cv.Mat is unavailable');
      }
    } else if (cvModule) {
      // Global module form: wait for runtime initialization, with a timeout.
      cv = await new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error('OpenCV.js initialization timed out')),
          timeoutMs
        );
        cvModule.onRuntimeInitialized = () => {
          clearTimeout(t);
          resolve(cvModule);
        };
        if (typeof cvModule.onAbort === 'function') {
          cvModule.onAbort = (reason) => {
            clearTimeout(t);
            reject(new Error('OpenCV.js aborted initialization: ' + reason));
          };
        }
      });
      if (!cv || !cv.Mat) {
        throw new Error('OpenCV.js initialized but cv.Mat is unavailable');
      }
    } else {
      throw new Error('OpenCV.js module is undefined');
    }

    return cv;
  })().catch((err) => {
    // Allow a retry on failure.
    cvPromise = null;
    throw err;
  });
  return cvPromise;
}