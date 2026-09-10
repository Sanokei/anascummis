import { useEffect, useState } from 'react';

/**
 * Policy pages.
 *
 * The storage table is fetched from the Worker rather than restated here, so
 * the page cannot describe behaviour the code does not implement. If a
 * category is added to the enforcement, it appears here automatically.
 */

interface CollectionCategory {
  category: string;
  label: string;
  stores: string;
  doesNotStore: string;
  why: string;
  optOut: string;
  retention: string;
}

interface CollectionDisclosure {
  categories: CollectionCategory[];
  audio: { stores: string; transcripts: string; note: string };
  current: { identity: string; optionalCollection: boolean; conversationStorage: boolean };
  policyVersion: string;
}

export type PolicyPage = 'privacy' | 'terms' | 'cookies';

export function Policies({ page, onClose }: { page: PolicyPage; onClose: () => void }) {
  const [disclosure, setDisclosure] = useState<CollectionDisclosure | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/collection', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<CollectionDisclosure>) : null))
      .then((data) => {
        if (!cancelled) setDisclosure(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-ground fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <button
          type="button"
          onClick={onClose}
          className="text-ink-dim hover:text-ink mb-8 font-mono text-[0.75rem] tracking-wide uppercase"
        >
          &larr; Back to the conversation
        </button>

        {page === 'privacy' && <Privacy disclosure={disclosure} />}
        {page === 'terms' && <Terms />}
        {page === 'cookies' && <Cookies disclosure={disclosure} />}

        <footer className="border-hairline text-ink-faint mt-12 border-t pt-6 text-[0.8rem]">
          <p>
            This describes what the software does. It is not legal advice and it has not been through
            legal review. Before this is offered publicly, a lawyer needs to read it against the
            deployment it actually runs on.
          </p>
          {disclosure && <p className="mt-2 font-mono">Policy version {disclosure.policyVersion}</p>}
        </footer>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-6 text-2xl">{children}</h1>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-signal mb-2 font-mono text-[0.8rem] tracking-wide uppercase">{title}</h2>
      <div className="flex flex-col gap-3 text-[0.95rem]">{children}</div>
    </section>
  );
}

function Privacy({ disclosure }: { disclosure: CollectionDisclosure | null }) {
  return (
    <article>
      <Heading>Privacy</Heading>

      <Section title="Who runs this">
        <p>
          This deployment is run by whoever operates it. No company or legal entity is named here,
          because inventing one would be worse than leaving it blank. Before a public launch, the
          operator has to put their real contact details in this section.
        </p>
      </Section>

      <Section title="What is stored">
        <p>
          The table below is read from the running Worker, not written by hand, so it describes what
          the code actually does.
        </p>
        {disclosure ? (
          <div className="mt-2 flex flex-col gap-4">
            {disclosure.categories.map((entry) => (
              <div key={entry.label} className="border-hairline border-l-2 pl-4">
                <h3 className="mb-1">
                  {entry.label}
                  <span className="text-ink-faint ml-2 font-mono text-[0.7rem] uppercase">
                    {entry.category}
                  </span>
                </h3>
                <dl className="text-[0.88rem]">
                  <Row term="Stores" value={entry.stores} />
                  <Row term="Does not store" value={entry.doesNotStore} />
                  <Row term="Why" value={entry.why} />
                  <Row term="Can you refuse" value={entry.optOut} />
                  <Row term="Kept for" value={entry.retention} />
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink-faint">Loading the current storage table.</p>
        )}
      </Section>

      <Section title="Audio and transcription">
        <p>{disclosure?.audio.stores ?? 'Audio is not retained.'}</p>
        <p>{disclosure?.audio.transcripts ?? ''}</p>
        <p className="text-ink-dim">{disclosure?.audio.note ?? ''}</p>
        <p>
          Your microphone only opens when you switch it on and the browser grants permission. Turning
          it off releases the device rather than muting it. Speech recognition gets things wrong, and
          a wrong transcript can change what a sentence means.
        </p>
      </Section>

      <Section title="Who else sees your data">
        <p>
          Answering you means sending your text, and any image you attach, to the configured model
          provider. Speaking means sending the audio to the transcription provider. Searching sends
          your query to the search provider. Reading a page fetches it from that site, which sees the
          request.
        </p>
        <p>
          Which providers are configured is shown in the interface under the model and speech
          readouts, because it changes per deployment. Their own terms govern what they do with what
          they receive.
        </p>
      </Section>

      <Section title="Guests and accounts">
        <p>
          As a guest, your conversation lives in short-lived storage that expires, and no long-term
          record is written. That is not the same as nothing touching a server: your words are
          processed to answer you, and cached briefly while the session is alive.
        </p>
        <p>
          Signing in creates one row for your account. Conversation history and memory are still off
          until you switch them on. Signing in does not import your guest conversation; you are asked
          whether to keep it.
        </p>
      </Section>

      <Section title="Your controls">
        <p>
          Memory can be exported and deleted from the account panel. Deleting removes the stored
          content and its index. Refusing optional collection deletes what was already collected
          under it rather than only stopping new records.
        </p>
        <p>
          Deleting a conversation does not undo anything that already happened outside this app. If a
          message was sent or a resource was created, that stays done.
        </p>
      </Section>
    </article>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="text-ink-faint w-32 shrink-0 font-mono text-[0.7rem] uppercase">{term}</dt>
      <dd className="text-ink-dim">{value}</dd>
    </div>
  );
}

function Terms() {
  return (
    <article>
      <Heading>Terms</Heading>

      <Section title="What this is">
        <p>
          Anascummis is a conversational assistant. It can search, read pages, keep notes you ask it
          to keep, and run bounded procedures you authorise. It is provided as-is, with no warranty
          and no service guarantee.
        </p>
      </Section>

      <Section title="The voice feature">
        <p>
          You can talk to it. Doing so requires two separate things: accepting these terms, and
          granting your browser&rsquo;s microphone permission. Accepting terms does not grant the
          permission, and granting the permission does not switch capture on.
        </p>
        <p>
          Capture starts only when you press the microphone control and stops when you press it
          again. While it is on, audio is sent to the transcription provider so it can become text.
          Nothing you say authorises an action on its own: an action needs an explicit confirmation
          for anything that has an effect.
        </p>
        <p>
          Saying the assistant&rsquo;s name does not start it listening. The name is used to work out
          who a sentence is about, never as a trigger.
        </p>
      </Section>

      <Section title="What it can get wrong">
        <p>
          Speech recognition mishears. Generated code can be incorrect. Retrieved pages can be wrong
          or deliberately misleading. Check anything that matters before relying on it.
        </p>
        <p>
          Stopping the assistant, or restoring an earlier point in a conversation, does not reverse an
          action that already completed somewhere else. Where an outcome is unknown, it says so
          rather than guessing.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use it to break the law, to attack systems you do not control, or to impersonate
          anyone. Do not feed it credentials belonging to other people. The operator can withdraw
          access.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          What you type and say stays yours. Storing it is your choice, made through the memory
          setting, and you can export or delete it.
        </p>
      </Section>
    </article>
  );
}

function Cookies({ disclosure }: { disclosure: CollectionDisclosure | null }) {
  return (
    <article>
      <Heading>Cookies and local storage</Heading>

      <Section title="Strictly necessary">
        <p>
          One cookie holds your session identifier, signed so it cannot be forged. It is what keeps
          you signed in and what makes cross-site request forgery protection work. Without it the app
          cannot function, so it is not offered as a toggle that would falsely promise otherwise.
        </p>
        <p>
          A small amount of browser storage holds your accessibility settings, so text size and
          contrast survive a reload without needing an account.
        </p>
      </Section>

      <Section title="Optional">
        <p>
          Optional collection is off until you accept it. Nothing optional is loaded before you
          choose, and nothing is loaded after you refuse. Refusing is one click, in the same place
          and the same size as accepting.
        </p>
        {disclosure && (
          <p className="text-ink-dim">
            Right now, optional collection is{' '}
            <strong className={disclosure.current.optionalCollection ? 'text-signal' : ''}>
              {disclosure.current.optionalCollection ? 'on' : 'off'}
            </strong>{' '}
            for you, and conversation storage is{' '}
            <strong className={disclosure.current.conversationStorage ? 'text-signal' : ''}>
              {disclosure.current.conversationStorage ? 'on' : 'off'}
            </strong>
            .
          </p>
        )}
      </Section>

      <Section title="Changing your mind">
        <p>
          The cookie panel stays reachable from the footer after you dismiss it. Withdrawing consent
          stops the optional processing and deletes the records kept under it.
        </p>
        <p>
          These rules apply to comparable browser storage, not only to cookies. Your choice itself is
          stored minimally and is not used to recognise you.
        </p>
      </Section>
    </article>
  );
}
