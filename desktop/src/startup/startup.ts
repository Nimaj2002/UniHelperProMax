// The local startup page (contracts/ui-contract.md "Startup page states"): shown while the
// server starts and whenever it can't. A plain script: no modules, no network.

interface StartupFailure {
  code: string;
  message: string;
  details: Record<string, unknown>;
  logFile: string | null;
}

type StartupPageState =
  | { state: "starting" }
  | { state: "error"; failure: StartupFailure; logsFolder: string };

interface StartupBridge {
  onState(listener: (s: StartupPageState) => void): () => void;
  action(name: string, payload?: unknown): Promise<unknown>;
  ready(): void;
}

const TITLES: Record<string, string> = {
  port_in_use: "The app's port is in use",
  data_dir_unwritable: "A folder can't be written",
  files_dir_missing: "Your data folder can't be found",
  database_damaged: "The database is damaged",
  database_newer: "This data needs a newer version",
  migration_failed: "The update couldn't upgrade your database",
  another_server: "Another UniHelperProMax server is using your data",
  low_disk_for_backup: "Not enough disk space to update",
  handshake_failed: "UniHelperProMax couldn't start",
  unexpected: "UniHelperProMax couldn't start",
};

(() => {
  const bridge = (window as unknown as { uhStartup?: StartupBridge }).uhStartup;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  function show(s: StartupPageState): void {
    byId("starting").hidden = s.state !== "starting";
    byId("error").hidden = s.state !== "error";
    if (s.state === "error") {
      byId("error-title").textContent = TITLES[s.failure.code] ?? TITLES.unexpected;
      byId("error-message").textContent = s.failure.message;
      byId("error-log").textContent = s.failure.logFile ?? s.logsFolder;
      (document.querySelector('[data-action="retry"]') as HTMLButtonElement).focus();
    }
  }

  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button[data-action]") as HTMLButtonElement | null;
    if (button && bridge) void bridge.action(button.dataset.action ?? "");
  });

  show({ state: "starting" });
  bridge?.onState(show);
  bridge?.ready();
})();
