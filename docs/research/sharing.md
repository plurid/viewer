# Sharing files and views

`plurid.link` is a proposed sharing direction, not a currently delivered Viewer service.
Domain/service availability and hosting still need decisions.

## Three different links

| Kind               | Meaning                                       | Main question                                        |
| ------------------ | --------------------------------------------- | ---------------------------------------------------- |
| Local reference    | Open a file/view on an authorized machine     | How does another device resolve identity and access? |
| Immutable snapshot | Share selected bytes and a saved view         | What is uploaded, retained and revocable?            |
| Live content       | Serve changing data from a machine or service | What must remain online, and who can access it?      |

Start with an explicit snapshot manifest and a useful recipient preview. Show what will be shared,
total size, audience, expiration and revocation. Files, folder listings, source context and saved
camera/view state need separate choices.

## Share a view, not just bytes

A recipient might receive a model at a chosen camera, a PDF on a marked page, a comparison, or a
small group of related files. References must stay bounded; private notes, credentials, hidden files
and unrelated workspace state should not enter a share merely because they were nearby.

Preview the recipient experience before publishing. Distinguish a frozen snapshot from a link that
will change. A link is not a general remote-control channel.

## Other file-manager ideas

Loaf's named network shares, link sharing, asynchronous previews, live folder updates, archive
browsing and conflict comparison suggest useful everyday flows. Tabs/split views in other managers
reinforce the value of stable places and explicit source/destination context. Viewer can express
those jobs through focused planes, paired folders and saved workspaces.

Further directions include saved transfer destinations, inbox/review flows, relationship-aware
bundles, selective synchronization, versioned handoff rooms and recipient-specific workspace views.
Each should first demonstrate a small complete task rather than introduce permanent chrome.

## Service boundary

Publishing needs authentication, manifests, storage/transport, limits, abuse handling, retention and
deletion semantics. Local tunneling and hosted snapshots have different lifetimes. Reuse file
identity and explicit review while keeping remote-sharing authority separate from agent folder
grants and browser sessions.
