import { useEffect, useState } from 'react';
import type { JobView } from '@shared/types';
import { api } from '../api';

/**
 * Secondary views. The product is a conversation, not an agent console, so
 * these are inspectable rather than prominent: failures, permission requests,
 * expiry and conflicts are visible states here rather than hidden logs.
 */

export type InspectorTab = 'status' | 'capabilities' | 'skills' | 'receipts' | 'account';

interface InspectorProps {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  jobs: JobView[];
  capabilities: {
    model: { provider: string; model: string; reason: string };
    speech: { provider: string; model: string };
    vision: { provider: string; model: string; reason: string };
    cloudflareConnect: boolean;
  };
  identity: { kind: string; email?: string | null; displayName?: string | null };
  memoryEnabled: boolean;
  providers: { name: string; displayName: string }[];
  onMemoryToggle: (enabled: boolean) => void;
  onSignOut: () => void;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'skills', label: 'Skills' },
  { id: 'receipts', label: 'Actions' },
  { id: 'account', label: 'Account' },
];

export function Inspector(props: InspectorProps) {
  return (
    <aside className="border-hairline flex h-full flex-col border-l">
      <nav className="border-hairline flex border-b" aria-label="Inspection views">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => props.onTab(tab.id)}
            aria-current={props.tab === tab.id ? 'page' : undefined}
            className={`flex-1 px-2 py-2.5 font-mono text-[0.68rem] tracking-wide uppercase transition-colors ${
              props.tab === tab.id
                ? 'text-signal border-signal border-b-2'
                : 'text-ink-faint hover:text-ink-dim border-b-2 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4 text-[0.85rem]">
        {props.tab === 'status' && <StatusView jobs={props.jobs} capabilities={props.capabilities} />}
        {props.tab === 'capabilities' && <CapabilitiesView />}
        {props.tab === 'skills' && <SkillsView />}
        {props.tab === 'receipts' && <ReceiptsView />}
        {props.tab === 'account' && (
          <AccountView
            identity={props.identity}
            memoryEnabled={props.memoryEnabled}
            providers={props.providers}
            onMemoryToggle={props.onMemoryToggle}
            onSignOut={props.onSignOut}
          />
        )}
      </div>
    </aside>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-ink-faint mt-4 mb-2 font-mono text-[0.68rem] tracking-wide uppercase first:mt-0">
      {children}
    </h3>
  );
}

function StatusView({
  jobs,
  capabilities,
}: {
  jobs: JobView[];
  capabilities: InspectorProps['capabilities'];
}) {
  return (
    <div>
      <Label>Providers in use</Label>
      <dl className="flex flex-col gap-2">
        <ProviderRow
          name="Model"
          provider={capabilities.model.provider}
          detail={capabilities.model.model}
          note={capabilities.model.reason}
        />
        <ProviderRow
          name="Speech"
          provider={capabilities.speech.provider}
          detail={capabilities.speech.model}
        />
        <ProviderRow
          name="Vision"
          provider={capabilities.vision.provider}
          detail={capabilities.vision.model}
          note={capabilities.vision.reason}
        />
      </dl>

      <Label>Work in flight</Label>
      {jobs.length === 0 ? (
        <p className="text-ink-faint">Nothing running.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id} className="border-hairline border-l-2 pl-3">
              <p className="flex items-baseline justify-between gap-2">
                <span>{job.label}</span>
                <span
                  className={`font-mono text-[0.68rem] uppercase ${
                    job.state === 'failed'
                      ? 'text-caution'
                      : job.state === 'done'
                        ? 'text-affirm'
                        : 'text-ink-faint'
                  }`}
                >
                  {job.state}
                </span>
              </p>
              {job.speculative && (
                <p className="text-ink-faint text-[0.75rem]">
                  Speculative. It will be dropped if you change direction.
                </p>
              )}
              {job.detail && <p className="text-ink-faint text-[0.75rem]">{job.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderRow({
  name,
  provider,
  detail,
  note,
}: {
  name: string;
  provider: string;
  detail: string;
  note?: string;
}) {
  const missing = provider === 'none';
  return (
    <div className="border-hairline border-l-2 pl-3">
      <dt className="flex items-baseline justify-between gap-2">
        <span>{name}</span>
        <span className={`font-mono text-[0.68rem] uppercase ${missing ? 'text-caution' : 'text-affirm'}`}>
          {missing ? 'unavailable' : provider}
        </span>
      </dt>
      {detail && <dd className="text-ink-faint font-mono text-[0.72rem]">{detail}</dd>}
      {note && missing && <dd className="text-ink-dim mt-0.5 text-[0.78rem]">{note}</dd>}
    </div>
  );
}

function CapabilitiesView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .capabilities()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-caution">{error}</p>;
  if (!data) return <p className="text-ink-faint">Loading.</p>;

  return (
    <div>
      <Label>Installed</Label>
      <ul className="flex flex-col gap-3">
        {data.capabilities.map((cap) => (
          <li key={`${cap.id}@${cap.version}`} className="border-hairline border-l-2 pl-3">
            <p className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[0.78rem]">{cap.id}</span>
              <span className="text-ink-faint font-mono text-[0.68rem]">{cap.version}</span>
            </p>
            <p className="text-ink-dim text-[0.8rem]">{cap.summary}</p>
            <p className="text-ink-faint mt-0.5 font-mono text-[0.68rem]">
              {cap.kind} · risk {cap.risk}
              {cap.requiresConfirmation && ' · confirms'}
              {cap.permissions.length > 0 && ` · ${cap.permissions.join(' ')}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillsView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.skills>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .skills()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-caution">{error}</p>;
  if (!data) return <p className="text-ink-faint">Loading.</p>;

  return (
    <div>
      <Label>Available to you</Label>
      {data.skills.length === 0 ? (
        <p className="text-ink-faint">
          No skills are installed. Conversation, search and page reading work without any.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.skills.map((skill) => (
            <li key={`${skill.qualifiedName}@${skill.revision}`} className="border-hairline border-l-2 pl-3">
              <p className="flex items-baseline justify-between gap-2">
                <span>{skill.title}</span>
                <span className="text-ink-faint font-mono text-[0.68rem] uppercase">{skill.trust}</span>
              </p>
              <p className="text-ink-dim text-[0.8rem]">{skill.description}</p>
              <p className="text-ink-faint mt-0.5 font-mono text-[0.68rem]">
                {skill.origin} · {skill.revision} · {skill.invocation} · {skill.license}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Label>Recent runs</Label>
      {data.recentRuns.length === 0 ? (
        <p className="text-ink-faint">Nothing recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.recentRuns.map((run) => (
            <li key={run.id} className="font-mono text-[0.72rem]">
              <span className="text-ink-dim">{run.skillName}</span>{' '}
              <span className={run.outcome === 'completed' ? 'text-affirm' : 'text-caution'}>
                {run.outcome}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReceiptsView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.receipts>> | null>(null);

  useEffect(() => {
    void api.receipts().then(setData).catch(() => undefined);
  }, []);

  if (!data) return <p className="text-ink-faint">Loading.</p>;
  if (data.receipts.length === 0) {
    return <p className="text-ink-faint">No actions with lasting effects have been dispatched.</p>;
  }

  return (
    <div>
      <Label>Action records</Label>
      <p className="text-ink-faint mb-3 text-[0.78rem]">
        Intent is recorded before an action runs, so one that never reported back shows as unknown
        rather than disappearing.
      </p>
      <ul className="flex flex-col gap-2">
        {data.receipts.map((receipt) => (
          <li key={receipt.id} className="border-hairline border-l-2 pl-3">
            <p className="flex items-baseline justify-between gap-2 font-mono text-[0.75rem]">
              <span>{receipt.capability_id}</span>
              <span
                className={
                  receipt.outcome === 'completed'
                    ? 'text-affirm'
                    : receipt.outcome === 'unknown'
                      ? 'text-signal'
                      : 'text-caution'
                }
              >
                {receipt.outcome}
              </span>
            </p>
            {receipt.summary && <p className="text-ink-faint text-[0.75rem]">{receipt.summary}</p>}
            {receipt.outcome === 'unknown' && (
              <p className="text-signal text-[0.75rem]">
                This needs reconciling before it is retried.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccountView({
  identity,
  memoryEnabled,
  providers,
  onMemoryToggle,
  onSignOut,
}: {
  identity: InspectorProps['identity'];
  memoryEnabled: boolean;
  providers: { name: string; displayName: string }[];
  onMemoryToggle: (enabled: boolean) => void;
  onSignOut: () => void;
}) {
  const signedIn = identity.kind === 'user';

  return (
    <div>
      <Label>Identity</Label>
      {signedIn ? (
        <>
          <p>{identity.displayName ?? identity.email ?? 'Signed in'}</p>
          <button
            type="button"
            onClick={onSignOut}
            className="border-hairline hover:border-hairline-bright mt-2 border px-3 py-1.5 text-[0.8rem]"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <p className="text-ink-dim">
            You are a guest. This conversation expires and leaves no long-term record.
          </p>
          {providers.length === 0 ? (
            <p className="text-ink-faint mt-2 text-[0.8rem]">
              No sign-in provider is configured on this deployment, so guest use is the only mode.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {providers.map((provider) => (
                <a
                  key={provider.name}
                  href={`/auth/${provider.name}/start`}
                  className="border-hairline hover:border-hairline-bright border px-3 py-1.5 text-[0.8rem]"
                >
                  Continue with {provider.displayName}
                </a>
              ))}
            </div>
          )}
        </>
      )}

      <Label>Memory</Label>
      {signedIn ? (
        <>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(e) => onMemoryToggle(e.target.checked)}
              className="accent-signal mt-1"
            />
            <span>
              <span className="block">Keep conversation and memory</span>
              <span className="text-ink-faint block text-[0.78rem]">
                Off by default. Signing in does not switch it on.
              </span>
            </span>
          </label>
          <div className="mt-3 flex gap-2">
            <a
              href="/api/memory/export"
              className="border-hairline hover:border-hairline-bright border px-3 py-1.5 text-[0.8rem]"
            >
              Export
            </a>
            <button
              type="button"
              onClick={() => {
                if (confirm('Delete all stored memories? This cannot be undone.')) {
                  void api.deleteMemory().then(() => location.reload());
                }
              }}
              className="border-caution text-caution hover:bg-caution/10 border px-3 py-1.5 text-[0.8rem]"
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <p className="text-ink-dim">
          Durable memory needs an account. Guests have none, which is why nothing here persists.
        </p>
      )}
    </div>
  );
}
