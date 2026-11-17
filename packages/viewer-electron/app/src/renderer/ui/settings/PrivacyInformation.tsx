export function PrivacyInformation({ showLicense = false }: { showLicense?: boolean }) {
  return (
    <div className="privacy-information">
      <p>
        Your files, search indexes and previews stay on this Mac. Viewer has no ads or analytics.
      </p>
      <p>
        A model receives only the file data you approve, at the endpoint you set. Revoke it in
        Models; a provider may keep what it already received.
      </p>
      <p>API keys are encrypted by macOS and kept out of config.jsonc.</p>
      <p>Agents connect only from this Mac, to the folders you allow in Agents.</p>
      <p>
        Update checks send nothing about your files, and no report leaves this Mac unless you send
        it to source@plurid.com.
      </p>
      {showLicense && (
        <p>Your license key holds your purchase email and is checked on this Mac, offline.</p>
      )}
    </div>
  );
}
