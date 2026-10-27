"use strict";
const form = document.querySelector("#check-form");
const statusNode = document.querySelector("#status");
const reportNode = document.querySelector("#report");
const runButton = document.querySelector("#run");
const copyButton = document.querySelector("#copy");

async function request(path, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const start = performance.now();
  try {
    const response = await fetch(path, {
      signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await consume(response);
    return { data, milliseconds: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(timer);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const report = {
    time: new Date().toISOString(), url: location.origin + location.pathname,
    region: document.querySelector("#region").value.trim(),
    network: document.querySelector("#network").value,
    direct_connection: "user_attested_not_automatically_verified",
    https: location.protocol === "https:", user_agent: navigator.userAgent,
    scope: "connectivity_probe_only_not_production_acceptance", rounds: []
  };
  runButton.disabled = true;
  reportNode.hidden = true;
  copyButton.hidden = true;
  try {
    for (let i = 0; i < 5; i++) {
      statusNode.textContent = `正在检查 ${i + 1}/5…`;
      const suffix = `?run=${Date.now()}-${i}`;
      const round = { number: i + 1 };
      try {
        const health = await request(`health.json${suffix}`, r => r.json());
        if (health.data.marker !== "amddev-connectivity-v1") throw new Error("检查文件内容不符");
        const sample = await request(`sample.bin${suffix}`, r => r.arrayBuffer());
        if (sample.data.byteLength !== 65536) throw new Error("测试资源不完整");
        round.ok = true;
        round.health_ms = health.milliseconds;
        round.sample_ms = sample.milliseconds;
        round.sample_bytes = sample.data.byteLength;
      } catch (error) {
        round.ok = false;
        round.error = error.name === "AbortError" ? "10 秒超时" : error.message;
      }
      report.rounds.push(round);
    }
    const passed = report.rounds.filter(r => r.ok).length;
    report.passed_rounds = passed;
    report.total_rounds = 5;
    reportNode.value = JSON.stringify(report, null, 2);
    reportNode.hidden = false;
    copyButton.hidden = false;
    statusNode.textContent = `完成：${passed}/5 轮通过。${report.https ? "当前使用 HTTPS。" : "当前未使用 HTTPS，尚不满足公网验收条件。"} 请复制结果。`;
  } finally {
    runButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(reportNode.value);
    copyButton.textContent = "已复制";
  } catch {
    reportNode.focus();
    reportNode.select();
    copyButton.textContent = "请手动复制已选中的结果";
  }
});
