import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box, Plus, Eye, EyeOff, Copy, Check, Trash2, KeyRound, History, RotateCcw,
  GitCompare, ScrollText, LogOut, RefreshCw, Terminal, X, Shield
} from 'lucide-react';
import { api } from './api.js';

function Login({ onOk }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await api.login(pw); onOk(); } catch (x) { setErr(x.message); }
        }}>
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-xl p-2.5"><Box className="text-emerald-400" size={22} /></div>
          <div>
            <h1 className="text-lg font-semibold">Secretbox</h1>
            <p className="text-xs text-zinc-500">Team secrets. Your server. One price.</p>
          </div>
        </div>
        <input type="password" placeholder="admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button className="btn-primary w-full justify-center"><Shield size={15} /> Sign in</button>
      </motion.form>
    </div>
  );
}

function SecretRow({ envId, s, onChanged, say }) {
  const [value, setValue] = useState(null); // revealed value
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [hist, setHist] = useState(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    if (value !== null) return setValue(null);
    const r = await api.reveal(envId, s.key);
    setValue(r.value);
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <KeyRound size={14} className="text-emerald-400 shrink-0" />
        <span className="mono text-sm font-medium w-56 truncate">{s.key}</span>
        <span className="mono text-sm text-zinc-400 flex-1 truncate">
          {editing
            ? <input className="mono" value={editVal} onChange={(e) => setEditVal(e.target.value)} autoFocus />
            : value !== null ? value : '••••••••••••'}
        </span>
        <span className="text-[10px] text-zinc-600">v{s.version}</span>
        {!editing && (
          <>
            <button className="btn-ghost px-2! py-1!" title={value !== null ? 'Hide' : 'Reveal (audit-logged)'} onClick={reveal}>
              {value !== null ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button className="btn-ghost px-2! py-1!" title="Copy value" onClick={async () => {
              const r = value !== null ? { value } : await api.reveal(envId, s.key);
              await navigator.clipboard.writeText(r.value);
              setCopied(true); setTimeout(() => setCopied(false), 1200);
            }}>{copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}</button>
            <button className="btn-ghost px-2! py-1!" title="Edit" onClick={async () => {
              const r = value !== null ? { value } : await api.reveal(envId, s.key);
              setEditVal(r.value); setEditing(true);
            }}><RefreshCw size={13} /></button>
            <button className="btn-ghost px-2! py-1!" title="History" onClick={async () => {
              setHist(hist ? null : await api.history(envId, s.key));
            }}><History size={13} /></button>
            <button className="btn-danger px-2! py-1!" title="Delete" onClick={async () => {
              if (!confirm(`Delete ${s.key}?`)) return;
              await api.deleteSecret(envId, s.key);
              onChanged();
            }}><Trash2 size={13} /></button>
          </>
        )}
        {editing && (
          <>
            <button className="btn-primary px-2! py-1!" onClick={async () => {
              await api.setSecret(envId, s.key, editVal);
              setEditing(false); setValue(null); onChanged();
              say(`${s.key} updated → v${s.version + 1}`);
            }}><Check size={13} /></button>
            <button className="btn-ghost px-2! py-1!" onClick={() => setEditing(false)}><X size={13} /></button>
          </>
        )}
      </div>
      {hist && (
        <div className="mt-2 ml-7 space-y-1">
          {hist.map((h) => (
            <div key={h.version} className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="mono">v{h.version}</span>
              <span>{new Date(h.created_at).toLocaleString()}</span>
              <span>{h.created_by}</span>
              {h.is_current
                ? <span className="text-emerald-400">current</span>
                : <button className="text-zinc-400 hover:text-emerald-400 flex items-center gap-1" onClick={async () => {
                    await api.rollback(envId, s.key, h.version);
                    setHist(null); onChanged();
                    say(`${s.key} rolled back to v${h.version} (as new head)`);
                  }}><RotateCcw size={11} /> rollback</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState('loading');
  const [projects, setProjects] = useState([]);
  const [sel, setSel] = useState(null); // project
  const [envId, setEnvId] = useState(null);
  const [secrets, setSecrets] = useState([]);
  const [view, setView] = useState('secrets'); // secrets|diff|tokens|audit
  const [diff, setDiff] = useState({ a: 'dev', b: 'prod', rows: null });
  const [tokens, setTokens] = useState([]);
  const [newToken, setNewToken] = useState(null);
  const [audit, setAudit] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [toast, setToast] = useState('');

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = () => api.projects().then((ps) => {
    setProjects(ps);
    if (sel) {
      const p = ps.find((x) => x.id === sel.id);
      setSel(p || null);
    }
  });

  useEffect(() => {
    api.me().then(() => { setPhase('app'); load(); }).catch(() => setPhase('login'));
  }, []);

  useEffect(() => { if (envId) api.secrets(envId).then(setSecrets); }, [envId]);

  const env = useMemo(() => sel?.environments.find((e) => e.id === envId), [sel, envId]);

  function openProject(p) {
    setSel(p);
    setEnvId(p.environments[0]?.id || null);
    setView('secrets');
    setDiff({ a: p.environments[0]?.name || 'dev', b: p.environments[2]?.name || 'prod', rows: null });
  }

  const reloadSecrets = () => api.secrets(envId).then(setSecrets);

  if (phase === 'loading') return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="animate-spin text-zinc-600" /></div>;
  if (phase === 'login') return <Login onOk={() => { setPhase('app'); load(); }} />;

  return (
    <div className="min-h-screen max-w-5xl mx-auto p-6">
      <header className="flex items-center gap-3 mb-6">
        <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-xl p-2"><Box className="text-emerald-400" size={18} /></div>
        <h1 className="font-semibold cursor-pointer" onClick={() => setSel(null)}>Secretbox</h1>
        {sel && <span className="text-zinc-500 text-sm">/ {sel.name}</span>}
        <div className="flex-1" />
        <button className="btn-ghost" onClick={async () => { setAudit(await api.audit()); setSel(null); setView('audit'); }}><ScrollText size={14} /> Audit</button>
        <button className="btn-ghost" onClick={async () => { await api.logout(); setPhase('login'); }}><LogOut size={14} /></button>
      </header>

      {!sel && view !== 'audit' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm text-zinc-400">Projects</h2>
            <button className="btn-primary" onClick={async () => {
              const name = prompt('Project name:');
              if (name) { await api.createProject(name); load(); }
            }}><Plus size={15} /> New project</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {projects.map((p) => (
              <motion.div key={p.id} layout whileHover={{ y: -2 }}
                className="bg-zinc-900/60 border border-zinc-800 hover:border-emerald-700/50 rounded-xl p-5 cursor-pointer"
                onClick={() => openProject(p)}>
                <div className="font-medium mb-1">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.environments.map((e) => e.name).join(' · ')} — {p.secret_count} secrets</div>
              </motion.div>
            ))}
            {projects.length === 0 && <p className="text-zinc-500 text-sm col-span-2 text-center py-16">No projects yet. Create one — it gets dev / staging / prod environments automatically.</p>}
          </div>
        </>
      )}

      {view === 'audit' && !sel && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl divide-y divide-zinc-800/70 max-h-[70vh] overflow-y-auto">
          {audit.map((a) => (
            <div key={a.id} className="px-4 py-2 text-xs flex gap-3">
              <span className="text-zinc-500 w-36 shrink-0">{new Date(a.at).toLocaleString()}</span>
              <span className="text-emerald-300 w-32 shrink-0 truncate">{a.actor}</span>
              <span className="text-zinc-300">{a.action}</span>
              <span className="text-zinc-500 truncate">{[a.project_name, a.env_name, a.secret_key].filter(Boolean).join(' / ')}</span>
            </div>
          ))}
        </div>
      )}

      {sel && (
        <>
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {sel.environments.map((e) => (
              <button key={e.id}
                className={`px-3 py-1.5 rounded-lg text-sm border ${envId === e.id && view === 'secrets' ? 'bg-emerald-600/20 border-emerald-600 text-emerald-300' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                onClick={() => { setEnvId(e.id); setView('secrets'); }}>
                {e.name}
              </button>
            ))}
            <button className="btn-ghost px-2! py-1.5! text-xs!" onClick={async () => {
              const name = prompt('New environment name:');
              if (name) { await api.createEnv(sel.id, name); load(); }
            }}><Plus size={13} /></button>
            <div className="flex-1" />
            <button className={`btn-ghost ${view === 'diff' ? 'border-emerald-700!' : ''}`} onClick={() => setView('diff')}><GitCompare size={14} /> Diff</button>
            <button className={`btn-ghost ${view === 'tokens' ? 'border-emerald-700!' : ''}`} onClick={async () => { setTokens(await api.tokens(sel.id)); setView('tokens'); }}><Terminal size={14} /> Tokens & CLI</button>
          </div>

          {view === 'secrets' && env && (
            <>
              <form className="flex gap-2 mb-4" onSubmit={async (e) => {
                e.preventDefault();
                if (!newKey) return;
                try {
                  await api.setSecret(envId, newKey, newVal);
                  setNewKey(''); setNewVal('');
                  reloadSecrets(); load();
                  say('Secret encrypted & saved');
                } catch (x) { say(x.message); }
              }}>
                <input className="mono w-64!" placeholder="KEY_NAME" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())} />
                <input className="mono flex-1" placeholder="value" value={newVal} onChange={(e) => setNewVal(e.target.value)} />
                <button className="btn-primary"><Plus size={15} /> Set</button>
              </form>
              <div className="grid gap-2">
                {secrets.map((s) => <SecretRow key={s.key} envId={envId} s={s} onChanged={() => { reloadSecrets(); load(); }} say={say} />)}
                {secrets.length === 0 && <p className="text-zinc-500 text-sm text-center py-12">No secrets in <b>{env.name}</b> yet. Values are envelope-encrypted (AES-256-GCM) before they hit the database.</p>}
              </div>
            </>
          )}

          {view === 'diff' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <select className="w-40!" value={diff.a} onChange={(e) => setDiff({ ...diff, a: e.target.value })}>
                  {sel.environments.map((e) => <option key={e.id}>{e.name}</option>)}
                </select>
                <GitCompare size={16} className="text-zinc-500" />
                <select className="w-40!" value={diff.b} onChange={(e) => setDiff({ ...diff, b: e.target.value })}>
                  {sel.environments.map((e) => <option key={e.id}>{e.name}</option>)}
                </select>
                <button className="btn-primary" onClick={async () => setDiff({ ...diff, rows: await api.diff(sel.id, diff.a, diff.b) })}>Compare</button>
              </div>
              {diff.rows && (
                <div className="grid gap-1.5">
                  {diff.rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg px-4 py-2 text-sm">
                      <span className="mono flex-1">{r.key}</span>
                      {r.status === 'same' && <span className="text-zinc-500 text-xs">identical</span>}
                      {r.status === 'different' && <span className="text-amber-400 text-xs">different values</span>}
                      {r.status === 'only_a' && <span className="text-red-400 text-xs">missing in {diff.b}</span>}
                      {r.status === 'only_b' && <span className="text-red-400 text-xs">missing in {diff.a}</span>}
                    </div>
                  ))}
                  {diff.rows.length === 0 && <p className="text-zinc-500 text-sm">No keys in either environment.</p>}
                </div>
              )}
            </div>
          )}

          {view === 'tokens' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-sm text-zinc-400">Per-project API tokens (for the CLI / CI)</h3>
                <button className="btn-primary" onClick={async () => {
                  const name = prompt('Token name (e.g. "ci-deploy"):');
                  if (!name) return;
                  const scope = confirm('OK = read-only, Cancel = read-write') ? 'read' : 'readwrite';
                  const t = await api.createToken(sel.id, name, scope);
                  setNewToken(t);
                  setTokens(await api.tokens(sel.id));
                }}><Plus size={15} /> New token</button>
              </div>
              {newToken && (
                <div className="bg-emerald-950/40 border border-emerald-800 rounded-xl p-4 text-sm">
                  <p className="text-emerald-300 mb-2">Copy this token now — it is shown once and stored only as a hash:</p>
                  <div className="flex gap-2 items-center">
                    <code className="mono bg-zinc-900 rounded px-2 py-1 flex-1 overflow-x-auto">{newToken.token}</code>
                    <button className="btn-ghost px-2! py-1!" onClick={() => navigator.clipboard.writeText(newToken.token)}><Copy size={13} /></button>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                {tokens.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-sm">
                    <Terminal size={14} className="text-emerald-400" />
                    <span className="font-medium">{t.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${t.scope === 'readwrite' ? 'border-amber-700 text-amber-400' : 'border-zinc-700 text-zinc-400'}`}>{t.scope}</span>
                    <span className="text-xs text-zinc-500 flex-1">last used {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}</span>
                    <button className="btn-danger px-2! py-1!" onClick={async () => { await api.deleteToken(t.id); setTokens(await api.tokens(sel.id)); }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 space-y-2">
                <p className="text-zinc-300 font-medium">CLI usage</p>
                <pre className="mono bg-zinc-950 rounded-lg p-3 overflow-x-auto">{`export SECRETBOX_URL=${location.origin}
export SECRETBOX_TOKEN=sbx_...

npx secretbox pull --env prod > .env
npx secretbox run --env dev -- npm start
npx secretbox push --env dev API_KEY=abc123   # readwrite token`}</pre>
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded-full px-4 py-2 text-sm shadow-xl">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
