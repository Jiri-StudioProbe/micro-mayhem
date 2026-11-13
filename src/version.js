// The release number, bumped by hand when a release is cut (keep package.json in step; a test checks).
// The commit that was actually deployed is stamped into the page by the deploy (`<meta name="build">`, see tools/stage-site.mjs).
export const VERSION = '1.4.0';

export function readBuild(doc) {
  const meta = doc && doc.querySelector && doc.querySelector('meta[name="build"]');
  return (meta && meta.getAttribute('content')) || 'dev';
}
