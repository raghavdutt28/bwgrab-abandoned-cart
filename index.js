import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SHOP = (process.env.SHOP_DOMAIN || "").replace(/https?:\/\//, "").replace(/\/$/, "");
if (!SHOP) {
  console.error("❌  Set SHOP_DOMAIN in .env");
  process.exit(1);
}

/**************** Constants ****************/
const FASTRR_BATCH = "https://edge.pickrr.com/batch/api/v1";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Device-Id": "fastrr"
};
const uIdB64 = Buffer.from(SHOP).toString("base64");

/**************** Helpers ****************/
const normalizeImage = (i) => i?.imageUrl || i?.image_url || i?.image || (i?.images?.[0] || "");
const normalizeTitle = (i) => i?.productName || i?.name || i?.title || "";
const normalizePrice = (i) => String(i?.price ?? i?.productPrice ?? i?.salePrice ?? i?.compareAtPrice ?? "");

/**************** Batch payload (incl. seller_config) ****************/
function buildItemPayload(token) {
  return {
    requests: [
      { key: "session_create", input: { method: "GET", path: "/identity-service/session/create" } }
    ],
    next: {
      requests: [
        {
          key: "seller_config",
          input: {
            method: "GET",
            path: "/aggregator/api/ve1/aggregator-service/seller/config",
            headers: { uId: uIdB64, "Pim-Sid": "{{session_create$.headers.pim-sid}}" }
          }
        }
      ],
      next: {
        requests: [
          {
            key: "resume_checkout",
            input: {
              method: "GET",
              path: `/aggregator/api/ve1/aggregator-service/abandon-checkout/?id=${token}&type=report`,
              headers: { uId: uIdB64, "Pim-Sid": "{{session_create$.headers.pim-sid}}" }
            }
          }
        ],
        next: {
          requests: [
            {
              key: "cart_create",
              input: {
                method: "POST",
                path: "/cart/api/ve1/cart-service//{{session_create$.body.result.user_profile_id}}",
                headers: {
                  "Pim-Sid": "{{session_create$.headers.pim-sid}}",
                  Sid: "{{seller_config$.body.data.id}}"
                },
                body: `{
                          "items": {{resume_checkout$.body.data.itemList}},
                          "forceCreate": true,
                          "channel": "SHOPIFY",
                          "fields": { "referenceId": "${token}" },
                          "cartAttributes": {
                            "landing_page_url": "https://${SHOP}/"
                            }
                        }`
              }
            }
          ]
        }
      }
    }
  };
}

/**************** Network ***************/
async function fetchBatch(payload) {
  const resp = await fetch(FASTRR_BATCH, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Fastrr status", resp.status, text.slice(0, 300));
    return null;
  }
  const raw = await resp.json();
  return raw.data ?? raw;
}

async function getItem(token) {
  const json = await fetchBatch(buildItemPayload(token));
  return json?.cart_create?.body?.items?.[0] || null;
}

/**************** Routes ****************/
app.get("/cart-title", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Missing token");
  const item = await getItem(token);
  if (!item) return res.status(404).send("Cart empty");
  res.type("text/plain").send(normalizeTitle(item));
});

app.get("/cart-price", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Missing token");
  const item = await getItem(token);
  if (!item) return res.status(404).send("Cart empty");
  const price = normalizePrice(item);
  if (!price) return res.status(404).send("Price not found");
  res.type("text/plain").send(price);
});

app.get("/cart-image", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Missing token");
  const item = await getItem(token);
  const imgUrl = normalizeImage(item);
  if (!imgUrl) return res.status(404).send("Image not found");

  try {
    const imgResp = await fetch(imgUrl);
    if (!imgResp.ok) throw new Error(`CDN status ${imgResp.status}`);
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    res.setHeader("Content-Type", imgResp.headers.get("content-type") || "image/jpeg");
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error("Image fetch error", err);
    res.status(502).send("Unable to fetch image");
  }
});

app.get("/debug", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Missing token");
  const json = await fetchBatch(buildItemPayload(token));
  res.json(json || { error: "No data" });
});

app.listen(PORT, () => console.log(`🟢  API v2.3.2 running on :${PORT}`));