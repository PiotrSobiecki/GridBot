/**
 * Strona /docs z wbudowanym Swagger UI. Przycisk Connect wallet w miejscu URL bara, popup z tokenem do skopiowania.
 */
export function getDocsHtml(baseUrl) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GridBot API – Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <script src="https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js"></script>
  <style>
    /* Ukryj pasek URL / Explore w Swaggerze */
    .swagger-ui .topbar .download-url-wrapper,
    .swagger-ui .info .link { display: none !important; }
    .swagger-ui .topbar { padding: 10px 0; }
    /* Pasek z przyciskiem Connect wallet (w miejscu URL) – prawa strona */
    .docs-top { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; background: #1f2937; border-bottom: 1px solid #374151; }
    .docs-top .wallet-wrap { display: flex; align-items: center; gap: 12px; }
    .docs-top button#btn-wallet { padding: 8px 16px; background: #10b981; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .docs-top button#btn-wallet:hover { background: #059669; }
    .docs-top button#btn-wallet:disabled { opacity: 0.6; cursor: not-allowed; }
    .docs-top .status { font-size: 13px; color: #9ca3af; }
    /* Popup z tokenem */
    .token-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .token-popup { background: #1f2937; border-radius: 12px; padding: 24px; max-width: 480px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .token-popup h3 { margin: 0 0 12px 0; color: #f3f4f6; font-size: 18px; }
    .token-popup p { color: #9ca3af; font-size: 14px; margin: 0 0 16px 0; }
    .token-popup pre { background: #111827; color: #e5e7eb; padding: 12px; border-radius: 8px; font-size: 12px; overflow: auto; word-break: break-all; margin: 0 0 16px 0; max-height: 120px; }
    .token-popup .btns { display: flex; gap: 10px; }
    .token-popup button { padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }
    .token-popup .btn-copy { background: #10b981; color: #fff; }
    .token-popup .btn-copy:hover { background: #059669; }
    .token-popup .btn-close { background: #374151; color: #e5e7eb; }
    .token-popup .btn-close:hover { background: #4b5563; }
  </style>
</head>
<body>
  <div class="docs-top">
    <div></div>
    <div class="wallet-wrap">
      <span class="status" id="wallet-status"></span>
      <button type="button" id="btn-wallet">Connect wallet</button>
    </div>
  </div>
  <div id="swagger-ui"></div>

  <div id="token-popup" class="token-overlay" style="display: none;">
    <div class="token-popup">
      <h3>Bearer token</h3>
      <p>Skopiuj i wklej w Swagger → Authorize → Bearer:</p>
      <pre id="token-text"></pre>
      <div class="btns">
        <button type="button" class="btn-copy" id="token-copy">Skopiuj</button>
        <button type="button" class="btn-close" id="token-close">Zamknij</button>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    const baseUrl = ${JSON.stringify(baseUrl)};

    window.ui = SwaggerUIBundle({
      url: baseUrl + "/docs/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset
      ],
      layout: "StandaloneLayout"
    });

    document.getElementById("btn-wallet").onclick = async function() {
      const btn = this;
      const status = document.getElementById("wallet-status");
      btn.disabled = true;
      status.textContent = "Laczenie...";
      try {
        if (!window.ethereum) throw new Error("Zainstaluj MetaMask");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const chainId = (await provider.getNetwork()).chainId;
        status.textContent = "Nonce...";
        const nonceRes = await fetch(baseUrl + "/auth/nonce", { credentials: "include" });
        const { nonce } = await nonceRes.json();
        const domain = new URL(baseUrl).host;
        const issuedAt = new Date().toISOString();
        const messageToSign = domain + " wants you to sign in with your Ethereum account:\\n" + address + "\\n\\nSign in to GridBot (Swagger)\\n\\nURI: " + baseUrl + "\\nVersion: 1\\nChain ID: " + chainId + "\\nNonce: " + nonce + "\\nIssued At: " + issuedAt;
        status.textContent = "Podpisz w MetaMask...";
        const signature = await signer.signMessage(messageToSign);
        status.textContent = "Weryfikacja...";
        const verifyRes = await fetch(baseUrl + "/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: messageToSign, signature: signature })
        });
        const data = await verifyRes.json();
        if (!verifyRes.ok) throw new Error(data.error || "Verify failed");
        var token = data.token;
        status.textContent = "";
        document.getElementById("token-text").textContent = token;
        document.getElementById("token-popup").style.display = "flex";
        document.getElementById("token-copy").onclick = function() {
          navigator.clipboard.writeText(token);
          this.textContent = "Skopiowano!";
          var t = this;
          setTimeout(function() { t.textContent = "Skopiuj"; }, 2000);
        };
      } catch (e) {
        status.textContent = "Blad: " + (e.message || e);
      }
      btn.disabled = false;
    };

    document.getElementById("token-close").onclick = function() {
      document.getElementById("token-popup").style.display = "none";
    };
  </script>
</body>
</html>`;
}
