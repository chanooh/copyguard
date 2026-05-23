const form = document.querySelector("#analyze-form");
const statusEl = document.querySelector("#status");
const button = document.querySelector("#analyze-button");
const emptyState = document.querySelector("#empty-state");
const resultView = document.querySelector("#result-view");
const paymentPanel = document.querySelector("#payment-panel");
const connectWalletButton = document.querySelector("#connect-wallet-button");
const payButton = document.querySelector("#pay-button");
const walletStatus = document.querySelector("#wallet-status");
const paymentStatus = document.querySelector("#payment-status");

let appConfig = { payment: { required: false, configured: true } };
let walletState = { address: "" };
let paymentState = { verified: false, txHash: "", payerAddress: "" };

initializeApp();

connectWalletButton.addEventListener("click", async () => {
  try {
    setPaymentMessage("Connecting wallet...");
    await connectWallet();
    setPaymentMessage("Wallet connected. Payment is ready.");
  } catch (error) {
    setPaymentMessage(error.message, true);
  }
});

payButton.addEventListener("click", async () => {
  try {
    await payForAnalysis();
  } catch (error) {
    setPaymentLoading(false, error.message, true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const walletAddress = form.walletAddress.value.trim();
  const portfolioSizeUsdc = Number(form.portfolioSize.value);

  try {
    assertPaymentReady();
    setLoading(true, "Fetching Polymarket wallet data...");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        portfolioSizeUsdc,
        paymentTxHash: paymentState.txHash,
        payerAddress: paymentState.payerAddress,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.detail ? ` ${payload.detail}` : "";
      throw new Error(`${payload.error || "Analysis failed."}${detail}`);
    }

    renderResult(payload);
    resetPaymentAfterAnalysis();
    setLoading(false, "Analysis complete");
  } catch (error) {
    setLoading(false, error.message, true);
  }
});

async function initializeApp() {
  try {
    const response = await fetch("/api/config");
    appConfig = await response.json();
    renderPaymentConfig();
    listenForWalletChanges();
  } catch {
    setLoading(false, "Could not load app configuration.", true);
  }
}

function renderPaymentConfig() {
  const payment = appConfig.payment || { required: false };
  paymentPanel.classList.toggle("hidden", !payment.required);

  if (!payment.required) return;

  text("#payment-price", `${payment.amountUsdc} USDC`);
  text("#payment-network", payment.chainName || "Arc Testnet");

  if (!payment.configured) {
    connectWalletButton.disabled = true;
    payButton.disabled = true;
    walletStatus.textContent = "Payment is not configured";
    paymentStatus.textContent = "Set ARC_PAYMENT_RECIPIENT in .env before enabling paid queries.";
    statusEl.textContent = "Arc payment recipient is not configured.";
    statusEl.classList.add("error");
    return;
  }

  connectWalletButton.disabled = false;
  payButton.disabled = !walletState.address || paymentState.verified;
  renderWalletState();
}

async function connectWallet() {
  const ethereum = walletProvider();
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  walletState.address = accounts[0] || "";
  if (!walletState.address) {
    throw new Error("No wallet account was returned.");
  }

  await ensureArcNetwork();
  paymentState = { verified: false, txHash: "", payerAddress: "" };
  renderWalletState();
  return walletState.address;
}

async function payForAnalysis() {
  const payment = appConfig.payment;
  if (!payment?.required) return;
  if (!payment.configured) {
    throw new Error("Arc payment recipient is not configured.");
  }
  if (!walletState.address) {
    await connectWallet();
  }

  await ensureArcNetwork();
  setPaymentLoading(true, "Waiting for wallet signature...");

  const txHash = await walletProvider().request({
    method: "eth_sendTransaction",
    params: [
      {
        from: walletState.address,
        to: payment.recipient,
        value: toHex(payment.amountWei),
      },
    ],
  });

  setPaymentLoading(true, "Confirming Arc payment...");
  const response = await fetch("/api/arc/verify-payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      txHash,
      payerAddress: walletState.address,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Payment verification failed.");
  }

  paymentState = {
    verified: true,
    txHash: payload.payment.txHash,
    payerAddress: payload.payment.payer,
  };

  setPaymentLoading(false, `${paymentReadyLabel()}: ${shortHash(paymentState.txHash)}`);
  renderWalletState();
}

async function ensureArcNetwork() {
  const payment = appConfig.payment;
  const ethereum = walletProvider();
  setPaymentMessage(`Checking ${payment.chainName}...`);

  const currentChainId = await ethereum.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === String(payment.chainIdHex).toLowerCase()) return;

  try {
    setPaymentMessage(`Switching to ${payment.chainName}...`);
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: payment.chainIdHex }],
    });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;

    setPaymentMessage(`Adding ${payment.chainName} to wallet...`);
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: payment.chainIdHex,
          chainName: payment.chainName,
          nativeCurrency: payment.nativeCurrency,
          rpcUrls: [payment.rpcUrl],
          blockExplorerUrls: [payment.explorerUrl],
        },
      ],
    });

    setPaymentMessage(`Switching to ${payment.chainName}...`);
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: payment.chainIdHex }],
    });
  }

  const chainId = await ethereum.request({ method: "eth_chainId" });
  if (String(chainId).toLowerCase() !== String(payment.chainIdHex).toLowerCase()) {
    throw new Error(`Switch to ${payment.chainName} before paying.`);
  }
}

