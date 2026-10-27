import { markdown } from "../report.js";
import type { Inspection } from "../types.js";
function el<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
const mint = el<HTMLInputElement>("mint"),
  network = el<HTMLSelectElement>("network"),
  status = el("status"),
  submit = el<HTMLButtonElement>("submit");
let current: Inspection | undefined,
  controller: AbortController | undefined,
  revision = 0;
function clear() {
  revision++;
  controller?.abort();
  current = undefined;
  el("report").hidden = true;
  el("empty").hidden = false;
  submit.disabled = false;
  status.textContent = "Input changed. Inspect again to refresh the report.";
}
mint.addEventListener("input", clear);
network.addEventListener("change", clear);
function show(r: Inspection) {
  current = r;
  el("empty").hidden = true;
  el("report").hidden = false;
  el("source").textContent =
    r.source === "example" ? "FICTIONAL EXAMPLE" : "CONFIRMED RPC READ";
  el("observation").textContent =
    r.source === "example"
      ? `${r.exampleName} · offline fixture, not an on-chain observation`
      : `${r.network} · mint slot ${r.slot} · ${new Date(r.observedAt).toLocaleString()}`;
  el("hook-status").textContent = {
    configured: "Configured",
    disabled: "Disabled",
    absent: "No extension",
    legacy: "Legacy token",
  }[r.mintInfo.hook.status];
  el("pointer-control").textContent =
    r.mintInfo.hook.status === "absent" || r.mintInfo.hook.status === "legacy"
      ? "Not applicable"
      : r.mintInfo.hook.authority
        ? "Update authority set"
        : "No authority set";
  el("extra-status").textContent =
    r.extra.status === "found"
      ? `${r.extra.entries.length} configurations`
      : r.extra.status.replace("not-requested", "Not requested");
  el("flow-hook").textContent =
    r.mintInfo.hook.status === "configured"
      ? "Hook configured"
      : "No active hook";
  const facts = el("facts");
  facts.replaceChildren();
  function field(name: string, value: string | null, id?: string) {
    const row = document.createElement("div"),
      dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value ?? "None";
    if (id) dd.dataset.testid = id;
    row.append(dt, dd);
    facts.append(row);
  }
  field("Mint", r.mint);
  field(
    "Token program",
    r.mintInfo.hook.status === "legacy"
      ? "Original Token Program"
      : "Token-2022",
  );
  field("Hook program", r.mintInfo.hook.programId, "hook-program");
  field(
    "Pointer update authority",
    r.mintInfo.hook.authority,
    "hook-authority",
  );
  field(
    "Program executable",
    r.program.executable === null
      ? "Unverified"
      : r.program.executable
        ? "Yes"
        : "No",
  );
  field("Program owner", r.program.owner);
  field("Extra-account PDA", r.extra.address);
  field(
    "Other extension IDs",
    r.mintInfo.extensions.filter((t) => t !== 14).join(", ") || "None observed",
  );
  if (r.program.slot !== null)
    field("Program observation slot", String(r.program.slot));
  if (r.extra.slot !== null)
    field("Extra-account observation slot", String(r.extra.slot));
  const notes = el("notes");
  notes.replaceChildren();
  for (const note of r.notes) {
    const li = document.createElement("li");
    li.textContent = note;
    notes.append(li);
  }
  el("accounts-note").textContent =
    r.extra.status === "found"
      ? "Requested permissions and address configuration from the optional Execute list. These are not a grant of wallet signer privileges."
      : r.extra.status === "missing"
        ? "The optional PDA is absent. A hook can operate without extra accounts."
        : r.extra.status === "unavailable"
          ? "Configuration could not be validated. Required accounts remain unknown."
          : "No active hook, so no extra-account lookup was requested.";
  const accounts = el("accounts");
  accounts.replaceChildren();
  for (const e of r.extra.entries) {
    const article = document.createElement("article");
    article.className = "account";
    const index = document.createElement("div");
    index.className = "index";
    index.textContent = `ACCOUNT #${e.index}`;
    const detail = document.createElement("div"),
      title = document.createElement("strong"),
      description = document.createElement("p"),
      address = document.createElement("code"),
      flags = document.createElement("div");
    title.textContent = {
      static: "Fixed address",
      "hook-pda": "PDA under the hook program",
      "external-pda": `PDA under account #${e.programIndex}`,
      "pubkey-data": "Address from runtime data",
      unknown: "Unknown configuration type",
    }[e.kind];
    description.textContent =
      e.kind === "static"
        ? "The configuration names this account directly."
        : e.kind === "unknown"
          ? `Format ${e.discriminator} is not interpreted. Raw bytes are preserved.`
          : "Address depends on transfer-specific accounts, instruction data or configured seeds. It has not been resolved.";
    address.textContent = e.address ?? `Config hex: ${e.configHex}`;
    flags.className = "flags";
    flags.textContent = `Requested signer: ${e.signer ? "yes" : "no"} · writable: ${e.writable ? "yes" : "no"} · type ${e.discriminator}`;
    detail.append(title, description, address, flags);
    article.append(index, detail);
    accounts.append(article);
  }
}
async function load(path: string) {
  controller?.abort();
  const attempt = ++revision;
  controller = new AbortController();
  const timer = setTimeout(() => controller?.abort(), 40000);
  submit.disabled = true;
  status.textContent = "Reading configuration…";
  current = undefined;
  el("report").hidden = true;
  el("empty").hidden = true;
  try {
    const response = await fetch(path, { signal: controller.signal });
    const data = (await response.json()) as Inspection & {
      error?: { message: string };
    };
    if (attempt !== revision) return;
    if (!response.ok)
      throw new Error(data.error?.message ?? "Lookup failed. Try again.");
    show(data);
    mint.value = data.mint;
    network.value = data.network;
    status.textContent =
      data.source === "example"
        ? "Offline example loaded. No RPC request was made."
        : "Account data read. Configuration may change after this observation.";
  } catch (error) {
    if (attempt !== revision) return;
    el("empty").hidden = false;
    status.textContent =
      error instanceof Error && error.name === "AbortError"
        ? "Lookup timed out or was cancelled. Try again."
        : error instanceof Error
          ? error.message
          : "Lookup failed. Try again.";
  } finally {
    clearTimeout(timer);
    if (attempt === revision) submit.disabled = false;
  }
}
el("lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  const params = new URLSearchParams({
    mint: mint.value.trim(),
    network: network.value,
  });
  void load("/api/inspect?" + params);
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-example]",
))
  button.addEventListener(
    "click",
    () => void load("/api/examples/" + button.dataset.example),
  );
function download(type: "json" | "md") {
  if (!current) return;
  const content =
      type === "json" ? JSON.stringify(current, null, 2) : markdown(current),
    url = URL.createObjectURL(
      new Blob([content], {
        type: type === "json" ? "application/json" : "text/markdown",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `hookview-report.${type}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

el("json").addEventListener("click", () => download("json"));
el("markdown").addEventListener("click", () => download("md"));
el("copy").addEventListener("click", async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(markdown(current));
    status.textContent = "Report copied.";
  } catch {
    status.textContent = "Clipboard unavailable. Export Markdown instead.";
  }
});
