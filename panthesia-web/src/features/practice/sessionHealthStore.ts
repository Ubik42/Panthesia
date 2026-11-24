import { reportDiagnostic } from "../../lib/diagnostics";
export type SessionIssueKind = "action" | "session";
export interface SessionIssue {
  kind: SessionIssueKind;
  version: number;
  detail: string;
  firstAt: number;
  lastAt: number;
  occurrences: number;
}
export interface SessionConnection {
  connected: boolean;
  lastSuccessAt: number | null;
  lostAt: number | null;
  lastFailure: string;
  failures: number;
}
export type SessionMessages = Readonly<Record<SessionIssueKind, string>>;
export interface SessionHealth {
  issues: readonly SessionIssue[];
  connection: SessionConnection;
}
const kinds: SessionIssueKind[] = [
  "action",
  "session",
];
const text = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
/** Display messages change only with their content; repeated connection failures retain diagnostic timing separately. */
export function createSessionHealthStore() {
  let messages: SessionMessages = {
    action: "",
    session: "",
  };
  let connection: SessionConnection = {
    connected: false,
    lastSuccessAt: null,
    lostAt: null,
    lastFailure: "",
    failures: 0,
  };
  let lastSuccessAt: number | null = null,
    serial = 0,
    notifiedAt = 0;
  const issues = new Map<SessionIssueKind, SessionIssue>(),
    listeners = new Set<() => void>();
  let snapshot: SessionHealth = { issues: [], connection };
  const publish = () => {
    snapshot = {
      issues: kinds.flatMap((kind) => issues.get(kind) ?? []),
      connection,
    };
    notifiedAt = Date.now();
    for (const listener of [...listeners]) listener();
  };
  const report = (kind: SessionIssueKind, detail: string) => {
    const previous = issues.get(kind),
      now = Date.now();
    if (!detail) {
      if (!previous) return;
      issues.delete(kind);
      messages = { ...messages, [kind]: "" };
      publish();
      return;
    }
    if (previous?.detail === detail) {
      issues.set(kind, {
        ...previous,
        lastAt: now,
        occurrences: previous.occurrences + 1,
      });
      if (now - notifiedAt >= 5000) publish();
      return;
    }
    reportDiagnostic(kind,detail);
    issues.set(kind, {
      kind,
      detail,
      version: ++serial,
      firstAt: now,
      lastAt: now,
      occurrences: 1,
    });
    messages = { ...messages, [kind]: detail };
    publish();
  };
  return {
    report,
    getSnapshot: () => snapshot,
    getMessages: () => messages,
    inspect: (): SessionHealth => ({
      issues: kinds.flatMap((kind) => issues.get(kind) ?? []),
      connection: { ...connection, lastSuccessAt },
    }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismissAction(version: number) {
      if (issues.get("action")?.version !== version) return false;
      report("action", "");
      return true;
    },
    connectionSucceeded() {
      lastSuccessAt = Date.now();
      if (connection.connected) return;
      connection = {
        connected: true,
        lastSuccessAt,
        lostAt: null,
        lastFailure: "",
        failures: 0,
      };
      publish();
    },
    connectionFailed(failure: unknown) {
      const now = Date.now(),
        detail = text(failure);
      const changed =
        connection.connected ||
        connection.lastFailure !== detail ||
        !connection.lostAt;
      connection = {
        connected: false,
        lastSuccessAt,
        lostAt: connection.lostAt ?? now,
        lastFailure: detail,
        failures: connection.failures + 1,
      };
      if (changed || now - notifiedAt >= 5000) publish();
    },
  };
}
export type SessionHealthStore = ReturnType<typeof createSessionHealthStore>;
