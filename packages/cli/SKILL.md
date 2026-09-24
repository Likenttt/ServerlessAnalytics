---
name: serverless-analytics
description: Set up, configure and query a self-hosted Serverless Analytics deployment with the `sa` CLI (serverless-analytics-cli). Use when the user wants to add analytics/event tracking to a project, define or change tracked events, configure sampling or schema mode, look up write keys or integration code, or ask questions about their product metrics (active users, trends by channel/country/region/platform/version, funnels/conversion, revenue sums, errors).
---

# Serverless Analytics via `sa`

`sa` talks to the user's own deployment. Run it through the shell. Its stdout is JSON when not attached to a terminal, so parse stdout; progress messages go to stderr. Exit codes: 0 ok, 1 API/network error (see the last stderr line: `{"error":{code,message,status}}`), 2 usage error, 3 not logged in.

If `sa` isn't installed: `npm install -g serverless-analytics-cli` (or `npx serverless-analytics-cli …`).

## 1. Make sure you're logged in

```sh
sa whoami
```

- Exit code 3 → ask the user for their deployment URL, then do the two-step login (you can't click in a browser):
  ```sh
  sa login --endpoint <url> --no-wait   # prints {"url": "...", "code": "ABCD-EFGH"}
  ```
  Show the user the `url` and `code`, and ask them to open it, check the code matches and click **Authorize**. When they confirm, run `sa login --resume`.
- If `whoami` shows pending migrations, run `sa migrate`.
- Never ask the user to paste passwords or tokens into the chat. In CI, `SA_ENDPOINT` and `SA_TOKEN` are read from the environment.

## 2. Onboard a project

1. See what exists: `sa apps list`. Reuse an app if one clearly matches; otherwise `sa apps create "<Project name>"` (add `--strict` only if the user wants unknown events rejected).
2. Detect the platform from the codebase and get ready-to-paste code: `sa snippet <app> --lang js|html|curl|kotlin|swift`. The JSON includes `endpoint`, `writeKey` and `code`.
3. Integrate following the project's conventions:
   - Web / Node / Electron: install `@serverless-analytics/sdk`, create one shared `analytics` instance, `identify` after login, `reset` on logout, `captureErrors: true`.
   - iOS / Android / desktop / server: batch events and POST to `/v1/batch` (see snippet). Include a UUID `id` per event (retries are deduplicated), `sentAt`, and `context.platform` / `appVersion` / `channel` (store or distribution channel, e.g. `appstore`, `googleplay`, `huawei`).
   - The write key is public by design (write-only); it may live in client code or config.
4. Define the key events you instrumented, so they're documented (and enforced if strict):
   ```sh
   sa events define <app> purchase --description "Completed checkout" --prop plan:string:required --prop amount:number
   ```
   Property spec: `name:type[:required][:description]`, type ∈ string | number | boolean | any.
5. Verify end to end: `sa track <app> <event> --prop key=value`, then `sa query events <app> --limit 5`. If the queue driver is `cloudflare`, events can take ~10 s to appear.

## 3. Configure

| Goal | Command |
| --- | --- |
| Reject undefined events | `sa apps update <app> --schema-mode strict` |
| Keep data for N days | `sa apps update <app> --retention-days N` |
| Sample 10 % of users, but keep all purchases | `sa sampling set <app> --rate 10% --strategy user --override purchase=1` |
| Drop a noisy event entirely | `sa sampling set <app> --override noisy_event=0` |
| Back to full data | `sa sampling set <app> --mode full --clear-overrides` |
| Rotate a leaked write key | `sa apps rotate-key <app> --yes` (clients must ship the new key) |

Prefer `--strategy user` for sampling: funnels and per-user metrics stay accurate, and all numbers are shown as full-volume estimates. Ask before anything destructive (`delete`, `rotate-key`, `tokens revoke`, switching an app with traffic to strict mode). Those commands need `--yes`.

## 4. Answer questions with data

All queries accept `--range 24h|7d|30d|90d` (or `--from/--to`), repeated `--filter field=value`, `--interval hour|day` and `--tz <minutes>` (e.g. 480 for UTC+8; the default is the machine's zone).

| Question | Command |
| --- | --- |
| How are we doing overall? | `sa query overview <app> --range 30d` (totals + previous period) |
| DAU / WAU / MAU | `sa query active <app>` |
| Active users by channel over time | `sa query trend <app> --metric users --by channel --range 30d` |
| Users by country, or regions within one | `sa query trend <app> --metric users --by country`, then `--by region --filter country=CN` |
| Revenue by channel | `sa query trend <app> --event purchase --metric sum:amount --by channel` |
| Average order value | `sa query trend <app> --event purchase --metric avg:amount` |
| Distribution of a property | `sa query top <app> --by prop:plan --filter name=purchase` |
| Conversion / where users drop off | `sa query funnel <app> --step view_paywall --step start_trial --step purchase --window 168 --by platform` |
| Top errors, then one in detail | `sa query errors <app>`, then `sa query errors <app> <fingerprint>` |
| What's arriving right now | `sa query events <app> --limit 20` |

Groupable fields: `name`, `platform`, `channel`, `country`, `region`, `os`, `os_version`, `browser`, `app_version`, `device`, `locale`, `prop:<key>`. Metrics: `events`, `users`, `per_user`, `sum:<prop>`, `avg:<prop>`.

When reporting results:
- Lead with the answer and the numbers.
- Mention the time range and any filters used.
- Note that numbers are estimates when the app is sampled (`sa sampling get <app>`).
- The last bucket of a trend is the current, incomplete hour or day. Don't call a lower last bucket a drop.

To explore unfamiliar data first:
- `sa events list <app>` shows what's defined, plus events that were seen but never defined.
- `sa query top <app> --by name` shows volume per event.
