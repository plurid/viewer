# Diagnostic log and report privacy

**Help → Show Diagnostic Log** opens the local failure log. Viewer masks the following recognizable
forms before writing a record.

| Form                                     | What the log masks                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named fields and environment assignments | Password aliases `password`, `passwd`, `pwd` and `pass`, plus names ending in `secret`, `token`, `cookie`, `authorization`, `apikey`, `accesskey` or `privatekey`. Case, hyphens and underscores are ignored. SSH askpass prompt, answer, response, socket and configuration fields are also masked. A free-text assignment hides its value to the end of the physical line. |
| HTTP authorization                       | The value of an `Authorization` or `Proxy-Authorization` field, including Basic and Bearer credentials. Those scheme names can also occur in ordinary text.                                                                                                                                                                                                                  |
| Options and JSON                         | A credential-named command-line option or `-u` hides its shell operand. A credential-named JSON member hides its value. A quote opened inside a credential value can continue onto later lines. A trailing backslash alone or a colon with no value ends at the line break.                                                                                                  |
| Query parameters                         | Sensitive parameter values in URLs, including absolute destination URLs in another parameter. Viewer checks raw and encoded destinations through two decoding passes. In form-encoded values, `+` represents a space. Viewer masks the containing value when decoding or nesting exceeds its inspection limits.                                                              |
| Recognizable tokens                      | Provider-prefixed API tokens, AWS access key IDs, long hexadecimal strings and padded Base64 tokens.                                                                                                                                                                                                                                                                         |
| PEM private keys                         | A private-key header on a line of its own, with optional surrounding whitespace, starts masking through its matching footer or 64 physical lines including the header. A mention of the header in a sentence stays readable.                                                                                                                                                 |
| Viewer license keys                      | Complete keys, including keys used as path segments. Viewer also masks a plausible payload after the version marker, or a line containing just an encoded license payload or a full 86-character signature. The signature can follow a payload fragment on that line. A public version marker alone stays readable. A worker writes each finished record immediately.        |

Viewer checks each physical line independently. If a line break splits the signature, a detached
piece without a recognizable credential form can remain visible.

**Help → Copy Report…** shows environment facts and structured failure summaries by default.
**Include message text** adds locally filtered excerpts. Viewer checks account, computer and volume
names and masks identifiable paths and addresses. Worker stderr contributes structured details only.
The local log can contain private names, paths and credentials in unrecognized formats. Read the
displayed report before sharing it. **Copy** places that text on the clipboard.

[Report a problem](../guides/troubleshooting.md#report-a-problem)
