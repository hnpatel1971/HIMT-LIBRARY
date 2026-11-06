# Single sign-on from the HIMT Employee Portal

Employees who are already signed in to the Employee Portal can open the library's
staff pages without typing a library password.

## How it works

```
Employee's browser        Employee Portal (server)            Library (library.himt.in)
      |  clicks "Library"  ->  |                                     |
      |                        |  POST /api/sso/ticket  ------------> |  checks key, finds the staff user
      |                        |  <------------ { loginUrl }          |  makes a one-time ticket (60 s)
      |  <-- 302 to loginUrl --|                                     |
      |  GET /api/sso/login?ticket=...  ---------------------------> |  signs the user in
      |  <------------------------------------ 303 to /staff ------- |
```

The shared key stays on the portal's server and is never sent to the browser.
A ticket works once and expires after 60 seconds.

## Library settings

In `D:\Other Projects\HIMT-LIBRARY\Config\himt-library.env` (or wherever your
settings file is), add:

```
SSO_API_KEY=<a long random secret, shared with the portal team>
PUBLIC_URL=https://library.himt.in
# Optional: only these server IPs may ask for tickets
SSO_ALLOWED_IPS=
```

Then run `install.ps1` again (or restart the HIMT-Library service so it picks up the
settings). SSO is off while `SSO_API_KEY` is empty.

A random key can be made in PowerShell with:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

## The API for the Employee Portal

### `POST https://library.himt.in/api/sso/ticket`

Call this from the portal's **server**, never from browser JavaScript.

Headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-SSO-Key` | the value of `SSO_API_KEY` |

Body:

```json
{ "username": "sreenivasan", "next": "/staff/circulation" }
```

- `username`: the employee's library staff username. Matching ignores upper/lower case.
- `next` (optional): the library page to open after sign-in. Only `/staff...` paths are
  accepted; anything else opens `/staff`.

Answers:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "loginUrl": "https://library.himt.in/api/sso/login?ticket=…", "expiresAt": "…" }` | Redirect the browser to `loginUrl` now |
| 401 | `{ "error": "Invalid SSO key" }` | Wrong key, or the caller's IP isn't in `SSO_ALLOWED_IPS` |
| 404 | `{ "error": "No library staff account has this username" }` | Create the user in Library > Settings > Users first |
| 403 | `{ "error": "This library staff account is switched off" }` | The account is inactive |
| 404 | `{ "error": "Single sign-on is not turned on" }` | `SSO_API_KEY` is not set |

### Example (Node / Express on the portal)

```js
app.get("/go/library", requireLogin, async (req, res) => {
  const r = await fetch("https://library.himt.in/api/sso/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SSO-Key": process.env.LIBRARY_SSO_KEY },
    body: JSON.stringify({ username: req.user.libraryUsername }),
  });
  if (!r.ok) return res.status(502).send((await r.json()).error);
  res.redirect((await r.json()).loginUrl);
});
```

### Example (PHP)

```php
$ch = curl_init("https://library.himt.in/api/sso/ticket");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["Content-Type: application/json", "X-SSO-Key: " . getenv("LIBRARY_SSO_KEY")],
  CURLOPT_POSTFIELDS => json_encode(["username" => $employeeLibraryUsername]),
]);
$out = json_decode(curl_exec($ch), true);
if (curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200) header("Location: " . $out["loginUrl"]);
```

### Test with curl

```bash
curl -X POST https://library.himt.in/api/sso/ticket \
  -H "Content-Type: application/json" -H "X-SSO-Key: <key>" \
  -d '{"username":"admin"}'
```

Open the returned `loginUrl` in a browser within 60 seconds.

## If something goes wrong

- An expired or reused link opens the library login page with a message, and the
  employee can still log in with their password.
- Every SSO sign-in is written to the audit log as `auth.sso_login`; rejected key
  attempts as `auth.sso_rejected`.