function assertPaymentReady() {
  const payment = appConfig.payment;
  if (!payment?.required) return;
  if (!payment.configured) {
    throw new Error("Arc payment recipient is not configured.");
  }
  if (!paymentState.verified) {
    throw new Error(`Pay ${payment.amountUsdc} USDC on Arc Testnet before analysis.`);
  }
}

function resetPaymentAfterAnalysis() {
  if (!appConfig.payment?.required) return;
  paymentState = { verified: false, txHash: "", payerAddress: "" };
  renderWalletState();
  setPaymentMessage("Payment consumed. Pay again for another analysis.");
}

function listenForWalletChanges() {
  const ethereum = window.ethereum;
  if (!ethereum?.on) return;

  ethereum.on("accountsChanged", (accounts) => {
    walletState.address = accounts[0] || "";
    paymentState = { verified: false, txHash: "", payerAddress: "" };
    renderWalletState();
  });

  ethereum.on("chainChanged", () => {
    paymentState = { verified: false, txHash: "", payerAddress: "" };
    renderWalletState();
  });
}

function walletProvider() {
  if (!window.ethereum) {
    throw new Error("No injected wallet found. Install MetaMask, Rabby, or another EVM wallet.");
  }
  return window.ethereum;
}

function isUnknownChainError(error) {
  const candidates = [
    error?.code,
    error?.data?.code,
    error?.data?.originalError?.code,
  ];
  return candidates.some((code) => Number(code) === 4902);
}

function renderWalletState() {
  const payment = appConfig.payment;
  if (!payment?.required || !payment.configured) return;

  walletStatus.textContent = walletState.address ? `Connected: ${shortHash(walletState.address)}` : "Wallet not connected";
  connectWalletButton.textContent = walletState.address ? "Switch Wallet" : "Connect Wallet";
  payButton.disabled = !walletState.address || paymentState.verified;
  payButton.textContent = paymentState.verified ? paymentReadyLabel() : `Pay ${payment.amountUsdc} USDC`;

  if (paymentState.verified) {
    paymentStatus.textContent = `Ready to analyze with ${shortHash(paymentState.txHash)}`;
  } else if (walletState.address) {
    paymentStatus.textContent = "Payment required before analysis";
  }
}

function setPaymentLoading(isLoading, message, isError = false) {
  payButton.disabled = isLoading || !walletState.address || paymentState.verified;
  connectWalletButton.disabled = isLoading;
  setPaymentMessage(message, isError);
}

function setPaymentMessage(message, isError = false) {
  paymentStatus.textContent = message;
  paymentStatus.classList.toggle("error", isError);
}

function paymentReadyLabel() {
  return appConfig.payment?.verifyOnchain === false ? "Payment Submitted" : "Payment Verified";
}

function renderResult(result) {
  emptyState.classList.add("hidden");
  resultView.classList.remove("hidden");

  const { metrics, recommendation, receipt, data } = result;
  text("#decision-title", decisionLabel(recommendation.decision));
  text("#decision-summary", recommendation.summary);
  text("#copy-score", recommendation.copyScore);
  text("#risk-score", recommendation.riskScore);
  text("#confidence-chip", recommendation.confidence);
  text("#position-count", `${metrics.openPositionCount} open`);
  text("#arc-status", result.arc?.payment?.required ? "Arc paid" : result.arc?.status === "planned" ? "Arc planned" : "Arc ready");

  renderMetrics(metrics);
  renderAiInsight(result.aiInsight);
  renderAllocation(recommendation.allocation);
  renderCategoryExposure(metrics.categoryExposure);
  renderList("#strengths-list", recommendation.strengths);
  renderList("#risks-list", recommendation.risks);
  renderList("#triggers-list", recommendation.stopCopyTriggers);
  renderPositions(data.positions || []);
  renderReceipt(receipt, result);
  applyDecisionTheme(recommendation.decision);
}

function renderAiInsight(insight) {
  const status = insight?.status === "ready" ? `${insight.provider} ${insight.model || ""}` : "Rules only";
  text("#ai-status", status.trim());

  if (!insight || insight.status !== "ready") {
    const message = insight?.riskNarrative?.[0] || "AI thesis is unavailable; deterministic scoring is still complete.";
    document.querySelector("#ai-thesis").innerHTML = `
      <p class="ai-muted">${escapeHtml(message)}</p>
    `;
    return;
  }

  document.querySelector("#ai-thesis").innerHTML = `
    <div class="ai-summary">
      <span>${escapeHtml(insight.walletStyle)}</span>
      <p>${escapeHtml(insight.thesis)}</p>
    </div>
    <div class="ai-grid">
      ${renderAiList("Takeaways", insight.keyTakeaways)}
      ${renderAiList("Risks", insight.riskNarrative)}
      ${renderAiList("Copy Plan", insight.copyPlan)}
      ${renderAiList("Caveats", insight.dataCaveats)}
    </div>
  `;
}

