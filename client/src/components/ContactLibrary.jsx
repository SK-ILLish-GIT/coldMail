import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import EmptyState from "./EmptyState.jsx";
import Spinner from "./Spinner.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function ContactRow({ contact, onSaved }) {
  const [name, setName] = useState(contact.name || "");
  const [email, setEmail] = useState(contact.email || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(contact.name || "");
    setEmail(contact.email || "");
  }, [contact.id, contact.name, contact.email]);

  const dirty =
    name !== (contact.name || "") || email !== (contact.email || "");

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await api.updateContact(contact.id, { name, email });
      toast.success("Contact updated");
      onSaved();
    } catch (err) {
      toast.error(err.message || "Failed to update contact");
      setName(contact.name || "");
      setEmail(contact.email || "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="transition hover:bg-ui-inset/50">
      <td className="px-6 py-2">
        <input
          type="text"
          className="input !h-8 w-full min-w-[8rem] text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={saving}
          aria-label={`Name for ${contact.email}`}
        />
      </td>
      <td className="px-6 py-2">
        <input
          type="email"
          className="input !h-8 w-full min-w-[12rem] font-mono text-xs"
          placeholder="email@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={saving}
          aria-label="Email"
        />
      </td>
      <td className="px-6 py-2.5 text-xs text-ui-fg-muted whitespace-nowrap">
        {fmtDate(contact.lastContactedAt)}
      </td>
      <td className="px-6 py-2.5 text-xs text-ui-fg-muted">
        {contact.draftCount ?? 1}
      </td>
      <td className="px-6 py-2.5 text-right">
        {saving ? (
          <Spinner />
        ) : dirty ? (
          <button type="button" className="btn-ghost btn-xs" onClick={save}>
            Save
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export default function ContactLibrary({ onUseCompany }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const refresh = useCallback(async (q = search) => {
    setLoading(true);
    try {
      const data = await api.listContactsGrouped(q);
      setGroups(data);
      if (!q.trim()) {
        setExpanded(new Set(data.slice(0, 3).map((g) => g.companyKey)));
      }
    } catch (err) {
      toast.error(err.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => refresh(search), 300);
    return () => clearTimeout(timer);
  }, [search, refresh]);

  const stats = useMemo(() => {
    const companies = groups.length;
    const contacts = groups.reduce((n, g) => n + (g.contactCount || 0), 0);
    return { companies, contacts };
  }, [groups]);

  const toggleGroup = (companyKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(companyKey)) next.delete(companyKey);
      else next.add(companyKey);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(groups.map((g) => g.companyKey)));
  };

  const collapseAll = () => setExpanded(new Set());

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border/70 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-ui-fg">Contacts</h2>
          <p className="mt-0.5 text-xs text-ui-fg-muted">
            Edit names and emails inline — changes sync to Compose autofill.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ui-fg-muted">
            <span className="pill-ink">{stats.companies} companies</span>
            <span className="pill-brand">{stats.contacts} contacts</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input !h-8 w-48 text-sm"
            placeholder="Search company, name, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search contacts"
          />
          <button type="button" className="btn-ghost btn-xs" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={collapseAll}>
            Collapse
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => refresh(search)}
          >
            Refresh
          </button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-2 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-ui-inset"
            />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="mail"
          title={search ? "No contacts match your search" : "No contacts yet"}
          description={
            search
              ? "Try a different search term."
              : "Contacts appear here after you save Gmail drafts with a company name in Compose → By MailID."
          }
        />
      ) : (
        <div className="divide-y divide-ui-border/70">
          {groups.map((group) => {
            const open = expanded.has(group.companyKey);
            return (
              <div key={group.companyKey}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-ui-inset/40 px-6 py-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => toggleGroup(group.companyKey)}
                    aria-expanded={open}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`h-4 w-4 shrink-0 text-ui-fg-muted transition ${open ? "rotate-90" : ""}`}
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span className="truncate font-medium text-ui-fg">
                      {group.companyDisplay || group.companyKey}
                    </span>
                    <span className="pill-ink shrink-0">
                      {group.contactCount} contact
                      {group.contactCount === 1 ? "" : "s"}
                    </span>
                    <span className="hidden text-xs text-ui-fg-muted sm:inline">
                      · last {fmtDate(group.lastContactedAt)}
                    </span>
                  </button>
                  {onUseCompany && (
                    <button
                      type="button"
                      className="btn-secondary btn-xs shrink-0"
                      onClick={() => onUseCompany(group.companyDisplay)}
                    >
                      Use in Compose
                    </button>
                  )}
                </div>

                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-2xs uppercase tracking-[0.08em] text-ui-fg-muted">
                        <tr>
                          <th className="px-6 py-2 font-semibold">Name</th>
                          <th className="px-6 py-2 font-semibold">Email</th>
                          <th className="px-6 py-2 font-semibold">
                            Last outreach
                          </th>
                          <th className="px-6 py-2 font-semibold">Drafts</th>
                          <th className="px-6 py-2 font-semibold" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                        {group.contacts.map((c) => (
                          <ContactRow
                            key={c.id}
                            contact={c}
                            onSaved={() => refresh(search)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
