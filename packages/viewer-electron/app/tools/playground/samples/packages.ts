import type { Sample } from '../types';
import { sample, zip } from './documents';

const manifest = 'Manifest-Version: 1.0\nCreated-By: Viewer playground\n';
const readme = 'Field notes: a sample package. It holds no code that runs.\n';

/** ZIP packages under their platforms' names, each with the layout its tools expect and no code. */
const packages: Record<string, [description: string, entries: Record<string, string>]> = {
  jar: ['Java archive', { 'META-INF/MANIFEST.MF': manifest, 'notes/README.txt': readme }],
  war: [
    'Java web application',
    {
      'META-INF/MANIFEST.MF': manifest,
      'WEB-INF/web.xml': '<web-app/>\n',
      'index.html': '<h1>Field notes</h1>\n',
    },
  ],
  ear: [
    'Java enterprise application',
    { 'META-INF/MANIFEST.MF': manifest, 'META-INF/application.xml': '<application/>\n' },
  ],
  apk: [
    'Android package',
    {
      'AndroidManifest.xml': '<manifest package="org.example.fieldnotes"/>\n',
      'res/values/strings.xml': '<resources><string name="app">Field notes</string></resources>\n',
    },
  ],
  aab: [
    'Android App Bundle',
    {
      'base/manifest/AndroidManifest.xml': '<manifest package="org.example.fieldnotes"/>\n',
      'BundleConfig.pb': '',
    },
  ],
  ipa: [
    'iOS app archive',
    { 'Payload/Field Notes.app/Info.plist': '<plist version="1.0"><dict/></plist>\n' },
  ],
  whl: [
    'Python wheel',
    {
      'fieldnotes/__init__.py': '"""Field notes."""\n',
      'fieldnotes-1.0.dist-info/METADATA':
        'Metadata-Version: 2.1\nName: fieldnotes\nVersion: 1.0\n',
      'fieldnotes-1.0.dist-info/WHEEL':
        'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
    },
  ],
  nupkg: [
    'NuGet package',
    {
      'FieldNotes.nuspec':
        '<package><metadata><id>FieldNotes</id><version>1.0.0</version></metadata></package>\n',
    },
  ],
  vsix: [
    'Visual Studio Code extension',
    {
      'extension.vsixmanifest': '<PackageManifest Version="2.0.0"/>\n',
      'extension/package.json': '{ "name": "field-notes", "version": "1.0.0" }\n',
    },
  ],
  xpi: [
    'Firefox add-on',
    { 'manifest.json': '{ "manifest_version": 2, "name": "Field notes", "version": "1.0" }\n' },
  ],
  kmz: [
    'Google Earth places',
    {
      'doc.kml':
        '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Picnic spot</name><Point><coordinates>2.3522,48.8566,0</coordinates></Point></Placemark></kml>\n',
    },
  ],
  cbz: [
    'Comic book',
    {
      '001.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#81b7cf"/></svg>\n',
      '002.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#d7a56b"/></svg>\n',
    },
  ],
};

export function packageSamples(): Sample[] {
  return Object.entries(packages).map(([extension, [description, entries]]) =>
    sample(
      `previews/archives/Field notes.${extension}`,
      [extension],
      'Archive listing',
      `${description}: a ZIP with the layout its tools expect.`,
      zip(entries),
    ),
  );
}
