# Distribution Repository

`distribution.json` is the single build-time configuration for the desktop
application's GitHub distribution repository:

```json
{
  "github_repository": "Heyiki/TrayClip"
}
```

Use an `owner/repository` value, not a URL. This controls application update
checks, OCR engine asset URLs, OCR manifest repository validation, and the
release workflow's repository guard. The GitHub host and endpoint structure
remain fixed.

After changing it, regenerate the OCR package/manifest and rebuild the
application. Cargo tracks changes to this file automatically. An old manifest
for a different repository will be rejected, not silently redirected.

This file is not a runtime setting. Editing or adding it next to an installed
application does not change that application's download source. There is no
fallback to Git remotes or environment-based repository discovery.

The About page and official website retain their original `Heyiki/TrayClip`
links and do not read this configuration. Changing the distribution repository
does not change project attribution.

Before publishing, confirm that the configured repository's release contains
the exact OCR ZIP referenced by each application's embedded manifest.
