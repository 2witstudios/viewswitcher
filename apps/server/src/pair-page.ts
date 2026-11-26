// The one page an unpaired phone or tablet gets (MAC-24): enter (or scan) the code the Mac shows, name
// the device, and land in the switcher. Self-contained, so nothing else (assets, the SPA) is served to
// a device that isn't paired.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const PAIR_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function pairPage({ name }: { name: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Pair with ViewSwitcher</title>
<style>
  :root { color-scheme: dark; --bg: #0b0c0f; --raised: #16181e; --line: #343846; --sage: #a3a8b5; --cream: #f4f5f7; --live: #ff4d4f; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--cream); font: 17px/1.45 system-ui, -apple-system, sans-serif;
    display: grid; place-items: center;
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
  main { width: 100%; max-width: 380px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { color: var(--sage); margin: 0 0 24px; }
  label { display: block; font-size: 14px; color: var(--sage); margin: 0 0 6px; }
  input { width: 100%; min-height: 52px; padding: 12px 14px; margin: 0 0 18px; border-radius: 12px; border: 1px solid var(--line);
    background: var(--raised); color: var(--cream); font: inherit; }
  input:focus { outline: 2px solid var(--cream); outline-offset: 1px; }
  #code { font: 600 24px/1 ui-monospace, "SF Mono", monospace; letter-spacing: 0.18em; text-transform: uppercase; text-align: center; }
  button { width: 100%; min-height: 56px; border: 0; border-radius: 14px; background: var(--cream); color: var(--bg); font-family: inherit; font-size: 18px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.6; }
  #error { color: var(--live); min-height: 1.45em; margin: 14px 0 0; }
  small { display: block; color: var(--sage); margin-top: 28px; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>Pair with ViewSwitcher</h1>
  <p>On the Mac: Phones and Tablets.</p>
  <form id="pair" autocomplete="off">
    <label for="code">Code</label>
    <input id="code" name="code" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" placeholder="XXXX-XXXX" required>
    <label for="name">Name this phone or tablet</label>
    <input id="name" name="name" maxlength="40" value="${esc(name)}">
    <button id="go" type="submit">Pair</button>
    <div id="error" role="alert"></div>
  </form>
  <small>Wi-Fi traffic isn't encrypted: pair only on networks you trust.</small>
</main>
<script>
  const q = new URLSearchParams(location.search);
  const code = document.getElementById("code");
  if (q.get("code")) code.value = q.get("code");
  else code.focus();
  document.getElementById("pair").addEventListener("submit", async (e) => {
    e.preventDefault();
    const go = document.getElementById("go"), err = document.getElementById("error");
    go.disabled = true; err.textContent = "";
    try {
      const r = await fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ code: code.value, name: document.getElementById("name").value }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || "Couldn't pair.");
      location.replace("/");
    } catch (x) {
      err.textContent = x.message;
      go.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