function renderAiList(label, items) {
  const rows = Array.isArray(items) && items.length > 0 ? items : ["No additional signal returned."];
  return `
    <div class="ai-list">
      <strong>${escapeHtml(label)}</strong>
      <ul>
        ${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderMetrics(metrics) {
  const items = [
    ["Portfolio value", fmtUsd(metrics.portfolioValue)],
    ["Total PnL", fmtUsd(metrics.totalPnl)],
    ["Win rate", fmtPct(metrics.winRate)],
    ["Largest exposure", fmtPct(metrics.largestPositionPct)],
    ["Recent trades", metrics.recent30dTradeCount],
    ["Strategy drift", `${Math.round(metrics.strategyDriftScore)}/100`],
  ];

  document.querySelector("#metrics-grid").innerHTML = items
    .map(
      ([label, value]) => `
        <article class="metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </article>
      `,
    )
    .join("");
}

function renderAllocation(allocation) {
  document.querySelector("#allocation-body").innerHTML = `
    <div class="allocation-main">
      <span>Max copy allocation</span>
      <strong>${fmtUsd(allocation.maxAllocationUsdc)}</strong>
    </div>
    <div class="allocation-rows">
      <div><span>Allocation cap</span><strong>${allocation.maxAllocationPct}%</strong></div>
      <div><span>Reserve</span><strong>${fmtUsd(allocation.reserveUsdc)}</strong></div>
      <div><span>Max per market</span><strong>${fmtUsd(allocation.maxPerMarketUsdc)}</strong></div>
    </div>
  `;
}

function renderCategoryExposure(exposures) {
  const rows = exposures && exposures.length > 0 ? exposures : [{ category: "none", value: 0, pct: 0 }];
  document.querySelector("#category-exposure").innerHTML = rows
    .slice(0, 6)
    .map(
      (item) => `
        <div class="category-row">
          <div>
            <span>${escapeHtml(titleCase(item.category))}</span>
            <strong>${fmtUsd(item.value)}</strong>
          </div>
          <div class="bar" aria-hidden="true"><i style="width: ${Math.max(2, item.pct * 100)}%"></i></div>
          <em>${fmtPct(item.pct)}</em>
        </div>
      `,
    )
    .join("");
}

function renderPositions(positions) {
  const rows = positions.slice(0, 12);
  document.querySelector("#positions-table").innerHTML =
    rows.length === 0
      ? `<tr><td colspan="5" class="empty-row">No open positions returned.</td></tr>`
      : rows
          .map(
            (position) => `
              <tr>
                <td>${escapeHtml(position.title)}</td>
                <td>${escapeHtml(position.outcome)}</td>
                <td>${fmtUsd(position.currentValue)}</td>
                <td class="${position.cashPnl >= 0 ? "positive" : "negative"}">${fmtUsd(position.cashPnl)}</td>
                <td>${escapeHtml(titleCase(position.category))}</td>
              </tr>
            `,
          )
          .join("");
}

function renderReceipt(receipt, result) {
  const details = [
    ["Input", result.walletAddress],
    ["Resolved wallet", result.resolvedUser?.proxyWallet || result.walletAddress],
    ["Decision", decisionLabel(receipt.decision)],
    ["Max allocation", fmtUsd(receipt.maxAllocationUsdc)],
    ["Hash", receipt.hash],
    ["Timestamp", new Date(receipt.timestamp).toLocaleString()],
  ];

  if (result.arc?.payment?.required) {
    details.push(["Arc payment", result.arc.payment.txHash]);
  }

  document.querySelector("#receipt-details").innerHTML = details
    .map(
      ([label, value]) => `
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(String(value))}</dd>
      `,
    )
    .join("");

  document.querySelector("#source-status").innerHTML = (result.sources || [])
    .map((source) => {
      const suffix = typeof source.count === "number" ? ` ${source.count}` : "";
      return `<span class="${source.ok ? "ok" : "bad"}">${escapeHtml(source.key)}${escapeHtml(suffix)}</span>`;
    })
    .join("");
}

function renderList(selector, items) {
  document.querySelector(selector).innerHTML = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function applyDecisionTheme(decision) {
  resultView.dataset.decision = decision;
}

function setLoading(isLoading, message, isError = false) {
  button.disabled = isLoading;
  button.textContent = isLoading ? "Analyzing..." : "Analyze Wallet";
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function text(selector, value) {
  document.querySelector(selector).textContent = value;
}

function toHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function shortHash(value) {
  const text = String(value || "");
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

function decisionLabel(decision) {
  return {
    follow: "Follow",
    watch: "Watch",
    reduce: "Reduce",
    avoid: "Avoid",
  }[decision] || "Watch";
}

function fmtUsd(value) {
  const number = Number(value) || 0;
  const sign = number < 0 ? "-" : "";
  return `${sign}$${Math.abs(number).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`;
}

function fmtPct(value) {
  return `${((Number(value) || 0) * 100).toFixed(0)}%`;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
