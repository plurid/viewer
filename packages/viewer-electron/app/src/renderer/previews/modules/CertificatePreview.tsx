import { useEffect, useId, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { PreviewContext } from '../contracts';
import type {
  CertificateFacts,
  KeyBlock,
  KeyDescription,
  OpenPGPFacts,
  OpenPGPKind,
} from '../../../domain/previews/keys/certificates';
import {
  certificateStatus,
  commonName,
  holdsPrivateKey,
  keyLimits,
  nameText,
} from '../../../domain/previews/keys/certificates';
import { errorMessage } from '../../../domain/errors';
import { Empty, Loading } from '../../ui/primitives';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { choosePreview, previewModules } from '../registry';
import { preloadPreviewModule } from '../module-loading';
import { dateText, useInspected } from '../useInspected';
import TextPreview from './TextPreview';
import './inspection.css';

type Fact = readonly [label: string, value: ReactNode];

function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="inspection-facts">
      {facts.map(
        ([label, value]) =>
          value !== undefined &&
          value !== '' && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
      )}
    </dl>
  );
}
const mono = (text: string | undefined) =>
  text ? <span className="inspection-mono">{text}</span> : undefined;
const keyType = (key: KeyDescription) => (key.curve ? `${key.type} ${key.curve}` : key.type);
const keySize = (key: KeyDescription | undefined) =>
  key?.bits ? `${key.bits.toLocaleString()} bits` : undefined;
/** "CERTIFICATE REQUEST" as "Certificate request". */
const labelText = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();
const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
const privateNote = 'This file holds a private key. Viewer shows only its type and size.';
/** Scrolls to another card of the same file. */
function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="inspection-link"
      onClick={() => document.getElementById(to)?.scrollIntoView({ block: 'start' })}
    >
      {children}
    </button>
  );
}

