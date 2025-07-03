import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SHOP = (process.env.SHOP_DOMAIN || "").replace(/https?:\/\//, "").replace(/\/$/, "");

if (!SHOP) {
  console.error("❌  Missing SHOP_DOMAIN in .env");
  process.exit(1);
}

function buildBatchPayload(token) {
  const uId = Buffer.from(SHOP).toString("base64");
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
            headers: { uId, "Pim-Sid": "{{session_create$.headers.pim-sid}}" }
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
              headers: { uId, "Pim-Sid": "{{session_create$.headers.pim-sid}}" }
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
                headers: { "Pim-Sid": "{{session_create$.headers.pim-sid}}", Sid: "{{seller_config$.body.data.id}}" },
                body: `{"items":{{resume_checkout$.body.data.itemList}},"forceCreate":true,"channel":"SHOPIFY","fields":{"referenceId":"${token}"}}`
              }
            }
          ]
        }
      }
    }
  };
}

const normalizeImage = i => i.imageUrl || i.image_url || i.image || (Array.isArray(i.images) && i.images[0]) || "";

async function fetchFirstItem(token) {
  const resp = await fetch("https://edge.pickrr.com/batch/api/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Device-Id": "fastrr" },
    body: JSON.stringify(buildBatchPayload(token))
  });
  if (!resp.ok) return null;
  const raw = await resp.json();
  const json = raw.data ?? raw;
  const rich = json?.cart_create?.body?.items?.[0];
  const item = rich || json?.resume_checkout?.body?.data?.itemList?.[0];
  if (!item) return null;
  return { title: item.productName || item.name || item.title || "", image: normalizeImage(item),price: item.price ?? item.productPrice ?? item.salePrice ?? null };
}

// ---------- Routes ----------
app.get("/cart-title", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send("Missing token");
  const data = await fetchFirstItem(token);
  if (!data) return res.status(404).send("Cart not found or empty");
  res.type("text/plain").send(data.title);
});

app.get("/cart-image", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send("Missing token");
  const data = await fetchFirstItem(token);
  if (!data || !data.image) return res.status(404).send("Image not found");
  res.redirect(302, data.image);
});
app.get("/cart-price", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Missing token");
  const data = await fetchFirstItem(token);
  if (!data || data.price == null) return res.status(404).send("Price not found");
  res.type("text/plain").send(String(data.price));
});

app.get("/debug", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send("Missing token");
  const r = await fetch("https://edge.pickrr.com/batch/api/v1", { method: "POST", headers: { "Content-Type": "application/json", "X-Device-Id": "fastrr" }, body: JSON.stringify(buildBatchPayload(token)) });
  res.status(r.status).json(await r.json());
});

app.listen(PORT, () => console.log(`🟢  Fastrr preview API running on ${PORT}`));








