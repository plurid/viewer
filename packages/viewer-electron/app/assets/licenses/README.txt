Viewer CAD preview dependencies

occt-import-js 0.0.23 and its bundled Open CASCADE WebAssembly importer run locally
in a disposable preview worker. Their unmodified license texts are included here.
The importer JavaScript and WASM are shipped as separate renderer assets.

Importer source and build instructions:
https://github.com/kovacsv/occt-import-js
Pinned package including importer source:
https://registry.npmjs.org/occt-import-js/-/occt-import-js-0.0.23.tgz
Open CASCADE source:
https://github.com/Open-Cascade-SAS/OCCT

See occt-import-js.txt and opencascade.txt for the applicable notices and terms.

Viewer Office layout dependencies

ZetaOffice 24.2 is an unmodified LibreOffice WebAssembly build provided by
allotropia. All six Word, Excel and PowerPoint formats are rendered locally;
the installed application does not fetch an engine or send documents remotely.
Build ID: efaf0670b4d055f838a2849becb10f08aa06a257
Source and build instructions:
https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2
https://github.com/allotropia/zetajs#build-your-own-libreoffice-wasm-binaries
Reviewed runtime URL: https://cdn.zetaoffice.net/zetaoffice_latest/
The versioned Viewer manifest verifies decoded asset sizes and SHA-256 hashes.
See libreoffice-mpl-2.0.txt for the license and libreoffice-24.2-notices.xml
for the upstream 24.2 third-party notices, including conditional components
and bundled fonts. Source notices are included unchanged, in their XML format.

ZetaJS 1.2.0 is the unmodified MIT-licensed JavaScript UNO bridge.
Source: https://github.com/allotropia/zetajs
Pinned package: https://registry.npmjs.org/zetajs/-/zetajs-1.2.0.tgz
See zetajs-1.2.0.txt. Viewer supplies its own isolated conversion page and
does not modify the bridge or Office engine.