function CertificateCard({
  certificate,
  id,
  issuer,
  now,
}: {
  certificate: CertificateFacts;
  id: string;
  /** The card of the certificate in the same file that issued this one. */
  issuer?: string;
  now: number;
}) {
  const status = certificateStatus(certificate, now);
  return (
    <article className="inspection-card" id={id} aria-label={commonName(certificate.subject)}>
      <header>
        <h3>{commonName(certificate.subject)}</h3>
        <span className={status === 'valid' ? 'inspection-badge' : 'inspection-badge warning'}>
          {status === 'valid' ? 'Valid' : status === 'expired' ? 'Expired' : 'Not yet valid'}
        </span>
        {certificate.ca && <span className="inspection-badge">Certificate authority</span>}
        {certificate.selfSigned && <span className="inspection-badge">Self-signed</span>}
      </header>
      {status === 'expired' && (
        <p className="inspection-warning">Expired on {dateText(certificate.validTo)}.</p>
      )}
      {status === 'not-yet-valid' && (
        <p className="inspection-warning">Not valid until {dateText(certificate.validFrom)}.</p>
      )}
      <Facts
        facts={[
          ['Subject', nameText(certificate.subject)],
          [
            'Issuer',
            <>
              {nameText(certificate.issuer)}
              {issuer && (
                <>
                  {' '}
                  <CardLink to={issuer}>In this file</CardLink>
                </>
              )}
            </>,
          ],
          ['Serial number', mono(certificate.serial)],
          ['Valid from', dateText(certificate.validFrom)],
          ['Valid until', dateText(certificate.validTo)],
          ['Key', keyType(certificate.key)],
          ['Key size', keySize(certificate.key)],
          [
            'Alternative names',
            certificate.names.length ? (
              <ul>
                {certificate.names.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : undefined,
          ],
          ['Extended key usage', certificate.usages.join(', ')],
          ['SHA-256', mono(certificate.sha256)],
          ['SHA-1', mono(certificate.sha1)],
        ]}
      />
    </article>
  );
}

const openPGPTitles: Readonly<Record<OpenPGPKind, string>> = {
  'public-key': 'OpenPGP public key',
  'private-key': 'OpenPGP private key',
  signature: 'OpenPGP signature',
  message: 'OpenPGP message',
  'signed-message': 'Signed message',
};
function OpenPGPCard({ openpgp }: { openpgp: OpenPGPFacts }) {
  const secret = openpgp.kind === 'private-key';
  return (
    <article className="inspection-card" aria-label={openPGPTitles[openpgp.kind]}>
      <header>
        <h3>{openPGPTitles[openpgp.kind]}</h3>
      </header>
      {secret && <p className="inspection-note">{privateNote}</p>}
      {openpgp.users.length > 0 && (
        <Facts
          facts={[
            [
              openpgp.users.length === 1 ? 'User ID' : 'User IDs',
              <ul>
                {openpgp.users.map((user) => (
                  <li key={user}>{user}</li>
                ))}
              </ul>,
            ],
          ]}
        />
      )}
      {openpgp.keys.map((key, index) => (
        <section key={index}>
          <h4>{key.role === 'primary' ? 'Primary key' : 'Subkey'}</h4>
          <Facts
            facts={[
              ['Type', keyType(key.key)],
              ['Size', keySize(key.key)],
              ['Created', dateText(key.created)],
              ['Expires', dateText(key.expires)],
              ['Fingerprint', mono(key.fingerprint?.toUpperCase())],
            ]}
          />
        </section>
      ))}
      {(openpgp.signer || openpgp.recipients.length > 0) && (
        <Facts
          facts={[
            ['Signed by', mono(openpgp.signer?.toUpperCase())],
            ['Signed', dateText(openpgp.signed)],
            [
              'Encrypted for',
              openpgp.recipients
                .map((recipient) =>
                  recipient === 'passphrase' ? 'A passphrase' : recipient.toUpperCase(),
                )
                .join(', '),
            ],
          ]}
        />
      )}
      {openpgp.kind === 'signed-message' && (
        <p className="inspection-note">The signed text follows; its signature is the next block.</p>
      )}
    </article>
  );
}

function BlockCard({
  block,
  id,
  issuer,
  now,
}: {
  block: KeyBlock;
  id: string;
  issuer?: string;
  now: number;
}) {
  switch (block.kind) {
    case 'certificate':
      return <CertificateCard certificate={block.certificate} id={id} issuer={issuer} now={now} />;
    case 'private-key':
      return (
        <article className="inspection-card" aria-label="Private key">
          <header>
            <h3>Private key</h3>
            {block.encrypted && <span className="inspection-badge">Protected by a passphrase</span>}
          </header>
          <p className="inspection-note">{privateNote}</p>
          <Facts
            facts={[
              ['Type', block.key ? keyType(block.key) : 'Not readable'],
              ['Size', keySize(block.key)],
            ]}
          />
        </article>
      );
    case 'public-key':
      return (
        <article className="inspection-card" aria-label="Public key">
          <header>
            <h3>Public key</h3>
          </header>
          <Facts
            facts={[
              ['Type', keyType(block.key)],
              ['Size', keySize(block.key)],
              ['SHA-256', mono(block.sha256)],
            ]}
          />
        </article>
      );
    case 'openpgp':
      return <OpenPGPCard openpgp={block.openpgp} />;
    case 'unread':
      return (
        <article className="inspection-card" aria-label={labelText(block.label)}>
          <header>
            <h3>{labelText(block.label)}</h3>
          </header>
          <p className="inspection-note">{block.reason}</p>
          {block.text && <pre className="inspection-text">{block.text}</pre>}
        </article>
      );
  }
}

/** Each chain the file's certificates form, from a certificate that issued none to its root. */
function chains(blocks: readonly KeyBlock[]): number[][] {
  const issuedBy = (index: number) => {
    const block = blocks[index];
    return block?.kind === 'certificate' ? block.certificate.issuedBy : undefined;
  };
  const certificates = blocks.flatMap((block, index) =>
    block.kind === 'certificate' ? [index] : [],
  );
  const issuers = new Set(certificates.map(issuedBy));
  return certificates
    .filter((index) => !issuers.has(index))
    .map((leaf) => {
      const chain = [leaf];
      for (
        let next = issuedBy(leaf);
        next !== undefined && !chain.includes(next);
        next = issuedBy(next)
      )
        chain.push(next);
      return chain;
    });
}
const certificateOf = (blocks: readonly KeyBlock[], index: number) => {
  const block = blocks[index];
  return block?.kind === 'certificate' ? block.certificate : undefined;
};

/** A file that is not PEM, armor or DER, shown by the preview it would otherwise have. */
function HandedOn(context: PreviewContext) {
  const [Preview, setPreview] = useState<ComponentType<PreviewContext>>();
  const [failed, setFailed] = useState('');
  const { entry } = context.resource;
  useEffect(() => {
    let live = true;
    const others = previewModules.filter(
      (module) => module.id !== 'certificate' && module.id !== 'embedded',
    );
    preloadPreviewModule(choosePreview(entry, others)).then(
      (value) => {
        if (live) setPreview(() => value);
      },
      (error: unknown) => {
        if (live) setFailed(errorMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, [entry]);
  if (failed) return <Empty icon="warning" title="Preview unavailable" detail={failed} />;
  return Preview ? <Preview {...context} /> : <Loading />;
}

/**
 * Certificates and keys: each certificate's subject, issuer, validity, key and fingerprints, the
 * chain they form, and a private key by its type and size only. A file holding a private key
 * offers neither its source nor its bytes.
 */
export default function CertificatePreview(context: PreviewContext) {
  const inspection = useInspected(context, 'keys');
  const [source, setSource] = usePreviewState(context, 'text.source', false);
  const anchor = useId();
  const [now] = useState(() => Date.now());
  const file = inspection.status === 'ready' ? inspection.file : undefined;
  const secret = !!file && holdsPrivateKey(file);
  const pem = file?.encoding === 'pem' && file.blocks.length > 0;
  const textual = pem && !secret;
  // a DER file Viewer could not read may be a private key's
  const bytes =
    !!file && !secret && file.blocks.every((block) => block.kind !== 'unread' || !!block.text);
  const showHex = context.showHex;
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'view-source',
          label: source ? 'Show certificates' : 'Show source',
          aliases: ['vs'],
          available: textual,
          run: () => setSource((value) => !value),
        },
        {
          id: 'hex',
          label: 'Show as hex',
          aliases: ['hex', 'bytes'],
          available: bytes && !!showHex,
          run: () => showHex?.(),
        },
      ],
      [source, textual, bytes, showHex, setSource],
    ),
  );
  if (inspection.status === 'loading') return <Loading label="Reading certificate…" />;
  if (inspection.status === 'failed')
    return <Empty icon="warning" title="The file could not be read" detail={inspection.message} />;
  const read = inspection.file;
  if (read.encoding === 'text') return <TextPreview {...context} />;
  if (read.encoding === 'other') return <HandedOn {...context} />;
  const counts = new Map<string, number>();
  for (const block of read.blocks) {
    const name =
      block.kind === 'certificate'
        ? 'certificate'
        : block.kind === 'private-key' ||
            (block.kind === 'openpgp' && block.openpgp.kind === 'private-key')
          ? 'private key'
          : block.kind === 'public-key' ||
              (block.kind === 'openpgp' && block.openpgp.kind === 'public-key')
            ? 'public key'
            : 'other block';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const summary = [...counts]
    .map(([name, count]) =>
      plural(count, name, name === 'other block' ? 'other blocks' : `${name}s`),
    )
    .join(' · ');
  const found = chains(read.blocks).filter((chain) => chain.length > 1);
  const cardID = (index: number) => `${anchor}-${index}`;
  return (
    <div className="inspection-viewer">
      <PreviewToolbar context={context}>
        {textual && (
          <>
            <button
              type="button"
              aria-pressed={!source}
              className={source ? '' : 'selected'}
              onClick={() => setSource(false)}
            >
              Certificates
            </button>
            <button
              type="button"
              aria-pressed={source}
              className={source ? 'selected' : ''}
              onClick={() => setSource(true)}
            >
              Source
            </button>
          </>
        )}
        {bytes && showHex && (
          <button type="button" onClick={showHex}>
            Show as hex
          </button>
        )}
        <span className="toolbar-spacer" />
        <span className="muted tabular">{summary}</span>
      </PreviewToolbar>
      {textual && source ? (
        <TextPreview {...context} commands={undefined} />
      ) : (
        <div className="inspection-scroll">
          {read.truncated && (
            <p className="inspection-note">
              Showing the first {keyLimits.blocks.toLocaleString()} blocks.
            </p>
          )}
          {found.map((chain) => {
            const last = certificateOf(read.blocks, chain.at(-1)!);
            return (
              <section key={chain[0]} aria-label="Certificate chain">
                <ol className="inspection-chain">
                  {chain.map((index) => (
                    <li key={index}>
                      <CardLink to={cardID(index)}>
                        {commonName(certificateOf(read.blocks, index)!.subject)}
                      </CardLink>
                    </li>
                  ))}
                  {last && !last.selfSigned && (
                    <li className="muted">{commonName(last.issuer)}, not in this file</li>
                  )}
                </ol>
              </section>
            );
          })}
          {read.blocks.map((block, index) => {
            const issuedBy = block.kind === 'certificate' ? block.certificate.issuedBy : undefined;
            return (
              <BlockCard
                key={index}
                block={block}
                id={cardID(index)}
                issuer={issuedBy === undefined ? undefined : cardID(issuedBy)}
                now={now}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
