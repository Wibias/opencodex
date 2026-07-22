import { useCallback, useEffect, useState } from "react";
import { useI18n, type TFn, type Locale } from "../i18n/shared";
import { EmptyState } from "../ui";
import { IconRefresh } from "../icons";
import { formatBytes } from "../format-bytes";
import StorageWorkspace, {
  bucketLabel,
  type StorageBucket,
  type StorageReport,
} from "../components/storage-workspace/StorageWorkspace";

function formatDate(ms: number | undefined, locale: Locale): string {
  return ms === undefined ? "—" : new Date(ms).toLocaleDateString(locale);
}

function BucketsTable({ buckets, locale, t }: { buckets: StorageBucket[]; locale: Locale; t: TFn }) {
  return (
    <section className="panel" style={{ marginTop: 16 }} aria-labelledby="storage-buckets-title">
      <h3 id="storage-buckets-title" className="panel-title">{t("storage.section.buckets")}</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("storage.col.bucket")}</th>
              <th className="num">{t("storage.col.size")}</th>
              <th className="num">{t("storage.col.files")}</th>
              <th>{t("storage.col.oldest")}</th>
              <th>{t("storage.col.newest")}</th>
              <th className="num">{t("storage.col.rows")}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(bucket => (
              <tr key={bucket.key}>
                <td>{bucketLabel(bucket, t)}</td>
                <td className="num mono">{formatBytes(bucket.bytes, locale)}</td>
                <td className="num">{bucket.fileCount}</td>
                <td className="muted">{formatDate(bucket.oldest, locale)}</td>
                <td className="muted">{formatDate(bucket.newest, locale)}</td>
                <td className="num mono">
                  {bucket.rows === undefined ? "—" : bucket.rows === null ? t("storage.rows.unknown") : bucket.rows.toLocaleString(locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LargestFilesPanel({ buckets, locale, t }: { buckets: StorageBucket[]; locale: Locale; t: TFn }) {
  const withLargest = buckets.filter(bucket => (bucket.largest?.length ?? 0) > 0);
  if (withLargest.length === 0) return null;
  return (
    <section className="panel" style={{ marginTop: 16 }} aria-labelledby="storage-largest-title">
      <h3 id="storage-largest-title" className="panel-title">{t("storage.section.largest")}</h3>
      {withLargest.map(bucket => (
        <details key={bucket.key} style={{ marginTop: 8 }}>
          <summary>{bucketLabel(bucket, t)}</summary>
          <div className="tbl-wrap" style={{ marginTop: 8 }}>
            <table className="tbl">
              <tbody>
                {bucket.largest!.map(entry => (
                  <tr key={entry.path}>
                    <td className="mono">{entry.path}</td>
                    <td className="num mono">{formatBytes(entry.bytes, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}

export default function Storage({ apiBase }: { apiBase: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true);
  // Workspace vs Classic: localStorage is the source of truth (same pattern as Providers).
  const [workspaceView, setWorkspaceView] = useState(() => {
    try {
      return localStorage.getItem("ocx-storage-view") === "workspace";
    } catch {
      return false;
    }
  });
  const toggleWorkspace = () => {
    const next = !workspaceView;
    try {
      localStorage.setItem("ocx-storage-view", next ? "workspace" : "classic");
    } catch {
      /* ignore */
    }
    setWorkspaceView(next);
  };

  const fetchStorage = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/storage`, { signal });
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json() as StorageReport;
      if (signal?.aborted) return;
      setData(json);
    } catch {
      if (signal?.aborted) return;
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick (same pattern as Usage.tsx) so the effect never sets state synchronously.
    const timeout = window.setTimeout(() => {
      void fetchStorage(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchStorage]);

  const failed = !loading && (!data || data.error !== undefined);
  const empty = !loading && !failed && data!.total.fileCount === 0;

  if (workspaceView && !loading && !failed && !empty && data) {
    return (
      <>
        <div className="page-head">
          <h2 id="storage-page-title">{t("storage.title")}</h2>
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void fetchStorage()}>
              <IconRefresh /> {t("storage.refresh")}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={toggleWorkspace}>{t("pws.classicToggle")}</button>
          </div>
        </div>
        <StorageWorkspace report={data} locale={locale} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h2 id="storage-page-title">{t("storage.title")}</h2>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void fetchStorage()}>
            <IconRefresh /> {t("storage.refresh")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleWorkspace}>{t("pws.workspaceToggle")}</button>
        </div>
      </div>
      <p className="page-sub">{t("storage.subtitle")}</p>

      {loading && !data ? (
        <EmptyState title={t("storage.loading")} />
      ) : failed ? (
        <EmptyState title={t("storage.error")} />
      ) : empty ? (
        <EmptyState title={t("storage.empty")} />
      ) : (
        <>
          <div className="usage-cards">
            <div className="stat"><div className="muted">{t("storage.card.total")}</div><div className="stat-value">{formatBytes(data!.total.bytes, locale)}</div></div>
            <div className="stat"><div className="muted">{t("storage.card.files")}</div><div className="stat-value">{data!.total.fileCount.toLocaleString(locale)}</div></div>
            <div className="stat"><div className="muted">{t("storage.card.home")}</div><div className="stat-value mono" style={{ fontSize: "var(--text-body)", wordBreak: "break-all" }}>{data!.codexHome}</div></div>
          </div>
          <BucketsTable buckets={data!.buckets} locale={locale} t={t} />
          <LargestFilesPanel buckets={data!.buckets} locale={locale} t={t} />
        </>
      )}
    </>
  );
}
