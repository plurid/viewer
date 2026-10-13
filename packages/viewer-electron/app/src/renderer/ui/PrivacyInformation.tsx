export function PrivacyInformation() {
  return (
    <div className="privacy-information">
      <p className="settings-note">
        Viewer keeps file browsing, search indexes, previews and workspace settings on this Mac. It
        has no advertising, analytics or automatic file uploads.
      </p>
      <h3>Optional models</h3>
      <p>
        Model actions send your instructions and the file data you approve to the provider and
        endpoint shown before the request. That can include filenames, metadata, document excerpts
        or extracted text. Local endpoints receive requests too, so choose an endpoint you trust.
      </p>
      <p>
        Approval is stored privately for that provider, endpoint and data level. Revoke it in Models
        to stop active requests and prevent future ones. Changing an endpoint requires new approval.
        API keys are encrypted with macOS storage and are separate from the editable configuration
        file.
      </p>
      <p>
        A provider may retain data already sent under its own policy. Revoking permission in Viewer
        stops future sharing; deletion of previously sent data must be requested from that provider.
      </p>
      <h3>Files and local records</h3>
      <p>
        The App Store edition saves permissions for files and folders you choose. Manage them in
        Permissions. Revoking stops dependent work and purges affected indexes and preview caches. A
        separately allowed parent folder can still provide access.
      </p>
      <p>
        Workspace history, task proposals and operation receipts remain in private local application
        storage so interrupted work can be reviewed. The direct-download edition uses your macOS
        filesystem permissions. Removing the app does not remove your files.
      </p>
      <h3>Agents and commands</h3>
      <p>
        Agents connect locally with a private token and the access you enable in Agents. Commands
        and terminal profiles run only when invoked. An external terminal, command or connected
        agent can use data you give it under its own permissions and policies.
      </p>
      <h3>Support</h3>
      <p>
        Contact source@plurid.com. If you send a report, share only the details you want support to
        receive. Viewer does not automatically send diagnostic reports.
      </p>
    </div>
  );
}
