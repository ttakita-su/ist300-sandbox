# D09: What does Rotation actually send?

IST 300 D09, Tomoyoshi Takita, 2026-11-02. Everything below comes from runs on 2026-11-02:
- a Playwright Chromium session recording the network while using the app;
- `curl` against the local server (`npm start`, http://127.0.0.1:8130);
- `npm run weather`.

No key appears anywhere. Open-Meteo's free tier doesn't use one, and the wrong-key test used a made-up value, shown here as `YOUR_KEY_HERE`.

## Part 1: Watch my own app

### The D08 action: adding an item to my closet

**I couldn't find the request, because there isn't one.** I recorded every network request while adding "Uniqlo Oxford shirt, Light blue" through Add item → Enter it yourself → Add to collection. The list was **empty: zero requests**. The item showed up anyway, and I found it in the browser's own database:

```
IndexedDB rotation-prototype / ownedItems:
{ "id": "own_q935fqo86xsou0p2", "userId": "usr_demo_alex", "category": "clothing",
  "custom": { "brand": "Uniqlo", "name": "Oxford shirt", "variantName": "Light blue", "type": "tee", "colors": [] },
  "createdAt": "2026-11-03T01:23:06.051Z" }
```

Where the data goes instead (path relative to `closet-advisor/`):

1. The form's submit handler calls `saveItem` (`js/screens/add.js:60`). That calls `ctx.api.createOwned(...)` (`:66`).
2. `api` is a JavaScript Proxy in `js/client.js:57`. It doesn't call `fetch`; it calls a function.
3. `invoke` in `js/server/api.js:109` checks who is signed in and their role, like a real server would.
4. The `createOwned` operation (`js/server/ops/inventory.js:299`) validates the item and saves it with `ctx.db.put('ownedItems', record)` (`:362`).
5. `js/server/db.js:113` writes it to IndexedDB (`indexedDB.open('rotation-prototype', ...)`), on this device only.

**Why my stack works this way:** Rotation is a prototype whose "server" is a module running inside the browser tab. The data never leaves the device, so there's nothing to see in the Network tab. That is also why nothing syncs between my phone and laptop, and why the demo accounts aren't a real security boundary (D10).

### The one action that does send a request: Search online stores

Only the real-product features talk to a server: the local Node server started by `npm start`. I searched "Uniqlo oxford shirt":

```
Method:  POST
URL:     http://127.0.0.1:8130/api/search
Sent:    {"query":"Uniqlo oxford shirt"}
         headers: Content-Type: application/json, X-Rotation: 1,
         Origin: http://127.0.0.1:8130, Sec-Fetch-Site: same-origin
Status:  200
Came back: {"status":"ok","engine":"bing","query":"Uniqlo oxford shirt",
           "shopping":[{"id":"shop_1","title":"UNIQLO Men's Oxford Slim Shirt, Off White, Medium",
             "price":{"amountMinor":4990,"currency":"USD"},"priceText":"$49.90","seller":"UNIQLO US",
             "imageUrl":"https://th.bing.com/...","url":"https://www.bing.com/shop/productdetails?...",
             "source":"bing_shopping"}, ...24 listings],
           "results":[...web pages]}
```

My computer's server then asks Bing; the browser never talks to Bing directly.

### The same request without the app

```sh
ROTATION_URL=http://127.0.0.1:8130
curl -s -X POST "$ROTATION_URL/api/search" \
  -H 'Content-Type: application/json' -H 'X-Rotation: 1' \
  -d '{"query":"Uniqlo oxford shirt"}'
```

Result: **HTTP 200**, `status: ok`, 24 shopping listings. The first was "UNIQLO Men's Oxford Slim Shirt, Off White, Medium", the same as in the browser.

It worked only because I copied the app's custom `X-Rotation: 1` header. The server needs no key: it trusts requests that come to its own address with that header. There is no `.env` value involved; `ROTATION_URL` is just a shell variable for the address.

### Break it on purpose

| What I changed | Status | What came back | Is that what a user should see? |
| --- | --- | --- | --- |
| Left out the `X-Rotation` header | 403 | `{"status":"forbidden","reason":"This request didn't come from the Rotation app. Reload Rotation and try again."}` | Yes. The app always sends it, so a real user only sees this if something is badly broken, and the message says what to do. |
| Used GET instead of POST | 403 | `{"status":"forbidden","reason":"This address only takes POST requests from the Rotation app. Open Rotation at the address npm start printed, then try again."}` | Mostly. The message is clear, but 405 (method not allowed) would be the more accurate code. 403 lumps it in with "you're not allowed". |
| Asked for an address that doesn't exist (`/api/searchh`) | 404 | `{"status":"not_found","reason":"That address isn't part of the Rotation server."}` | Yes, the code and message agree. |
| Sent nonsense instead of JSON | 400 | `{"status":"invalid","reason":"The request body must be JSON. Reload Rotation and try again."}` | Yes. |
| Pretended to be another website (`Origin: https://evil.example`) | 403 | `{"status":"forbidden","reason":"Requests from other websites aren't accepted. ..."}` | Yes. This is the check that stops other sites from using my server. |
| Sent an empty search (`{"query":""}`) | **200** | `{"status":"invalid","reason":"Type at least 2 characters to search."}` | The message is right, but the **status code says success while the body says invalid**. The app reads `status`, so a user is fine, but any other client trusting the code would think it worked. |

## Part 2: Call someone else's service

**Service: Open-Meteo weather** (https://open-meteo.com). Rotation suggests outfits, and the weather decides whether you need a jacket layer or not.

1. **How do you prove who you are?** You don't. The free, non-commercial API needs no key. A key (`apikey`) is used only on the paid "customer-" address. That's why `npm run weather` reads an optional `OPEN_METEO_KEY` from `.env` by name, and the free call sends none.
2. **What are its limits?** Free use is capped at 600 calls per minute, 5,000 per hour, 10,000 per day and 300,000 per month, for non-commercial use only. The limits are per IP address and per app. The terms don't say exactly what happens when you go over, only that they "reserve the right to block applications and IP addresses that misuse our service without prior notice." Data is CC BY 4.0, so it needs attribution.
3. **What does one request look like?** It's a GET to `https://api.open-meteo.com/v1/forecast` with `latitude`, `longitude` and lists of `current`, `daily` or `hourly` variables (daily needs `timezone`). It returns JSON. Errors come back as HTTP 400 with `{"error": true, "reason": "..."}`.

**Key handling:** `.env` is ignored by git (`.gitignore:11`, confirmed with `git check-ignore`). `.env.example` now lists `OPEN_METEO_KEY=` empty, and no real key was needed or used.

### The real call (`npm run weather`, from `closet-advisor/dev/weather.mjs`)

```
GET https://api.open-meteo.com/v1/forecast?latitude=43.0481&longitude=-76.1474&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&forecast_days=1
Status: 200
{ "latitude": 43.053074, "longitude": -76.15548, "timezone": "America/New_York",
  "current": { "time": "2026-11-02T20:15", "temperature_2m": 56, "apparent_temperature": 51.8,
               "precipitation": 0, "weather_code": 3, "wind_speed_10m": 3.3 },
  "daily": { "time": ["2026-11-02"], "temperature_2m_max": [71.4], "temperature_2m_min": [39.1],
             "precipitation_probability_max": [2] } }

For an outfit: it feels like 52°F, so add a jacket over the top.
```

### Breaking it

| What I changed | Status | What came back |
| --- | --- | --- |
| A bad request: latitude 999 (`npm run weather -- --bad`) | 400 | `{"reason":"Latitude must be in range of -90 to 90°. Given: 999.0.","error":true}` |
| A wrong key: `OPEN_METEO_KEY=` a made-up value, which sends it to the keyed address, `...&apikey=YOUR_KEY_HERE` | 400 | `{"reason":"The supplied API key is invalid.","error":true}` |

Both give the same 400 code with a readable `reason`. The wrong key is 400, not 401, so code that wants to tell "my request is wrong" apart from "my key is wrong" has to read the `reason`, not the status.

## How to repeat this

```sh
cd closet-advisor
npm start                         # the local server, for Part 1
npm run weather                   # the real Open-Meteo call
npm run weather -- --bad          # a bad request
OPEN_METEO_KEY=wrong npm run weather   # a wrong key
```
