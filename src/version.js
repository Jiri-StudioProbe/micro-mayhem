// The release number, bumped by hand when a release is cut (keep package.json in step; a test checks).
// The commit that was actually deployed is stamped into the page by the deploy (`<meta name="build">`, see tools/stage-site.mjs).
export const VERSION = '1.4.0';

// The text shown on the start screen: the release, and the commit that was deployed ("dev" when running from a checkout).
export const versionLabel = (version, build) => 'v' + version + ' \u00b7 ' + (build === 'dev' ? 'dev build' : 'build ' + build);

export function readBuild(doc) {
  const meta = doc && doc.querySelector && doc.querySelector('meta[name="build"]');
  return (meta && meta.getAttribute('content')) || 'dev';
}
